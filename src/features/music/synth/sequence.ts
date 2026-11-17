/**
 * Pattern sequencing and loop math (pure).
 *
 * Step patterns are strings, one character per step (default 1/16 note):
 *   'X' accent (1.0)  'x' normal (0.8)  'o' soft (0.55)  'g' ghost (0.3)  '.' or '-' rest.
 * Spaces and '|' are ignored, so "x... x... | x.x. x..." reads naturally.
 */
import type { NoteEvent } from './types';

const VEL: Record<string, number> = { X: 1, x: 0.8, o: 0.55, g: 0.3 };

export interface Hit {
  /** Position in beats from the pattern start. */
  beat: number;
  vel: number;
  /** Step index inside the pattern. */
  step: number;
}

export function cleanPattern(p: string): string {
  return p.replace(/[\s|]/g, '');
}

/**
 * Expands a step pattern into hits. `swing` (0..0.5) delays every second step
 * by that fraction of a step (0.33 ≈ triplet feel at 1/16).
 */
export function expandPattern(pattern: string, opts: { stepBeats?: number; swing?: number; offsetBeats?: number } = {}): Hit[] {
  const step = opts.stepBeats ?? 0.25;
  const swing = opts.swing ?? 0;
  const off = opts.offsetBeats ?? 0;
  const p = cleanPattern(pattern);
  const out: Hit[] = [];
  for (let i = 0; i < p.length; i++) {
    const v = VEL[p[i]!];
    if (v === undefined) continue;
    out.push({ beat: off + i * step + (i % 2 === 1 ? swing * step : 0), vel: v, step: i });
  }
  return out;
}

/** Number of beats a pattern spans. */
export function patternBeats(pattern: string, stepBeats = 0.25): number {
  return cleanPattern(pattern).length * stepBeats;
}

/** Seconds per beat. */
export const beatSeconds = (bpm: number): number => 60 / bpm;

export function barsToSeconds(bars: number, bpm: number, beatsPerBar = 4): number {
  return (bars * beatsPerBar * 60) / bpm;
}

/** Loop length in whole samples (the render is exactly this long before tails are wrapped). */
export function loopLengthSamples(bars: number, bpm: number, sampleRate: number, beatsPerBar = 4): number {
  return Math.round(barsToSeconds(bars, bpm, beatsPerBar) * sampleRate);
}

/** How many loop copies are needed to cover `duration` seconds. */
export function loopsNeeded(duration: number, loopSeconds: number): number {
  if (duration <= 0) return 0;
  return Math.ceil(duration / loopSeconds - 1e-9);
}

/** Bar count closest to a target duration, rounded to a whole number of `phrase`-bar phrases (min one phrase). */
export function barsForDuration(seconds: number, bpm: number, phrase = 4, beatsPerBar = 4): number {
  const bars = seconds / barsToSeconds(1, bpm, beatsPerBar);
  return Math.max(phrase, Math.round(bars / phrase) * phrase);
}

/**
 * Wraps events into [0, loopSeconds) (humanised notes slightly before 0 move
 * to the loop end so the loop stays seamless), then sorts deterministically.
 */
export function finalizeEvents(events: NoteEvent[], loopSeconds: number): NoteEvent[] {
  const out = events
    .filter((e) => e.v > 0 && e.d > 0)
    .map((e) => {
      let t = e.t % loopSeconds;
      if (t < 0) t += loopSeconds;
      if (t > loopSeconds - 1e-6) t = 0;
      return { ...e, t: Math.round(t * 1e6) / 1e6, d: Math.round(e.d * 1e6) / 1e6, v: Math.round(Math.min(1, e.v) * 1e4) / 1e4 };
    });
  out.sort((a, b) => a.t - b.t || (a.inst < b.inst ? -1 : a.inst > b.inst ? 1 : 0) || a.n - b.n);
  return out;
}

// ---------------------------------------------------------------------------
// Song form
// ---------------------------------------------------------------------------

export interface Section {
  name: string;
  bars: number;
  /** 0..1 — parts use it to thin out or thicken. */
  energy: number;
  /** Part names active in this section. */
  parts: string[];
}

export interface BarInfo {
  /** Absolute bar index from the loop start. */
  bar: number;
  /** Bar index inside its section. */
  local: number;
  section: Section;
  sectionIndex: number;
  /** Last bar of a 4-bar phrase. */
  phraseEnd: boolean;
  /** Last bar of an 8-bar phrase (or of the section). */
  bigPhraseEnd: boolean;
  /** First bar of a section. */
  sectionStart: boolean;
  /** Last bar of a section. */
  sectionEnd: boolean;
  has(part: string): boolean;
}

export function expandForm(form: readonly Section[]): BarInfo[] {
  const out: BarInfo[] = [];
  let bar = 0;
  form.forEach((section, sectionIndex) => {
    for (let local = 0; local < section.bars; local++) {
      const sectionEnd = local === section.bars - 1;
      out.push({
        bar: bar++,
        local,
        section,
        sectionIndex,
        phraseEnd: local % 4 === 3 || sectionEnd,
        bigPhraseEnd: local % 8 === 7 || sectionEnd,
        sectionStart: local === 0,
        sectionEnd,
        has: (part) => section.parts.includes(part),
      });
    }
  });
  return out;
}

export function formBars(form: readonly Section[]): number {
  return form.reduce((a, s) => a + s.bars, 0);
}
