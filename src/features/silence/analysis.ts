/**
 * Pure silence-analysis core (no DOM, no store): safe to run in a worker and
 * unit-test directly.
 *
 * Pipeline
 * 1. `computeLevels`: windowed RMS level (dBFS) over non-overlapping windows.
 * 2. `estimateThreshold`: optional automatic threshold from the noise floor
 *    (10th percentile of window levels) and the speech level (95th percentile).
 * 3. `findActiveRanges`: classification with hysteresis -> "loud" ranges.
 * 4. `refineSilences`: candidate silences -> min duration, padding kept around
 *    speech, min-keep merging of tiny speech slivers.
 *
 * `detectSilence` composes all four for one signal (times relative to the
 * signal start). The timeline layer (`timelineSilence.ts`) composes 3 and 4
 * across clips instead.
 */
import type { TimeRange } from '../../core';

export interface SilenceParams {
  /** Fixed threshold in dBFS (window RMS below it is silence). Ignored when `autoThreshold`. */
  thresholdDb: number;
  /** Estimate the threshold from the signal's noise floor instead. */
  autoThreshold: boolean;
  /** Minimum length of a silence to remove, ms (measured before padding). */
  minSilenceMs: number;
  /** Audio kept on each side of speech (shrinks each silence edge that touches speech), ms. */
  paddingMs: number;
  /** RMS analysis window, ms. */
  windowMs: number;
  /** Speech segments (between two silences) shorter than this are removed too. 0 = off. */
  minKeepMs: number;
  /** Hysteresis band in dB around the threshold. */
  hysteresisDb: number;
}

export const DEFAULT_SILENCE_PARAMS: SilenceParams = {
  thresholdDb: -35,
  autoThreshold: false,
  minSilenceMs: 500,
  paddingMs: 100,
  windowMs: 20,
  minKeepMs: 0,
  hysteresisDb: 4,
};

/** Level reported for digital silence. */
export const FLOOR_DB = -120;
/** Margin above the estimated noise floor used by the automatic threshold. */
export const AUTO_MARGIN_DB = 10;
/** Below this dynamic range (speech - floor) the auto threshold reports "no silence". */
export const MIN_DYNAMIC_RANGE_DB = 12;

export interface ProgressHooks {
  /** Called with 0..1 now and then. */
  onProgress?: (fraction: number) => void;
  /** Return true to abort; the function then throws an `AbortError`-named Error. */
  shouldAbort?: () => boolean;
}

export function abortError(): Error {
  const e = new Error('Aborted');
  e.name = 'AbortError';
  return e;
}

export function windowSize(sampleRate: number, windowMs: number): number {
  return Math.max(1, Math.round((sampleRate * Math.max(1, windowMs)) / 1000));
}

/** Window RMS levels in dBFS (one value per window; the last partial window counts). */
export function computeLevels(
  samples: Float32Array,
  sampleRate: number,
  windowMs: number,
  hooks: ProgressHooks = {},
): Float32Array {
  const win = windowSize(sampleRate, windowMs);
  const n = Math.ceil(samples.length / win);
  const out = new Float32Array(n);
  const reportEvery = Math.max(1, Math.floor(n / 50));
  for (let w = 0; w < n; w++) {
    const a = w * win;
    const b = Math.min(samples.length, a + win);
    let sum = 0;
    for (let i = a; i < b; i++) {
      const v = samples[i]!;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / Math.max(1, b - a));
    out[w] = rms > 1e-6 ? Math.max(FLOOR_DB, 20 * Math.log10(rms)) : FLOOR_DB;
    if (w % reportEvery === 0) {
      if (hooks.shouldAbort?.()) throw abortError();
      hooks.onProgress?.(w / n);
    }
  }
  hooks.onProgress?.(1);
  return out;
}

function percentile(sorted: Float32Array, p: number): number {
  if (sorted.length === 0) return FLOOR_DB;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[idx]!;
}

export interface ThresholdEstimate {
  /** Estimated noise floor (10th percentile of window levels), dBFS. */
  floorDb: number;
  /** Estimated speech level (95th percentile), dBFS. */
  speechDb: number;
  /**
   * Threshold to use: `min(floor + AUTO_MARGIN_DB, midpoint(floor, speech))`.
   * If the signal has less than MIN_DYNAMIC_RANGE_DB of dynamic range, it is
   * either all quiet (speech < -60 dBFS -> threshold just above it, all silent)
   * or all loud (threshold below the floor, nothing silent).
   */
  thresholdDb: number;
}

