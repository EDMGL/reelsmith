/** Pure cue arithmetic (shift, split, merge, overlap resolution). Seconds everywhere. */
import type { Cue } from './formats';

const EPS = 1e-6;
const roundMs = (s: number) => Math.round(s * 1000) / 1000;

/**
 * Clamps a shift so the earliest affected cue does not start before 0
 * (same rule as the store's `moveClips`).
 */
export function clampShift(cues: readonly Pick<Cue, 'start'>[], delta: number): number {
  if (cues.length === 0) return 0;
  const minStart = Math.min(...cues.map((c) => c.start));
  return Math.max(delta, -minStart);
}

/** Shifts the cues at `indices` (default all) by `delta` seconds (clamped at 0). */
export function shiftCues(cues: readonly Cue[], delta: number, indices?: readonly number[]): Cue[] {
  const sel = new Set(indices ?? cues.map((_, i) => i));
  const d = clampShift(cues.filter((_, i) => sel.has(i)), delta);
  return cues.map((c, i) => (sel.has(i) ? { ...c, start: roundMs(c.start + d), end: roundMs(c.end + d) } : c));
}

/**
 * Splits text into two parts at the word boundary closest to `ratio` of its
 * length. Single-word text is duplicated (both halves keep it).
 */
export function splitCueText(text: string, ratio: number): [string, string] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return [text, text];
  const total = words.join(' ').length;
  const target = Math.min(1, Math.max(0, ratio)) * total;
  let best = 1;
  let bestD = Infinity;
  let len = 0;
  for (let k = 1; k < words.length; k++) {
    len += words[k - 1]!.length + (k > 1 ? 1 : 0);
    const d = Math.abs(len - target);
    if (d < bestD - EPS) {
      bestD = d;
      best = k;
    }
  }
  return [words.slice(0, best).join(' '), words.slice(best).join(' ')];
}

/** Splits a cue at time `t` (must leave at least `minDur` on both sides). */
export function splitCue(cue: Cue, t: number, minDur = 0.05): [Cue, Cue] | null {
  if (t - cue.start < minDur - EPS || cue.end - t < minDur - EPS) return null;
  const [a, b] = splitCueText(cue.text, (t - cue.start) / (cue.end - cue.start));
  return [
    { start: cue.start, end: t, text: a },
    { start: t, end: cue.end, text: b },
  ];
}

/** Merges two cues into one spanning both, texts joined by a line break (earlier first). */
export function mergeCues(a: Cue, b: Cue): Cue {
  const [x, y] = a.start <= b.start ? [a, b] : [b, a];
  return { start: Math.min(x.start, y.start), end: Math.max(x.end, y.end), text: `${x.text}\n${y.text}` };
}

export interface OverlapReport {
  placed: Cue[];
  /** Number of cues shortened to fit. */
  trimmed: number;
  /** Number of cues dropped (no room left, or shorter than `minDur`). */
  skipped: number;
}

/**
 * Makes imported cues fit on a track without overlaps (core rejects overlapping
 * clips). Deterministic rule, applied in (start, end, input index) order:
 * - an occupant (existing clip or an already placed cue) covering the cue's
 *   start pushes the start to the occupant's end;
 * - an occupant starting inside the cue cuts the cue's end at that start;
 * - what remains must be at least `minDur` long, else the cue is skipped.
 */
export function resolveOverlaps(cues: readonly Cue[], occupied: readonly { start: number; end: number }[], minDur = 0.05): OverlapReport {
  const busy = occupied.map((o) => ({ start: o.start, end: o.end }));
  const order = cues.map((c, i) => ({ c, i })).sort((a, b) => a.c.start - b.c.start || a.c.end - b.c.end || a.i - b.i);
  const placed: Cue[] = [];
  let trimmed = 0;
  let skipped = 0;
  for (const { c } of order) {
    let s = c.start;
    let e = c.end;
    let changed = true;
    while (changed && e - s > EPS) {
      changed = false;
      for (const o of busy) {
        if (o.end <= s + EPS || o.start >= e - EPS) continue; // no overlap
        if (o.start <= s + EPS) s = o.end;
        else e = o.start;
        changed = true;
      }
    }
    if (e - s < minDur - EPS) {
      skipped++;
      continue;
    }
    if (Math.abs(s - c.start) > EPS || Math.abs(e - c.end) > EPS) trimmed++;
    // No rounding here: trimmed edges must coincide exactly with the occupant's edge.
    const cue = { start: s, end: e, text: c.text };
    placed.push(cue);
    busy.push({ start: cue.start, end: cue.end });
  }
  return { placed, trimmed, skipped };
}
