/**
 * Time utilities. All times are seconds (float). Pixel conversions use a zoom
 * expressed as pixels-per-second (the store's `zoom`).
 */

/** Tolerance for comparing times (seconds). Two edges closer than this are "touching". */
export const TIME_EPSILON = 1e-6;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Seconds -> nearest frame index. */
export function secondsToFrames(seconds: number, fps: number): number {
  return Math.round(seconds * fps + 1e-9);
}

/** Frame index -> seconds. */
export function framesToSeconds(frames: number, fps: number): number {
  return frames / fps;
}

/** Rounds a time to the nearest frame boundary. */
export function snapToFrame(seconds: number, fps: number): number {
  return framesToSeconds(secondsToFrames(seconds, fps), fps);
}

/** Duration of one frame, seconds. */
export function frameDuration(fps: number): number {
  return 1 / fps;
}

/**
 * Formats as SMPTE-like timecode `HH:MM:SS:FF` (non-drop-frame).
 * Negative values are clamped to 0.
 */
export function formatTimecode(seconds: number, fps: number): string {
  const totalFrames = secondsToFrames(Math.max(0, seconds), fps);
  const fpsInt = Math.max(1, Math.round(fps));
  const ff = totalFrames % fpsInt;
  const totalSeconds = Math.floor(totalFrames / fpsInt);
  const ss = totalSeconds % 60;
  const mm = Math.floor(totalSeconds / 60) % 60;
  const hh = Math.floor(totalSeconds / 3600);
  return [hh, mm, ss, ff].map((n) => String(n).padStart(2, '0')).join(':');
}

/** Parses `HH:MM:SS:FF` (or `MM:SS:FF`) back to seconds. Returns NaN on bad input. */
export function parseTimecode(text: string, fps: number): number {
  const parts = text.trim().split(':').map((p) => Number(p));
  if (parts.length < 2 || parts.length > 4 || parts.some((n) => !Number.isFinite(n) || n < 0)) return NaN;
  while (parts.length < 4) parts.unshift(0);
  const [hh, mm, ss, ff] = parts as [number, number, number, number];
  return hh * 3600 + mm * 60 + ss + ff / fps;
}

/** Human-friendly short duration: `m:ss.d` (e.g. "1:05.3") or `h:mm:ss` for >= 1h. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(Math.floor(sec)).padStart(2, '0')}`;
  const tenths = Math.floor(sec * 10 + 1e-9) / 10;
  return `${m}:${tenths.toFixed(1).padStart(4, '0')}`;
}

/** Timeline seconds -> pixels at the given zoom (pixels per second). */
export function timeToPx(seconds: number, pxPerSecond: number): number {
  return seconds * pxPerSecond;
}

/** Pixels -> timeline seconds at the given zoom (pixels per second). */
export function pxToTime(px: number, pxPerSecond: number): number {
  return px / pxPerSecond;
}

export interface SnapResult {
  /** The (possibly) snapped time. */
  time: number;
  /** The candidate that was snapped to, or null if none was within threshold. */
  snappedTo: number | null;
}

/**
 * Snaps `time` to the closest of `candidates` if it is within `threshold`
 * seconds (tip: threshold = pxToTime(8, zoom) for an 8px magnet).
 */
export function snapTime(time: number, candidates: readonly number[], threshold: number): SnapResult {
  let best: number | null = null;
  let bestDist = threshold;
  for (const c of candidates) {
    const d = Math.abs(c - time);
    if (d <= bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best === null ? { time, snappedTo: null } : { time: best, snappedTo: best };
}

/**
 * Snaps an interval of fixed `length` starting at `start`: whichever of its two
 * edges is closest to a candidate wins. Returns the new start.
 */
export function snapInterval(
  start: number,
  length: number,
  candidates: readonly number[],
  threshold: number,
): SnapResult {
  const a = snapTime(start, candidates, threshold);
  const b = snapTime(start + length, candidates, threshold);
  const da = a.snappedTo === null ? Infinity : Math.abs(a.snappedTo - start);
  const db = b.snappedTo === null ? Infinity : Math.abs(b.snappedTo - (start + length));
  if (da === Infinity && db === Infinity) return { time: start, snappedTo: null };
  return da <= db ? { time: a.time, snappedTo: a.snappedTo } : { time: b.time - length, snappedTo: b.snappedTo };
}

/** Sorts and merges overlapping/touching ranges; drops empty/invalid ones. */
export function normalizeRanges(ranges: readonly { start: number; end: number }[]): { start: number; end: number }[] {
  const sorted = ranges
    .map((r) => ({ start: Math.max(0, Math.min(r.start, r.end)), end: Math.max(r.start, r.end) }))
    .filter((r) => r.end - r.start > TIME_EPSILON)
    .sort((a, b) => a.start - b.start);
  const out: { start: number; end: number }[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end + TIME_EPSILON) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

/** Picks "nice" ruler tick spacing (seconds) so that major ticks are >= minPx apart. */
export function rulerStep(pxPerSecond: number, minPx = 80): number {
  const steps = [1 / 30, 1 / 10, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
  for (const s of steps) if (s * pxPerSecond >= minPx) return s;
  return steps[steps.length - 1]!;
}
