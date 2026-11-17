/**
 * The Erdemcut playback/render engine (implements core's `PlaybackEngine`).
 *
 * - Store-driven: subscribes to `isPlaying` / `seekNonce`, advances time with
 *   `setPlaybackTime`, pauses the store at the project end.
 * - Clock: a monotonic wall clock (performance.now). Media elements play
 *   natively at `speed` and are kept on the clock by drift correction (small
 *   playbackRate nudges, hard re-seek above a threshold). A clip's picture and
 *   its own sound come from the SAME element, so they are always in sync.
 * - Preview audio: each element is routed through a GainNode (volume x fades,
 *   up to 4x, muted tracks = 0) once an AudioContext exists (created on the
 *   first play, inside the user gesture). Without Web Audio it falls back to
 *   element.volume (max 1).
 * - Rendering: `renderFrame` prepares every needed frame (seeks + awaits in
 *   export mode or while paused) and then composites synchronously.
 */
import {
  STREAMING_DECODE_BYTES,
  clipGainAt,
  decodeMediaAudio,
  getProjectDuration,
  getAssetBlob,
  isMediaClip,
  useEditorStore,
  type AssetFrame,
  type AudioMixOptions,
  type Canvas2D,
  type Clip,
  type EditorState,
  type Id,
  type MediaAsset,
  type PlaybackEngine,
  type Project,
  type RenderFrameOptions,
} from '../core';
import { renderAudioMix } from './audioMix';
import { PlaybackClock, playbackTick } from './clock';
import { compositeFrame, type LayerSurface } from './compositor';
import {
  ImageCache,
  MediaPool,
  domElementFactory,
  safePlay,
  seekElement,
  videoFrame,
  type ElementFactory,
  type ImageFactory,
  type MediaKind,
  type MediaSlot,
} from './mediaPool';
import { elementRate, isAudible, mediaNeedsAt, sourceTimeAt, upcomingClips, visibleClipsAt } from './timeline';

type Store = Pick<typeof useEditorStore, 'getState' | 'subscribe'>;

export interface EngineDeps {
  store: Store;
  /** Monotonic clock in SECONDS. */
  now(): number;
  requestFrame(cb: () => void): number;
  cancelFrame(handle: number): void;
  createElement: ElementFactory;
  createImage?: ImageFactory;
  createLayer(width: number, height: number): LayerSurface | null;
  /** Live audio context for preview (null = no Web Audio). */
  createAudioContext(): AudioContext | null;
  createOfflineContext(channels: number, length: number, sampleRate: number): OfflineAudioContext;
  loadBlob(asset: MediaAsset): Promise<Blob | undefined>;
}

/** Seconds to look ahead for preloading upcoming clips. */
export const PRELOAD_WINDOW = 2.5;
/** Drift (s) above which a playing element is hard re-seeked. */
export const HARD_RESYNC = 0.2;
/** Idle elements kept around for quick reuse. */
export const MAX_IDLE_ELEMENTS = 6;
const PAUSED_SEEK_TIMEOUT = 4000;
const EXPORT_SEEK_TIMEOUT = 15000;

function defaultLayer(width: number, height: number): LayerSurface | null {
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d', { willReadFrequently: false });
      return ctx ? { canvas, ctx } : null;
    }
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      return ctx ? { canvas, ctx } : null;
    }
  } catch {
    /* no canvas support */
  }
  return null;
}

async function defaultLoadBlob(asset: MediaAsset): Promise<Blob | undefined> {
  if (asset.blob) return asset.blob;
  try {
    const stored = await getAssetBlob(asset.id);
    if (stored) return stored;
  } catch {
    /* IndexedDB unavailable */
  }
  if (asset.objectURL) {
    const res = await fetch(asset.objectURL);
    if (res.ok) return res.blob();
  }
  return undefined;
}

