/**
 * Pools of hidden media elements (one per clip in use) and an image cache.
 * Elements are keyed by clip id so split pieces of the same file can be
 * preloaded at their own source position and play back-to-back seamlessly.
 */
import type { AssetFrame, MediaAsset } from '../core';

export type MediaKind = 'video' | 'audio';
export type ElementFactory = (kind: MediaKind) => HTMLMediaElement;

export interface MediaSlot {
  key: string;
  kind: MediaKind;
  assetId: string;
  url: string;
  el: HTMLMediaElement;
  lastUsed: number;
  /** Web Audio routing (preview pool only, once an AudioContext exists). */
  source?: MediaElementAudioSourceNode;
  gain?: GainNode;
}

let hostEl: HTMLElement | null = null;

/** Hidden in-document host: some browsers only decode frames of attached elements. */
function host(): HTMLElement | null {
  if (typeof document === 'undefined' || !document.body) return null;
  if (hostEl && hostEl.isConnected) return hostEl;
  hostEl = document.createElement('div');
  hostEl.setAttribute('aria-hidden', 'true');
  hostEl.dataset.reelsmithMedia = '';
  Object.assign(hostEl.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    width: '2px',
    height: '2px',
    overflow: 'hidden',
    opacity: '0',
    pointerEvents: 'none',
    zIndex: '-1',
  });
  document.body.appendChild(hostEl);
  return hostEl;
}

/** Default factory: real elements, attached to a hidden host node. */
export const domElementFactory: ElementFactory = (kind) => {
  const el = document.createElement(kind);
  el.preload = 'auto';
  el.muted = true;
  (el as HTMLMediaElement & { preservesPitch?: boolean }).preservesPitch = false;
  if (kind === 'video') {
    const v = el as HTMLVideoElement;
    v.playsInline = true;
    v.disablePictureInPicture = true;
    v.width = 2;
    v.height = 2;
  }
  host()?.appendChild(el);
  return el;
};

export class MediaPool {
  private slots = new Map<string, MediaSlot>();
  private clock = 0;

  constructor(
    private readonly factory: ElementFactory,
    private readonly onRelease?: (slot: MediaSlot) => void,
  ) {}

  /** Returns the slot for `key`, creating it (or swapping its source) as needed. */
  acquire(key: string, kind: MediaKind, assetId: string, url: string): MediaSlot {
    const existing = this.slots.get(key);
    if (existing && existing.kind === kind && existing.url === url) {
      existing.lastUsed = ++this.clock;
      existing.assetId = assetId;
      return existing;
    }
    if (existing) this.release(key);
    const el = this.factory(kind);
    el.src = url;
    const slot: MediaSlot = { key, kind, assetId, url, el, lastUsed: ++this.clock };
    this.slots.set(key, slot);
    return slot;
  }

  get(key: string): MediaSlot | undefined {
    return this.slots.get(key);
  }

  /** Any slot showing `assetId` (closest to `sourceTime` if several). */
  findByAsset(assetId: string, sourceTime: number): MediaSlot | undefined {
    let best: MediaSlot | undefined;
    let bestD = Infinity;
    for (const s of this.slots.values()) {
      if (s.assetId !== assetId) continue;
      const d = Math.abs(s.el.currentTime - sourceTime);
      if (d < bestD) {
        best = s;
        bestD = d;
      }
    }
    return best;
  }

  values(): IterableIterator<MediaSlot> {
    return this.slots.values();
  }

  get size(): number {
    return this.slots.size;
  }

  release(key: string): void {
    const slot = this.slots.get(key);
    if (!slot) return;
    this.slots.delete(key);
    this.onRelease?.(slot);
    const el = slot.el;
    try {
      el.pause();
      el.removeAttribute('src');
      el.load();
    } catch {
      /* fake/detached element */
    }
    el.remove?.();
  }

  /** Keeps every slot in `keep` plus the `maxIdle` most recently used others. */
  trim(keep: ReadonlySet<string>, maxIdle: number): void {
    const idle = [...this.slots.values()].filter((s) => !keep.has(s.key)).sort((a, b) => b.lastUsed - a.lastUsed);
    for (const s of idle.slice(maxIdle)) this.release(s.key);
  }

  dispose(): void {
    for (const key of [...this.slots.keys()]) this.release(key);
  }
}

/** Resolves with the event name that fired first, or null on timeout. */
export function waitForEvent(el: EventTarget, events: readonly string[], timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    const handlers: [string, () => void][] = [];
    const timer = setTimeout(() => done(null), timeoutMs);
    function done(name: string | null) {
      clearTimeout(timer);
      for (const [n, h] of handlers) el.removeEventListener(n, h);
      resolve(name);
    }
    for (const name of events) {
      const h = () => done(name);
      handlers.push([name, h]);
      el.addEventListener(name, h);
    }
  });
}

const HAVE_METADATA = 1;
const HAVE_CURRENT_DATA = 2;

