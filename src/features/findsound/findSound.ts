/**
 * "Find sound": search YouTube through the local dev-server API
 * (server/soundApi.ts), preview a result as MP3 and drop it on a music track.
 */
import { createClipFromAsset, getProjectDuration, useEditorStore, type AudioClip, type Id, type MediaAsset } from '../../core';
import { importFile } from '../media/importMedia';
import { placeAudioClip } from '../music/timeline';

export interface SoundResult {
  id: string;
  title: string;
  channel: string;
  duration: number | null;
  thumbnail: string | null;
}

/** Appended to searches while "Copyright-free only" is on. */
export const FREE_SUFFIX = 'no copyright music';

export const MOODS: { label: string; query: string }[] = [
  { label: 'Lo-fi', query: 'lofi chill beat' },
  { label: 'Upbeat', query: 'upbeat happy background music' },
  { label: 'Cinematic', query: 'cinematic epic background music' },
  { label: 'Vlog', query: 'vlog background music' },
  { label: 'Funny', query: 'funny comedy background music' },
  { label: 'Sad', query: 'sad emotional piano background music' },
  { label: 'Hype', query: 'energetic hype trap beat' },
];

export function buildQuery(text: string, freeOnly: boolean): string {
  const q = text.trim();
  if (!q) return '';
  return freeOnly && !/copyright/i.test(q) ? `${q} ${FREE_SUFFIX}` : q;
}

async function errorOf(r: Response): Promise<string> {
  try {
    const j = (await r.json()) as { error?: string };
    if (j.error) return j.error;
  } catch {
    /* not JSON */
  }
  return `Server answered ${r.status}`;
}

export const soundApi = {
  async status(): Promise<{ ytdlp: boolean; ffmpeg: boolean; desktop?: boolean } | null> {
    try {
      const r = await fetch('/api/sound/status');
      return r.ok ? ((await r.json()) as { ytdlp: boolean; ffmpeg: boolean; desktop?: boolean }) : null;
    } catch {
      return null;
    }
  },
  async search(query: string, signal?: AbortSignal): Promise<SoundResult[]> {
    const r = await fetch(`/api/sound/search?q=${encodeURIComponent(query)}`, { signal });
    if (!r.ok) throw new Error(await errorOf(r));
    return (await r.json()) as SoundResult[];
  },
  /** Same-origin, seekable stream of the original audio: plays in ~a second, nothing converted. */
  streamUrl: (id: string) => `/api/sound/stream?id=${encodeURIComponent(id)}`,
  /** Hover hint: lets the server look up the stream before the click. */
  prepare(id: string): void {
    void fetch(`/api/sound/prepare?id=${encodeURIComponent(id)}`).catch(() => undefined);
  },
  async audio(id: string, signal?: AbortSignal): Promise<Blob> {
    const r = await fetch(`/api/sound/audio?id=${encodeURIComponent(id)}`, { signal });
    if (!r.ok) throw new Error(await errorOf(r));
    return r.blob();
  },
  importFile,
};

export interface AddSoundOptions {
  startAt: 'zero' | 'playhead';
  /** 0..1; music sits under speech at ~0.3. */
  volume: number;
}

/** Safe file name from a video title. */
export function soundFileName(title: string): string {
  const clean = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return `${clean || 'sound'}.mp3`;
}

/**
 * Imports the MP3 (one asset per video, reused when added again) and places it
 * on a free music track: from 0 or the playhead, cut to the end of the video
 * (whole song if the timeline is empty), soft fades. One undo step.
 */
export async function addSoundToTimeline(result: SoundResult, blob: Blob, o: AddSoundOptions): Promise<Id> {
  const S = useEditorStore.getState;
  const existing = Object.values(S().project.assets).find((a) => a.kind === 'audio' && a.name === soundFileName(result.title) && a.status === 'ready');
  const assetId = existing?.id ?? (await soundApi.importFile(new File([blob], soundFileName(result.title), { type: 'audio/mpeg' })));
  if (!assetId) throw new Error('The MP3 could not be read.');
  const asset = S().project.assets[assetId] as MediaAsset;
  const start = o.startAt === 'playhead' ? Math.max(0, S().currentTime) : 0;
  const clip = createClipFromAsset(asset, { trackId: '', start: 0, name: result.title }) as AudioClip;
  const remaining = getProjectDuration(S().project) - start;
  const length = remaining > 1 ? Math.min(clip.duration, remaining) : clip.duration;
  const fit: AudioClip = {
    ...clip,
    sourceOut: clip.sourceIn + length,
    duration: length,
    volume: o.volume,
    fadeIn: Math.min(0.5, length / 2),
    fadeOut: Math.min(2, length / 2),
  };
  const id = placeAudioClip(fit, start, 'music', `Add sound: ${result.title}`);
  if (!id) throw new Error('Could not place the sound on the timeline (are all audio tracks locked?).');
  return id;
}

export function formatLength(s: number | null): string {
  if (s === null || !Number.isFinite(s)) return '';
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.round(s % 60)).padStart(2, '0')}`;
}
