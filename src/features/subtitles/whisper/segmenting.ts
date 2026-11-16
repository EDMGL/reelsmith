/**
 * Pure helpers for Whisper auto-captions (no transformers.js import, unit-testable).
 *
 * - `planChunks`: Whisper sees at most 30 s of audio at a time. Long audio is
 *   cut into <= `maxSec` chunks, each cut placed at the quietest point of the
 *   allowed range so words are not split across chunks.
 * - `segmentsToCues`: Whisper's timestamped segments can be a whole sentence
 *   long; they are split into short, reels-friendly cues with timing spread
 *   proportionally to character count.
 */
import type { Cue } from '../formats';

export interface ChunkPlanOptions {
  /** Hard upper bound of a chunk, seconds (Whisper's window is 30 s). */
  maxSec?: number;
  /** A cut is never placed before this many seconds into a chunk. */
  minSec?: number;
  /** Energy window used to find quiet cut points, ms. */
  windowMs?: number;
}

export interface Chunk {
  /** Sample indices, [start, end). */
  start: number;
  end: number;
}

function rms(samples: Float32Array, start: number, end: number): number {
  let sum = 0;
  for (let i = start; i < end; i++) sum += samples[i] * samples[i];
  return end > start ? Math.sqrt(sum / (end - start)) : 0;
}

export function planChunks(samples: Float32Array, sampleRate: number, opts: ChunkPlanOptions = {}): Chunk[] {
  const maxLen = Math.floor((opts.maxSec ?? 28) * sampleRate);
  const minLen = Math.floor((opts.minSec ?? 18) * sampleRate);
  const win = Math.max(1, Math.floor(((opts.windowMs ?? 100) / 1000) * sampleRate));
  const hop = Math.max(1, Math.floor(win / 2));
  const chunks: Chunk[] = [];
  let start = 0;
  while (start < samples.length) {
    if (samples.length - start <= maxLen) {
      chunks.push({ start, end: samples.length });
      break;
    }
    let bestCut = start + maxLen;
    let bestLevel = Infinity;
    for (let w = start + minLen; w + win <= start + maxLen; w += hop) {
      const level = rms(samples, w, w + win);
      if (level < bestLevel) {
        bestLevel = level;
        bestCut = w + Math.floor(win / 2);
      }
    }
    chunks.push({ start, end: bestCut });
    start = bestCut;
  }
  return chunks;
}

/** Root-mean-square level of a sample range in dBFS (-Infinity for digital silence). */
export function levelDb(samples: Float32Array, start = 0, end = samples.length): number {
  return 20 * Math.log10(rms(samples, start, end));
}

export interface WhisperSegment {
  /** Seconds relative to the chunk start. */
  start: number;
  /** Seconds relative to the chunk start; null when Whisper did not close the segment. */
  end: number | null;
  text: string;
}

export interface CueSplitOptions {
  /** Max characters per cue. */
  maxChars?: number;
  /** Max cue duration, seconds. */
  maxDur?: number;
}

/** Well-known Whisper hallucinations on silence / music (matched on the whole, trimmed segment). */
const HALLUCINATIONS = [
  /^altyaz[ıi]\s*m\.?\s*k\.?$/i,
  /^(subtitles|captions)\s+by\b.*$/i,
  /^[\s\p{P}\p{S}♪]*$/u,
];

export function isHallucination(text: string): boolean {
  const t = text.trim();
  return HALLUCINATIONS.some((re) => re.test(t));
}

/** Splits `words` into groups of at most `maxChars` characters (a single long word stays whole). */
function groupWords(words: string[], maxChars: number): string[] {
  const groups: string[] = [];
  let cur = '';
  for (const w of words) {
    if (cur && cur.length + 1 + w.length > maxChars) {
      groups.push(cur);
      cur = w;
    } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) groups.push(cur);
  return groups;
}

/**
 * Converts one chunk's segments to absolute-time cues.
 * `chunkStart`/`chunkEnd` are absolute seconds of the chunk on the timeline.
 */