export interface SeekOptions {
  timeoutMs: number;
  /** Skip the seek if already within this many seconds (0 = must match exactly). */
  tolerance: number;
  /** Additionally wait for the decoded frame to be presented (requestVideoFrameCallback), bounded by `frameWaitMs`. */
  waitForFrame?: boolean;
  frameWaitMs?: number;
}

/**
 * Seeks a media element to `time` and resolves once the frame at that time is
 * decoded (readyState >= HAVE_CURRENT_DATA). Resolves `false` on timeout/error.
 */
export async function seekElement(el: HTMLMediaElement, time: number, opts: SeekOptions): Promise<boolean> {
  if (el.error) return false;
  if (el.readyState < HAVE_METADATA) {
    const ev = await waitForEvent(el, ['loadedmetadata', 'error'], opts.timeoutMs);
    if (ev !== 'loadedmetadata' && el.readyState < HAVE_METADATA) return false;
  }
  let target = Math.max(0, time);
  if (Number.isFinite(el.duration) && el.duration > 0) target = Math.min(target, Math.max(0, el.duration - 1e-3));
  const close = Math.abs(el.currentTime - target) <= opts.tolerance;
  if (close && !el.seeking && el.readyState >= HAVE_CURRENT_DATA) return true;
  if (!close || el.seeking) {
    const seeked = waitForEvent(el, ['seeked', 'error'], opts.timeoutMs);
    if (!close) el.currentTime = target;
    if ((await seeked) !== 'seeked') return false;
  }
  if (el.readyState < HAVE_CURRENT_DATA) {
    const ev = await waitForEvent(el, ['loadeddata', 'canplay', 'error'], opts.timeoutMs);
    if (ev === 'error' || ev === null) return el.readyState >= HAVE_CURRENT_DATA;
  }
  if (opts.waitForFrame) await waitPresentedFrame(el, opts.frameWaitMs ?? 60);
  return el.readyState >= HAVE_CURRENT_DATA;
}

type RVFCVideo = HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number; cancelVideoFrameCallback?: (h: number) => void };

/** Waits (bounded) for requestVideoFrameCallback where available. */
function waitPresentedFrame(el: HTMLMediaElement, maxMs: number): Promise<void> {
  const v = el as RVFCVideo;
  if (typeof v.requestVideoFrameCallback !== 'function') return Promise.resolve();
  return new Promise((resolve) => {
    let handle = 0;
    const timer = setTimeout(() => {
      v.cancelVideoFrameCallback?.(handle);
      resolve();
    }, maxMs);
    handle = v.requestVideoFrameCallback!(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** Current frame of a video element, or null if nothing is decoded yet. */
export function videoFrame(el: HTMLMediaElement | undefined): AssetFrame | null {
  if (!el || el.readyState < HAVE_CURRENT_DATA) return null;
  const v = el as HTMLVideoElement;
  if (!v.videoWidth || !v.videoHeight) return null;
  return { source: v, width: v.videoWidth, height: v.videoHeight };
}

/** Starts playback, swallowing autoplay/abort rejections (and jsdom's missing play()). */
export function safePlay(el: HTMLMediaElement): void {
  try {
    const p = el.play() as Promise<void> | undefined;
    if (p && typeof p.catch === 'function') p.catch(() => undefined);
  } catch {
    /* not implemented / not allowed */
  }
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

export type ImageFactory = () => HTMLImageElement;

interface ImageEntry {
  url: string;
  img: HTMLImageElement;
  ready: Promise<boolean>;
  ok: boolean;
}

/** Decoded images per asset (exposed to renderers through `env.getAssetFrame`). */
export class ImageCache {
  private entries = new Map<string, ImageEntry>();

  constructor(private readonly factory: ImageFactory = () => new Image()) {}

  /** Starts loading (if needed) and resolves when the image is decoded. */
  ensure(asset: MediaAsset): Promise<boolean> {
    const e = this.entries.get(asset.id);
    if (e && e.url === asset.objectURL) return e.ready;
    const img = this.factory();
    img.decoding = 'async';
    const entry: ImageEntry = { url: asset.objectURL, img, ok: false, ready: Promise.resolve(false) };
    entry.ready = new Promise<boolean>((resolve) => {
      const finish = (ok: boolean) => {
        entry.ok = ok && img.naturalWidth > 0;
        resolve(entry.ok);
      };
      img.onload = () => {
        if (typeof img.decode === 'function') img.decode().then(() => finish(true), () => finish(true));
        else finish(true);
      };
      img.onerror = () => finish(false);
    });
    img.src = asset.objectURL;
    this.entries.set(asset.id, entry);
    return entry.ready;
  }

  frame(asset: MediaAsset): AssetFrame | null {
    const e = this.entries.get(asset.id);
    if (!e || !e.ok || e.url !== asset.objectURL) return null;
    return { source: e.img, width: e.img.naturalWidth, height: e.img.naturalHeight };
  }

  /** Drops images of assets not in `keepAssetIds`. */
  retain(keepAssetIds: ReadonlySet<string>): void {
    for (const id of [...this.entries.keys()]) if (!keepAssetIds.has(id)) this.entries.delete(id);
  }

  dispose(): void {
    this.entries.clear();
  }
}