export function estimateThreshold(levelsDb: Float32Array): ThresholdEstimate {
  const sorted = Float32Array.from(levelsDb).sort();
  const floorDb = percentile(sorted, 0.1);
  const speechDb = percentile(sorted, 0.95);
  let thresholdDb: number;
  if (speechDb - floorDb < MIN_DYNAMIC_RANGE_DB) {
    thresholdDb = speechDb < -60 ? speechDb + AUTO_MARGIN_DB : floorDb - AUTO_MARGIN_DB;
  } else {
    thresholdDb = Math.min(floorDb + AUTO_MARGIN_DB, (floorDb + speechDb) / 2);
  }
  return { floorDb, speechDb, thresholdDb };
}

/**
 * Classifies windows with hysteresis and returns the "loud" (active) ranges in
 * seconds. A window turns loud above `threshold + h/2`, turns quiet below
 * `threshold - h/2` and otherwise keeps the previous state; the first window
 * is classified against the plain threshold.
 */
export function findActiveRanges(
  levelsDb: Float32Array,
  windowSec: number,
  thresholdDb: number,
  hysteresisDb: number,
  totalSec: number,
): TimeRange[] {
  const hi = thresholdDb + Math.max(0, hysteresisDb) / 2;
  const lo = thresholdDb - Math.max(0, hysteresisDb) / 2;
  const out: TimeRange[] = [];
  let loud = false;
  let runStart = 0;
  for (let w = 0; w < levelsDb.length; w++) {
    const v = levelsDb[w]!;
    const next: boolean = w === 0 ? v >= thresholdDb : loud ? v >= lo : v > hi;
    if (next && !loud) runStart = w;
    if (!next && loud) out.push({ start: runStart * windowSec, end: Math.min(totalSec, w * windowSec) });
    loud = next;
  }
  if (loud) out.push({ start: runStart * windowSec, end: totalSec });
  return out;
}

/** `[bounds.start, bounds.end]` minus `ranges` (both normalized). */
export function complementRanges(ranges: readonly TimeRange[], bounds: TimeRange): TimeRange[] {
  const out: TimeRange[] = [];
  let cursor = bounds.start;
  for (const r of mergeRanges(ranges)) {
    if (r.end <= cursor) continue;
    if (r.start >= bounds.end) break;
    if (r.start > cursor) out.push({ start: cursor, end: Math.min(r.start, bounds.end) });
    cursor = Math.max(cursor, r.end);
  }
  if (cursor < bounds.end) out.push({ start: cursor, end: bounds.end });
  return out;
}

const EPS = 1e-6;

/** Sorts and merges overlapping/touching ranges (keeps negative times; drops empties). */
export function mergeRanges(ranges: readonly TimeRange[]): TimeRange[] {
  const sorted = ranges.filter((r) => r.end - r.start > EPS).map((r) => ({ ...r })).sort((a, b) => a.start - b.start);
  const out: TimeRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end + EPS) last.end = Math.max(last.end, r.end);
    else out.push(r);
  }
  return out;
}

/** Intersection of two range lists. */
export function intersectRanges(a: readonly TimeRange[], b: readonly TimeRange[]): TimeRange[] {
  const A = mergeRanges(a);
  const B = mergeRanges(b);
  const out: TimeRange[] = [];
  let i = 0;
  let j = 0;
  while (i < A.length && j < B.length) {
    const s = Math.max(A[i]!.start, B[j]!.start);
    const e = Math.min(A[i]!.end, B[j]!.end);
    if (e - s > EPS) out.push({ start: s, end: e });
    if (A[i]!.end < B[j]!.end) i++;
    else j++;
  }
  return out;
}

export interface RefineOptions {
  minSilenceSec: number;
  paddingSec: number;
  minKeepSec: number;
  /**
   * Ranges that contain audible content. A silence edge is padded only when
   * it touches one of these (edges at the timeline start/end or at a stretch
   * that is not analysed are not padded).
   */
  loud: readonly TimeRange[];
  /**
   * Where merging across a short speech sliver is allowed: the sliver must lie
   * completely inside `mergeable` (defaults to everywhere).
   */
  mergeable?: readonly TimeRange[];
}

/** Drop silences shorter than this after padding (seconds). */
export const MIN_RESULT_SEC = 0.01;

