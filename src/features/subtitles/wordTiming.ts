/**
 * Word timing for word-highlighted subtitles (pure).
 *
 * A subtitle's words come from its text (whitespace separated). Real timings
 * come from speech recognition (`SubtitleClip.words`, relative to the clip
 * start); they are used when they match the text word-for-word in count, so
 * fixing a typo keeps them. Otherwise (manual / imported cues, edited text)
 * timings are estimated proportionally to word length.
 */
import type { SubtitleClip, WordTiming } from '../../core';

export function tokenize(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

/** Spreads `duration` over the words, proportionally to their length (+1 for the gap). */
export function estimateWordTimes(words: readonly string[], duration: number): { start: number; end: number }[] {
  const weights = words.map((w) => Array.from(w).length + 1);
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let t = 0;
  return weights.map((w) => {
    const d = (duration * w) / total;
    const r = { start: t, end: t + d };
    t += d;
    return r;
  });
}

/** Word timings to use for rendering `clip` (always one entry per token of `clip.text`). */
export function resolveWordTimes(clip: Pick<SubtitleClip, 'text' | 'duration' | 'words'>): WordTiming[] {
  const tokens = tokenize(clip.text);
  const words = clip.words;
  if (words && words.length === tokens.length && words.every((w, i) => Number.isFinite(w.start) && Number.isFinite(w.end) && (i === 0 || w.start >= words[i - 1]!.start - 1e-6))) {
    return tokens.map((text, i) => ({ text, start: words[i]!.start, end: Math.max(words[i]!.start, words[i]!.end) }));
  }
  return estimateWordTimes(tokens, clip.duration).map((t, i) => ({ text: tokens[i]!, ...t }));
}

/**
 * Index of the active word at `t` (seconds since clip start): the last word
 * that has started (it stays lit through the pause before the next one).
 * -1 before the first word.
 */
export function activeWordIndex(times: readonly { start: number }[], t: number): number {
  let idx = -1;
  for (let i = 0; i < times.length; i++) {
    if (times[i]!.start <= t + 1e-6) idx = i;
    else break;
  }
  return idx;
}

/** 0..1 progress through word `i` at `t` (karaoke fill). */
export function wordProgress(w: { start: number; end: number }, t: number): number {
  if (w.end <= w.start) return t >= w.start ? 1 : 0;
  return Math.min(1, Math.max(0, (t - w.start) / (w.end - w.start)));
}

/**
 * Maps the pieces of wrapped lines back to word indices. `wrapText` joins words
 * with single spaces and may break an over-long word into several pieces; all
 * pieces of a word get that word's index.
 */
export function mapLinePieces(lines: readonly string[], tokens: readonly string[]): number[][] {
  let k = 0;
  let acc = '';
  return lines.map((line) =>
    (line ? line.split(' ') : []).map((piece) => {
      const idx = Math.min(k, tokens.length - 1);
      acc += piece;
      if (k < tokens.length && acc.length >= tokens[k]!.length) {
        k++;
        acc = '';
      }
      return idx;
    }),
  );
}

/** Shifts word timings so they stay on the same audio when a clip's start moves by `delta` (newStart - oldStart). */
export function rebaseWords(words: readonly WordTiming[] | undefined, delta: number): WordTiming[] | undefined {
  if (!words) return undefined;
  const ms = (x: number) => Math.round(x * 1000) / 1000;
  return words.map((w) => ({ ...w, start: ms(w.start - delta), end: ms(w.end - delta) }));
}

/** Splits word timings at `at` (relative to the clip start): [before, after (rebased to `at`)]. */
export function splitWords(words: readonly WordTiming[], at: number): [WordTiming[], WordTiming[]] {
  const a: WordTiming[] = [];
  const b: WordTiming[] = [];
  for (const w of words) {
    if ((w.start + w.end) / 2 < at) a.push(w);
    else b.push({ ...w, start: Math.round((w.start - at) * 1000) / 1000, end: Math.round((w.end - at) * 1000) / 1000 });
  }
  return [a, b];
}
