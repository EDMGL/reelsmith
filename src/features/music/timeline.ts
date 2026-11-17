/**
 * Adding library items to the project: render → WAV asset (persisted in the
 * same IndexedDB blob store as imported media) → audio clip on a free audio
 * track. Each add is ONE undo step (track creation + clip in one transaction).
 */
import {
  createClipFromAsset,
  createId,
  getProjectDuration,
  getTrackClips,
  putAssetBlob,
  useEditorStore,
  type AudioClip,
  type Id,
  type MediaAsset,
  type Project,
} from '../../core';
import type { MusicTrackDef, SfxDef } from './catalogue';
import { getMusic, getSfx, lengthKey, peekCached, sfxKey } from './library';
import { pcmDuration, waveformPeaks, type Pcm } from './synth/master';
import { encodeWav } from './wav';

export type MusicLength = 'fit' | 15 | 30 | 60;

export interface MusicAddOptions {
  length: MusicLength;
  startAt: 'zero' | 'playhead';
  /** Clip volume 0..1 (default 0.3 sits under speech). */
  volume: number;
  fadeIn: number;
  fadeOut: number;
}

export const DEFAULT_MUSIC_OPTIONS: MusicAddOptions = { length: 'fit', startAt: 'zero', volume: 0.3, fadeIn: 0.5, fadeOut: 2 };
export const DEFAULT_SFX_VOLUME = 0.8;
/** Length used for "fit" when the project is empty. */
export const EMPTY_PROJECT_SECONDS = 30;
/** Longer renders are stored as mono WAV to halve the size (5.3 MB/min instead of 10.6). */
export const MONO_ABOVE_SECONDS = 240;
export const MUSIC_TRACK_NAME = 'Music';
export const SFX_TRACK_NAME = 'SFX';

const E = () => useEditorStore.getState();

const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Where and how long the music clip will be. */
export function planMusic(project: Project, playhead: number, o: Pick<MusicAddOptions, 'length' | 'startAt'>): { start: number; duration: number } {
  const start = r3(o.startAt === 'playhead' ? Math.max(0, playhead) : 0);
  if (o.length !== 'fit') return { start, duration: o.length };
  const remaining = getProjectDuration(project) - start;
  return { start, duration: r3(remaining > 1 ? remaining : EMPTY_PROJECT_SECONDS) };
}

const isFree = (project: Project, trackId: Id, start: number, end: number) =>
  getTrackClips(project, trackId).every((c) => c.start + c.duration <= start + 1e-6 || c.start >= end - 1e-6);

/**
 * An existing audio track with room for [start, end): first a track named
 * `prefix…`; else an audio track with no clips at all (for music) / any free
 * audio track that is not a music or voiceover track (for effects). Null = create one.
 */