function touches(t: number, ranges: readonly TimeRange[], tol: number): boolean {
  return ranges.some((r) => Math.abs(r.start - t) <= tol || Math.abs(r.end - t) <= tol);
}

function inside(r: TimeRange, ranges: readonly TimeRange[]): boolean {
  return ranges.some((m) => m.start <= r.start + EPS && m.end >= r.end - EPS);
}

/**
 * Turns raw silence candidates into removable ranges:
 * 1. merge touching candidates; drop those shorter than `minSilenceSec`;
 * 2. shrink each edge that touches loud content by `paddingSec`;
 * 3. if `minKeepSec > 0`, a speech sliver between two silences shorter than
 *    `minKeepSec` (measured after padding) is removed by merging the two;
 * 4. drop results shorter than MIN_RESULT_SEC.
 */
export function refineSilences(candidates: readonly TimeRange[], opts: RefineOptions): TimeRange[] {
  const tol = 1e-4;
  const loud = mergeRanges(opts.loud);
  let rs = mergeRanges(candidates).filter((r) => r.end - r.start >= opts.minSilenceSec - EPS);
  rs = rs
    .map((r) => ({
      start: touches(r.start, loud, tol) ? r.start + opts.paddingSec : r.start,
      end: touches(r.end, loud, tol) ? r.end - opts.paddingSec : r.end,
    }))
    .filter((r) => r.end - r.start >= MIN_RESULT_SEC);
  if (opts.minKeepSec > 0 && rs.length > 1) {
    const merged: TimeRange[] = [{ ...rs[0]! }];
    for (let i = 1; i < rs.length; i++) {
      const last = merged[merged.length - 1]!;
      const r = rs[i]!;
      const gap = { start: last.end, end: r.start };
      const ok = gap.end - gap.start < opts.minKeepSec && (!opts.mergeable || inside(gap, opts.mergeable));
      if (ok) last.end = r.end;
      else merged.push({ ...r });
    }
    rs = merged;
  }
  return rs;
}

export interface SignalAnalysis {
  /** Loud ranges, seconds from the signal start. */
  active: TimeRange[];
  thresholdDb: number;
  floorDb: number | null;
  speechDb: number | null;
  durationSec: number;
}

/** Steps 1-3 for one signal (what the worker runs). */
export function analyzeSignal(
  samples: Float32Array,
  sampleRate: number,
  params: Pick<SilenceParams, 'windowMs' | 'thresholdDb' | 'autoThreshold' | 'hysteresisDb'>,
  hooks: ProgressHooks = {},
): SignalAnalysis {
  const durationSec = samples.length / sampleRate;
  const levels = computeLevels(samples, sampleRate, params.windowMs, hooks);
  const windowSec = windowSize(sampleRate, params.windowMs) / sampleRate;
  let thresholdDb = params.thresholdDb;
  let floorDb: number | null = null;
  let speechDb: number | null = null;
  if (params.autoThreshold) {
    const est = estimateThreshold(levels);
    thresholdDb = est.thresholdDb;
    floorDb = est.floorDb;
    speechDb = est.speechDb;
  }
  const active = findActiveRanges(levels, windowSec, thresholdDb, params.hysteresisDb, durationSec);
  return { active, thresholdDb, floorDb, speechDb, durationSec };
}

export interface SilenceDetection extends SignalAnalysis {
  /** Removable silences, seconds from the signal start. */
  silences: TimeRange[];
}

/** Full detection for a single mono signal. */
export function detectSilence(
  samples: Float32Array,
  sampleRate: number,
  params: Partial<SilenceParams> = {},
  hooks: ProgressHooks = {},
): SilenceDetection {
  const p = { ...DEFAULT_SILENCE_PARAMS, ...params };
  const a = analyzeSignal(samples, sampleRate, p, hooks);
  const silences = refineSilences(complementRanges(a.active, { start: 0, end: a.durationSec }), {
    minSilenceSec: p.minSilenceMs / 1000,
    paddingSec: p.paddingMs / 1000,
    minKeepSec: p.minKeepMs / 1000,
    loud: a.active,
  });
  return { ...a, silences };
}

/** Averages all channels into one mono signal. */
export function downmix(channels: readonly Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0]!;
  const n = channels[0]!.length;
  const out = new Float32Array(n);
  for (const ch of channels) for (let i = 0; i < n; i++) out[i]! += ch[i]!;
  const k = 1 / channels.length;
  for (let i = 0; i < n; i++) out[i]! *= k;
  return out;
}
