/**
 * Offline audio mixing. `planAudioMix` is the pure scheduling math (which
 * clip plays when, from which source offset, at which rate, with which gain
 * envelope); `renderAudioMix` executes a plan on an OfflineAudioContext.
 */
import { clipEnd, clipGainAt, getTrack, isMediaClip, type MediaAsset, type MediaClip, type Project, type Track } from '../core';
import { elementRate, isAudible, sourceTimeAt } from './timeline';

export interface GainPoint {
  /** Output time, seconds from the start of the mix. */
  time: number;
  value: number;
}

export interface AudioSchedule {
  clipId: string;
  assetId: string;
  /** Output time at which the clip starts sounding (seconds from mix start). */
  when: number;
  /** Source (file) offset at `when`, seconds. */
  offset: number;
  /** Output duration, seconds. */
  duration: number;
  playbackRate: number;
  /**
   * Gain envelope: exact piecewise-linear representation of
   * volume x fades (`setValueAtTime(first)` then `linearRampToValueAtTime`).
   */
  gains: GainPoint[];
}

const EPS = 1e-6;

/** Breakpoints of the piecewise-linear gain of a clip inside local range [la, lb]. */
export function gainBreakpoints(clip: Pick<MediaClip, 'duration' | 'fadeIn' | 'fadeOut'>, la: number, lb: number): number[] {
  const pts = [la, lb];
  const d = clip.duration;
  if (clip.fadeIn > 0) pts.push(clip.fadeIn);
  if (clip.fadeOut > 0) pts.push(d - clip.fadeOut);
  // Where the fade-in and fade-out ramps cross (min() kink when they overlap).
  if (clip.fadeIn > 0 && clip.fadeOut > 0 && clip.fadeIn + clip.fadeOut > d) pts.push((d * clip.fadeIn) / (clip.fadeIn + clip.fadeOut));
  const inRange = pts.filter((p) => p >= la - EPS && p <= lb + EPS).map((p) => Math.min(lb, Math.max(la, p)));
  inRange.sort((a, b) => a - b);
  const out: number[] = [];
  for (const p of inRange) if (out.length === 0 || p - out[out.length - 1]! > EPS) out.push(p);
  return out;
}

/** Schedules every audible clip overlapping [start, end). */
export function planAudioMix(project: Project, start: number, end: number): AudioSchedule[] {
  const out: AudioSchedule[] = [];
  if (!(end > start)) return out;
  for (const clip of Object.values(project.clips)) {
    if (!isMediaClip(clip)) continue;
    const track: Track | undefined = getTrack(project, clip.trackId);
    if (!track || !isAudible(project, clip, track)) continue;
    const asset = project.assets[clip.assetId];
    if (!asset || asset.kind === 'image') continue;
    const a = Math.max(start, clip.start);
    const b = Math.min(end, clipEnd(clip));
    if (b - a <= EPS) continue;
    const la = a - clip.start;
    const lb = b - clip.start;
    const gains = gainBreakpoints(clip, la, lb).map((l) => ({ time: clip.start + l - start, value: clipGainAt(clip, l, track) }));
    if (gains.every((g) => g.value <= 0)) continue;
    out.push({
      clipId: clip.id,
      assetId: clip.assetId,
      when: a - start,
      offset: sourceTimeAt(clip, a),
      duration: b - a,
      playbackRate: elementRate(clip.speed),
      gains,
    });
  }
  return out.sort((x, y) => x.when - y.when);
}

/** Decoder used by `renderAudioMix` (cached by the engine). Null = undecodable. */
export type DecodeAsset = (asset: MediaAsset, ctx: BaseAudioContext) => Promise<AudioBuffer | null>;

/**
 * Renders a mix plan. Always returns a buffer of exactly
 * `max(1, ceil((end - start) * sampleRate))` frames (silence if nothing is audible).
 */
export async function renderAudioMix(
  project: Project,
  opts: { start: number; end: number; sampleRate: number; channels: number },
  createContext: (channels: number, length: number, sampleRate: number) => OfflineAudioContext,
  decode: DecodeAsset,
): Promise<AudioBuffer> {
  const channels = Math.max(1, Math.min(32, Math.round(opts.channels || 2)));
  const sampleRate = opts.sampleRate > 0 ? opts.sampleRate : 48000;
  const length = Math.max(1, Math.ceil(Math.max(0, opts.end - opts.start) * sampleRate));
  const ctx = createContext(channels, length, sampleRate);
  const plan = planAudioMix(project, opts.start, opts.end);
  if (plan.length === 0) return ctx.createBuffer(channels, length, sampleRate);

  const buffers = new Map<string, AudioBuffer | null>();
  for (const s of plan) {
    if (!buffers.has(s.assetId)) {
      const asset = project.assets[s.assetId];
      buffers.set(s.assetId, asset ? await decode(asset, ctx).catch(() => null) : null);
    }
  }
  let scheduled = 0;
  for (const s of plan) {
    const buffer = buffers.get(s.assetId);
    if (!buffer || s.offset >= buffer.duration) continue;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = s.playbackRate;
    const gain = ctx.createGain();
    const [first, ...rest] = s.gains;
    gain.gain.setValueAtTime(first!.value, first!.time);
    for (const g of rest) gain.gain.linearRampToValueAtTime(g.value, g.time);
    src.connect(gain);
    gain.connect(ctx.destination);
    try {
      src.start(s.when, s.offset);
      src.stop(s.when + s.duration);
      scheduled++;
    } catch {
      /* invalid offset for this buffer */
    }
  }
  if (scheduled === 0) return ctx.createBuffer(channels, length, sampleRate);
  return ctx.startRendering();
}