export function defaultEngineDeps(): EngineDeps {
  const hasRaf = typeof requestAnimationFrame === 'function';
  return {
    store: useEditorStore,
    now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000,
    requestFrame: (cb) => (hasRaf ? requestAnimationFrame(cb) : (setTimeout(cb, 16) as unknown as number)),
    cancelFrame: (h) => (hasRaf ? cancelAnimationFrame(h) : clearTimeout(h)),
    createElement: domElementFactory,
    createLayer: defaultLayer,
    createAudioContext: () => {
      const Ctor =
        typeof AudioContext !== 'undefined'
          ? AudioContext
          : (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      try {
        return new Ctor({ latencyHint: 'interactive' });
      } catch {
        return null;
      }
    },
    createOfflineContext: (channels, length, sampleRate) => new OfflineAudioContext(channels, length, sampleRate),
    loadBlob: defaultLoadBlob,
  };
}

export class ErdemcutEngine implements PlaybackEngine {
  private readonly deps: EngineDeps;
  private readonly clock: PlaybackClock;
  /** Elements for preview/playback (audio routed through Web Audio). */
  readonly previewPool: MediaPool;
  /** Muted elements for export (exact seeks, never disturb the preview). */
  readonly exportPool: MediaPool;
  readonly images: ImageCache;
  private audioCtx: AudioContext | null = null;
  private playing = false;
  private forceResync = false;
  private tickHandle: number | null = null;
  private backupTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;
  private renderTokens = new WeakMap<object, number>();
  private layers = new Map<string, LayerSurface>();
  private decoded = new Map<string, Promise<AudioBuffer | null>>();
  private disposed = false;
  private loggedRendererErrors = new Set<string>();

  constructor(deps: Partial<EngineDeps> = {}) {
    this.deps = { ...defaultEngineDeps(), ...deps };
    this.clock = new PlaybackClock(this.deps.now);
    this.previewPool = new MediaPool(this.deps.createElement, (slot) => this.disconnectAudio(slot));
    this.exportPool = new MediaPool(this.deps.createElement);
    this.images = new ImageCache(this.deps.createImage);
    this.unsubscribe = this.deps.store.subscribe((s, prev) => this.onStoreChange(s, prev));
    if (this.deps.store.getState().isPlaying) this.startPlayback();
  }

  // ---------------------------------------------------------------------------
  // Imperative API (mirrors to the store, which drives the engine)
  // ---------------------------------------------------------------------------

  play(): void {
    this.deps.store.getState().play();
  }

  pause(): void {
    this.deps.store.getState().pause();
  }

  seek(t: number): void {
    this.deps.store.getState().setCurrentTime(t);
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  // ---------------------------------------------------------------------------
  // Store subscription & playback loop
  // ---------------------------------------------------------------------------

  private onStoreChange(s: EditorState, prev: EditorState): void {
    if (this.disposed) return;
    if (s.isPlaying !== prev.isPlaying) {
      if (s.isPlaying) this.startPlayback();
      else this.stopPlayback();
    }
    if (s.seekNonce !== prev.seekNonce && this.playing) {
      this.clock.seek(s.currentTime);
      this.forceResync = true;
      this.syncMedia(s.currentTime);
    }
  }

  private startPlayback(): void {
    if (this.playing) return;
    this.playing = true;
    this.ensureAudioContext();
    const t = this.deps.store.getState().currentTime;
    this.clock.start(t);
    this.forceResync = true;
    this.syncMedia(t);
    this.scheduleTick();
    // Keeps media in step when rAF is throttled (background tab).
    if (this.backupTimer === null) this.backupTimer = setInterval(() => this.tick(), 250);
  }

  private stopPlayback(): void {
    if (!this.playing) return;
    this.playing = false;
    this.clock.stop();
    if (this.tickHandle !== null) this.deps.cancelFrame(this.tickHandle);
    this.tickHandle = null;
    if (this.backupTimer !== null) clearInterval(this.backupTimer);
    this.backupTimer = null;
    for (const slot of this.previewPool.values()) {
      this.setGain(slot, 0);
      if (!slot.el.paused) slot.el.pause();
    }
  }

  private scheduleTick(): void {
    if (this.tickHandle !== null) return;
    this.tickHandle = this.deps.requestFrame(() => {
      this.tickHandle = null;
      this.tick();
      if (this.playing) this.scheduleTick();
    });
  }

  /** One playback step: advance the clock, publish time, stop at the end, sync media. */
  tick(): void {
    if (!this.playing || this.disposed) return;
    const store = this.deps.store.getState();
    const { time, ended } = playbackTick(this.clock.time(), getProjectDuration(store.project));
    store.setPlaybackTime(time);
    if (ended) {
      store.pause(); // -> stopPlayback via subscription
      if (this.playing) this.stopPlayback();
      return;
    }
    this.syncMedia(time);
  }

  /** Brings the preview elements in line with project time `t` while playing. */
  private syncMedia(t: number): void {
    const project = this.deps.store.getState().project;
    const frameDur = 1 / Math.max(1, project.fps);
    const keep = new Set<string>();
    const force = this.forceResync;
    this.forceResync = false;

    for (const need of mediaNeedsAt(project, t)) {
      const { clip, track } = need;
      const asset = project.assets[clip.assetId]!;
      const slot = this.previewPool.acquire(clip.id, clip.type === 'audio' ? 'audio' : 'video', asset.id, asset.objectURL);
      keep.add(clip.id);
      // Silent clips (volume 0, muted track, no audio track) never get a Web Audio route:
      // their element stays muted, so no audio work is done for them.
      if (need.audio) this.connectAudio(slot);
      this.setGain(slot, need.audio ? clipGainAt(clip, t - clip.start, track) : 0);
      const el = slot.el;
      const expected = sourceTimeAt(clip, t);
      const rate = elementRate(clip.speed);
      if (el.paused) {
        if (force || Math.abs(el.currentTime - expected) > frameDur / 2) el.currentTime = expected;
        el.playbackRate = rate;
        safePlay(el);
        continue;
      }
      if (el.seeking) continue;
      const drift = el.currentTime - expected;
      if (force || Math.abs(drift) > HARD_RESYNC) {
        el.currentTime = expected;
        el.playbackRate = rate;
      } else if (Math.abs(drift) > frameDur / 2) {
        // Element ahead (drift > 0) -> slow down a little, behind -> speed up.
        el.playbackRate = rate * Math.min(1.1, Math.max(0.9, 1 - drift * 2));
      } else if (el.playbackRate !== rate) {
        el.playbackRate = rate;
      }
    }

    for (const { clip, track } of upcomingClips(project, t, PRELOAD_WINDOW)) {
      const asset = 'assetId' in clip ? project.assets[clip.assetId] : undefined;
      if (!asset || asset.status !== 'ready') continue;
      if (clip.type === 'image') {
        void this.images.ensure(asset);
        continue;
      }
      if (!isMediaClip(clip) || keep.has(clip.id)) continue;
      const slot = this.previewPool.acquire(clip.id, clip.type === 'audio' ? 'audio' : 'video', asset.id, asset.objectURL);
      keep.add(clip.id);
      if (isAudible(project, clip, track)) this.connectAudio(slot);
      this.setGain(slot, 0);
      const el = slot.el;
      const startSource = clip.sourceIn;
      if (!el.paused) el.pause();
      if (!el.seeking && Math.abs(el.currentTime - startSource) > frameDur / 2) el.currentTime = startSource;
    }

    for (const slot of this.previewPool.values()) {
      if (keep.has(slot.key)) continue;
      this.setGain(slot, 0);
      if (!slot.el.paused) slot.el.pause();
    }
    this.previewPool.trim(keep, MAX_IDLE_ELEMENTS);
  }

  // ---------------------------------------------------------------------------
  // Preview audio routing
  // ---------------------------------------------------------------------------

  private ensureAudioContext(): void {
    if (!this.audioCtx) {
      // Elements are routed lazily by syncMedia, only for clips that are audible.
      this.audioCtx = this.deps.createAudioContext();
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') void this.audioCtx.resume().catch(() => undefined);
  }

  private connectAudio(slot: MediaSlot): void {
    const ctx = this.audioCtx;
    if (!ctx || slot.source) return;
    try {
      const source = ctx.createMediaElementSource(slot.el);
      const gain = ctx.createGain();
      gain.gain.value = 0;
      source.connect(gain);
      gain.connect(ctx.destination);
      slot.source = source;
      slot.gain = gain;
      slot.el.muted = false;
      slot.el.volume = 1;
    } catch {
      /* already connected elsewhere / unsupported: fall back to element volume */
    }
  }

  private disconnectAudio(slot: MediaSlot): void {
    try {
      slot.source?.disconnect();
      slot.gain?.disconnect();
    } catch {
      /* ignore */
    }
    slot.source = undefined;
    slot.gain = undefined;
  }

  private previewMuted = false;

  setPreviewMuted(muted: boolean): void {
    this.previewMuted = muted;
    if (muted) for (const slot of this.previewPool.values()) this.setGain(slot, 0);
  }

  private setGain(slot: MediaSlot, value: number): void {
    const v = this.previewMuted || !Number.isFinite(value) ? 0 : Math.max(0, value);
    if (slot.gain && this.audioCtx) {
      const p = slot.gain.gain;
      if (Math.abs(p.value - v) < 1e-4) return;
      p.cancelScheduledValues(this.audioCtx.currentTime);
      p.setTargetAtTime(v, this.audioCtx.currentTime, 0.012);
      return;
    }
    slot.el.muted = v <= 0;
    slot.el.volume = Math.min(1, v);
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  async renderFrame(t: number, targetCtx: Canvas2D, opts: RenderFrameOptions = {}): Promise<void> {
    if (this.disposed) return;
    const isExport = !!opts.isExport;
    const width = opts.width ?? targetCtx.canvas.width;
    const height = opts.height ?? targetCtx.canvas.height;
    const project = this.deps.store.getState().project;
    const time = Math.max(0, Number.isFinite(t) ? t : 0);
    const token = (this.renderTokens.get(targetCtx) ?? 0) + 1;
    this.renderTokens.set(targetCtx, token);

    const pool = isExport ? this.exportPool : this.previewPool;
    await this.prepareFrame(project, time, pool, isExport);
    // A newer preview render for the same target superseded this one.
    if (!isExport && this.renderTokens.get(targetCtx) !== token) return;
    if (this.disposed) return;

    compositeFrame(targetCtx, project, time, { width, height, isExport }, {
      frameFor: (clip, assetId, sourceTime) => this.frameFor(pool, project, clip, assetId, sourceTime),
      getLayer: (w, h) => this.getLayer(w, h, isExport),
      onRendererError: (clip, e) => {
        if (this.loggedRendererErrors.has(clip.type)) return;
        this.loggedRendererErrors.add(clip.type);
        console.error(`[engine] ${clip.type} renderer failed`, e);
      },
    });
  }

  /** Decodes every frame the compositor will need at `t`. */
  private async prepareFrame(project: Project, t: number, pool: MediaPool, isExport: boolean): Promise<void> {
    const jobs: Promise<unknown>[] = [];
    const keep = new Set<string>();
    const frameDur = 1 / Math.max(1, project.fps);
    for (const { clip } of visibleClipsAt(project, t)) {
      if (clip.type === 'video') {
        const asset = project.assets[clip.assetId];
        if (!asset || asset.status !== 'ready' || !asset.objectURL) continue;
        const slot = pool.acquire(clip.id, 'video', asset.id, asset.objectURL);
        keep.add(clip.id);
        const st = sourceTimeAt(clip, t);
        if (isExport) {
          jobs.push(seekElement(slot.el, st, { timeoutMs: EXPORT_SEEK_TIMEOUT, tolerance: 0, waitForFrame: true, frameWaitMs: 50 }));
        } else if (!this.playing) {
          jobs.push(seekElement(slot.el, st, { timeoutMs: PAUSED_SEEK_TIMEOUT, tolerance: frameDur / 2 }));
        }
      } else if (clip.type === 'image') {
        const asset = project.assets[clip.assetId];
        if (asset && asset.status === 'ready' && asset.objectURL) jobs.push(this.images.ensure(asset));
      }
    }
    if (jobs.length) await Promise.all(jobs);
    if (isExport) pool.trim(keep, 2);
    else if (!this.playing) {
      for (const s of pool.values()) keep.add(s.key);
      pool.trim(keep, MAX_IDLE_ELEMENTS);
    }
  }

  private frameFor(pool: MediaPool, project: Project, clip: Clip, assetId: Id, sourceTime: number): AssetFrame | null {
    const asset = project.assets[assetId];
    if (!asset || asset.status !== 'ready') return null;
    if (asset.kind === 'image') return this.images.frame(asset);
    if (asset.kind !== 'video') return null;
    const own = pool.get(clip.id);
    const slot = own && own.kind === 'video' && own.assetId === assetId ? own : pool.findByAsset(assetId, sourceTime, 'video');
    return videoFrame(slot?.el);
  }

  private getLayer(width: number, height: number, isExport: boolean): LayerSurface | null {
    const key = `${isExport ? 'x' : 'p'}:${width}x${height}`;
    let layer = this.layers.get(key);
    if (!layer) {
      // Drop layers of other sizes for this purpose (resizes).
      for (const k of [...this.layers.keys()]) if (k.startsWith(isExport ? 'x:' : 'p:')) this.layers.delete(k);
      layer = this.deps.createLayer(width, height) ?? undefined;
      if (!layer) return null;
      this.layers.set(key, layer);
    }
    return layer;
  }

  // ---------------------------------------------------------------------------
  // Audio mixdown
  // ---------------------------------------------------------------------------

  mixAudio(opts: AudioMixOptions): Promise<AudioBuffer> {
    const project = this.deps.store.getState().project;
    return renderAudioMix(project, opts, this.deps.createOfflineContext, (asset, ctx) => this.decodeAsset(asset, ctx));
  }

  private decodeAsset(asset: MediaAsset, ctx: BaseAudioContext): Promise<AudioBuffer | null> {
    const key = `${asset.id}@${ctx.sampleRate}@${asset.objectURL}`;
    let p = this.decoded.get(key);
    if (!p) {
      p = (async () => {
        const blob = await this.deps.loadBlob(asset);
        if (!blob) return null;
        if (blob.size <= STREAMING_DECODE_BYTES) {
          try {
            return await ctx.decodeAudioData(await blob.arrayBuffer());
          } catch {
            /* try the streaming decoder below */
          }
        }
        // Large files (> 2 GB cannot be read at once) or containers Web Audio can't parse.
        return await decodeMediaAudio(blob, { sampleRate: ctx.sampleRate });
      })().catch(() => null);
      this.decoded.set(key, p);
      // Keep the cache small: decoded PCM is large.
      while (this.decoded.size > 8) this.decoded.delete(this.decoded.keys().next().value!);
    }
    return p;
  }

  // ---------------------------------------------------------------------------

  dispose(): void {
    if (this.disposed) return;
    this.stopPlayback();
    this.disposed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.previewPool.dispose();
    this.exportPool.dispose();
    this.images.dispose();
    this.layers.clear();
    this.decoded.clear();
    void this.audioCtx?.close().catch(() => undefined);
    this.audioCtx = null;
  }
}

/** Element kind for a clip (exported for tests). */
export function elementKindFor(clip: Clip): MediaKind {
  return clip.type === 'audio' ? 'audio' : 'video';
}