export function segmentsToCues(segments: readonly WhisperSegment[], chunkStart: number, chunkEnd: number, opts: CueSplitOptions = {}): Cue[] {
  const maxChars = opts.maxChars ?? 42;
  const maxDur = opts.maxDur ?? 5;
  const chunkLen = chunkEnd - chunkStart;
  const out: Cue[] = [];
  segments.forEach((seg, i) => {
    const text = seg.text.replace(/\s+/g, ' ').trim();
    if (!text || isHallucination(text)) return;
    const s = Math.min(Math.max(0, seg.start), chunkLen);
    const fallbackEnd = segments[i + 1]?.start ?? chunkLen;
    const e = Math.min(Math.max(seg.end ?? fallbackEnd, s), chunkLen);
    if (e - s < 0.05) return;
    const dur = e - s;
    const minGroups = Math.ceil(dur / maxDur);
    const groups = groupWords(text.split(' '), Math.max(8, Math.min(maxChars, Math.ceil(text.length / minGroups))));
    const total = groups.reduce((n, g) => n + g.length, 0);
    let t = s;
    for (const g of groups) {
      const d = (dur * g.length) / total;
      out.push({ start: chunkStart + t, end: chunkStart + t + d, text: g });
      t += d;
    }
  });
  return out;
}

export interface TimedWord {
  text: string;
  /** Seconds relative to the chunk start. */
  start: number;
  end: number | null;
}

export interface WordCueOptions {
  /** Max characters per cue (short cues read better with word highlighting). */
  maxChars?: number;
  /** Max cue duration, seconds. */
  maxDur?: number;
  /** A pause longer than this starts a new cue, seconds. */
  maxGap?: number;
}

const SENTENCE_END = /[.!?…]["')\]]*$/;
const PUNCT_ONLY = /^[\p{P}\p{S}]+$/u;

/**
 * Groups word-level timestamps into short cues, breaking at pauses, sentence
 * ends, `maxChars` and `maxDur`. Each cue keeps its words (absolute times) for
 * word-by-word highlighting.
 */
export function wordsToCues(input: readonly TimedWord[], chunkStart: number, chunkEnd: number, opts: WordCueOptions = {}): Cue[] {
  const maxChars = opts.maxChars ?? 32;
  const maxDur = opts.maxDur ?? 4;
  const maxGap = opts.maxGap ?? 0.6;
  const chunkLen = chunkEnd - chunkStart;
  // Clean: trim, glue punctuation-only tokens to the previous word, close open ends.
  const words: { text: string; start: number; end: number }[] = [];
  input.forEach((w, i) => {
    const text = w.text.replace(/\s+/g, ' ').trim();
    if (!text) return;
    const start = Math.min(Math.max(0, w.start), chunkLen);
    const nextStart = input[i + 1]?.start ?? chunkLen;
    let end = w.end ?? Math.min(start + 0.4, nextStart);
    end = Math.min(Math.max(end, start), chunkLen);
    const prev = words[words.length - 1];
    if (prev && PUNCT_ONLY.test(text)) {
      prev.text += text;
      prev.end = Math.max(prev.end, end);
      return;
    }
    words.push({ text, start, end });
  });
  const cues: Cue[] = [];
  let cur: typeof words = [];
  const flush = () => {
    if (cur.length === 0) return;
    const text = cur.map((w) => w.text).join(' ');
    if (!isHallucination(text)) {
      const first = cur[0]!;
      const last = cur[cur.length - 1]!;
      cues.push({
        start: chunkStart + first.start,
        end: chunkStart + Math.max(last.end, first.start + 0.2),
        text,
        words: cur.map((w) => ({ text: w.text, start: chunkStart + w.start, end: chunkStart + w.end })),
      });
    }
    cur = [];
  };
  for (const w of words) {
    if (cur.length > 0) {
      const curText = cur.map((x) => x.text).join(' ');
      const last = cur[cur.length - 1]!;
      const tooLong = curText.length + 1 + w.text.length > maxChars;
      const tooSlow = w.end - cur[0]!.start > maxDur;
      const pause = w.start - last.end > maxGap;
      const sentence = SENTENCE_END.test(last.text) && curText.length >= 12;
      if (tooLong || tooSlow || pause || sentence) flush();
    }
    cur.push(w);
  }
  flush();
  return cues;
}

/** Sorts cues, rounds to ms and trims overlaps (an earlier cue ends where the next starts). */
export function normalizeCues(cues: readonly Cue[], minDur = 0.2): Cue[] {
  const r = (x: number) => Math.round(x * 1000) / 1000;
  const sorted = [...cues]
    .map((c) => ({ start: r(c.start), end: r(c.end), text: c.text, ...(c.words ? { words: c.words.map((w) => ({ text: w.text, start: r(w.start), end: r(w.end) })) } : {}) }))
    .sort((a, b) => a.start - b.start);
  const out: Cue[] = [];
  for (const c of sorted) {
    const prev = out[out.length - 1];
    if (prev && prev.end > c.start) prev.end = c.start;
    if (prev && prev.end - prev.start < minDur) out.pop();
    if (c.end - c.start >= minDur) out.push(c);
  }
  return out;
}