export function findFreeAudioTrack(project: Project, start: number, end: number, kind: 'music' | 'sfx'): Id | null {
  const prefix = kind === 'music' ? MUSIC_TRACK_NAME : SFX_TRACK_NAME;
  const audio = project.tracks.filter((t) => t.kind === 'audio' && !t.locked).sort((a, b) => a.order - b.order);
  const named = audio.filter((t) => t.name.startsWith(prefix)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  for (const t of named) if (isFree(project, t.id, start, end)) return t.id;
  for (const t of audio) {
    if (named.includes(t)) continue;
    if (kind === 'music' && getTrackClips(project, t.id).length === 0 && !/^(SFX|Voiceover)/.test(t.name)) return t.id;
    if (kind === 'sfx' && !/^(Music|Voiceover)/.test(t.name) && isFree(project, t.id, start, end)) return t.id;
  }
  return null;
}

function nextTrackName(project: Project, prefix: string): string {
  const n = project.tracks.filter((t) => t.kind === 'audio' && t.name.startsWith(prefix)).length;
  return n ? `${prefix} ${n + 1}` : prefix;
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

/** Generated-asset memo: render key -> asset id (re-adding the same render reuses the file). */
const assetMemo = new Map<string, Id>();

export const assetDeps = {
  createObjectURL: (b: Blob) => URL.createObjectURL(b),
  persist: (id: Id, b: Blob) => putAssetBlob(id, b),
};

/** Creates (or reuses) a WAV audio asset for rendered PCM. Not an undo step (like importing). */
export function ensureAsset(key: string, pcm: Pcm, name: string): MediaAsset {
  const existing = assetMemo.get(key);
  const have = existing ? E().project.assets[existing] : undefined;
  if (have && have.status === 'ready') return have;
  const seconds = pcmDuration(pcm);
  const blob = encodeWav(pcm, { channels: seconds > MONO_ABOVE_SECONDS ? 1 : 2 });
  const asset: MediaAsset = {
    id: createId('asset'),
    kind: 'audio',
    name,
    mimeType: 'audio/wav',
    size: blob.size,
    duration: seconds,
    width: 0,
    height: 0,
    hasAudio: true,
    waveform: waveformPeaks(pcm, 1200),
    status: 'ready',
    objectURL: assetDeps.createObjectURL(blob),
    blob,
  };
  E().addAsset(asset);
  // Persist right away so a quick reload keeps it (autosave would also store it).
  assetDeps.persist(asset.id, blob).catch((e) => console.warn('[music] could not store blob', e));
  assetMemo.set(key, asset.id);
  return asset;
}

function fmtLen(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.round(s - m * 60)).padStart(2, '0')}`;
}

export function musicAssetName(def: MusicTrackDef, seed: number, seconds: number): string {
  const v = def.variations.find((x) => x.seed === seed)?.label ?? String(seed);
  return `${def.name} (${v}, ${fmtLen(seconds)}).wav`;
}

export function sfxAssetName(def: SfxDef, seed: number): string {
  const v = def.variations.find((x) => x.seed === seed)?.label ?? String(seed);
  return `${def.name} (${v}).wav`;
}

// ---------------------------------------------------------------------------
// Clips
// ---------------------------------------------------------------------------

export interface AddResult {
  ok: boolean;
  clipId?: Id;
  message: string;
}

function audioClipFor(asset: MediaAsset, o: { volume: number; fadeIn: number; fadeOut: number; name: string }): AudioClip {
  const clip = createClipFromAsset(asset, { trackId: '', start: 0, name: o.name }) as AudioClip;
  const half = clip.duration / 2;
  return { ...clip, volume: o.volume, fadeIn: Math.min(o.fadeIn, half), fadeOut: Math.min(o.fadeOut, half) };
}

/** Places a clip on a free audio track (creating one if needed) — one undo step. */
export function placeAudioClip(clip: AudioClip, start: number, kind: 'music' | 'sfx', label: string): Id | null {
  let placed: Id | null = null;
  E().transact(label, () => {
    const p = E().project;
    const end = start + clip.duration;
    let trackId = findFreeAudioTrack(p, start, end, kind);
    const c = { ...clip, id: createId('clip'), start };
    if (trackId && E().addClip({ ...c, trackId })) {
      placed = c.id;
      return;
    }
    trackId = E().addTrack('audio', { name: nextTrackName(E().project, kind === 'music' ? MUSIC_TRACK_NAME : SFX_TRACK_NAME) });
    if (trackId && E().addClip({ ...c, trackId })) placed = c.id;
  });
  if (placed) E().selectClips([placed]);
  return placed;
}

export async function addMusicToTimeline(def: MusicTrackDef, seed: number, o: MusicAddOptions, onProgress?: (f: number) => void): Promise<AddResult> {
  try {
    const { start, duration } = planMusic(E().project, E().currentTime, o);
    const pcm = await getMusic(def, seed, duration, onProgress);
    const asset = ensureAsset(lengthKey(def.id, seed, duration), pcm, musicAssetName(def, seed, duration));
    const clipId = placeAudioClip(audioClipFor(asset, { volume: o.volume, fadeIn: o.fadeIn, fadeOut: o.fadeOut, name: def.name }), start, 'music', `Add music: ${def.name}`);
    if (!clipId) return { ok: false, message: 'Could not place the music on the timeline (are all audio tracks locked?).' };
    return { ok: true, clipId, message: `“${def.name}” added (${fmtLen(duration)} at ${start.toFixed(1)} s, volume ${Math.round(o.volume * 100)} %). Undo removes it.` };
  } catch (e) {
    return { ok: false, message: `Could not create the music: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export async function addSfxToTimeline(def: SfxDef, seed: number, volume = DEFAULT_SFX_VOLUME, onProgress?: (f: number) => void): Promise<AddResult> {
  try {
    const pcm = await getSfx(def, seed, onProgress);
    const asset = ensureAsset(sfxKey(def.id, seed), pcm, sfxAssetName(def, seed));
    const start = r3(E().currentTime);
    const clipId = placeAudioClip(audioClipFor(asset, { volume, fadeIn: 0, fadeOut: 0, name: def.name }), start, 'sfx', `Add sound: ${def.name}`);
    if (!clipId) return { ok: false, message: 'Could not place the sound on the timeline (are all audio tracks locked?).' };
    return { ok: true, clipId, message: `“${def.name}” added at ${start.toFixed(2)} s.` };
  } catch (e) {
    return { ok: false, message: `Could not create the sound: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// ---------------------------------------------------------------------------
// Drag & drop (CLIP_TEMPLATE_DRAG_MIME): needs the render already cached,
// because dragstart is synchronous. The timeline assigns id/track/start.
// ---------------------------------------------------------------------------

export function musicDragTemplate(def: MusicTrackDef, seed: number, o: MusicAddOptions): AudioClip | null {
  const { duration } = planMusic(E().project, 0, { length: o.length, startAt: 'zero' });
  const key = lengthKey(def.id, seed, duration);
  const pcm = peekCached(key);
  if (!pcm) return null;
  const asset = ensureAsset(key, pcm, musicAssetName(def, seed, duration));
  return audioClipFor(asset, { volume: o.volume, fadeIn: o.fadeIn, fadeOut: o.fadeOut, name: def.name });
}

export function sfxDragTemplate(def: SfxDef, seed: number, volume = DEFAULT_SFX_VOLUME): AudioClip | null {
  const key = sfxKey(def.id, seed);
  const pcm = peekCached(key);
  if (!pcm) return null;
  const asset = ensureAsset(key, pcm, sfxAssetName(def, seed));
  return audioClipFor(asset, { volume, fadeIn: 0, fadeOut: 0, name: def.name });
}

/** Length a music drag would produce right now (for pre-rendering on hover). */
export function musicDragSeconds(o: MusicAddOptions): number {
  return planMusic(E().project, 0, { length: o.length, startAt: 'zero' }).duration;
}

/** Test helper. */
export function resetAssetMemo(): void {
  assetMemo.clear();
}
