/**
 * Composition helpers (pure, deterministic): a `Composer` that collects note
 * events in beats, plus reusable part generators — drums with fills, bass
 * lines, chord comping (pads, stabs, broken chords, strums), arpeggios and a
 * small motif-based melody writer. Every random choice uses a seeded `Rng`.
 */
import { Rng } from './rng';
import { chordFor, pc, pcAtOrAbove, stepScale, voiceLead, type Chord, type ChordSpec, type Key } from './theory';
import { cleanPattern, expandForm, expandPattern, finalizeEvents, formBars, type BarInfo, type Section } from './sequence';
import type { Arrangement, InstrumentSpec, NoteEvent } from './types';

export interface Humanize {
  /** Timing jitter, standard deviation in milliseconds. */
  ms?: number;
  /** Velocity jitter, ± fraction. */
  vel?: number;
}

export class Composer {
  readonly events: NoteEvent[] = [];
  readonly spb: number;
  readonly bars: BarInfo[];
  private readonly root: Rng;

  constructor(
    readonly bpm: number,
    readonly key: Key,
    seed: number,
    readonly form: readonly Section[],
    readonly beatsPerBar = 4,
  ) {
    this.spb = 60 / bpm;
    this.root = new Rng(seed);
    this.bars = expandForm(form);
  }

  get totalBars(): number {
    return formBars(this.form);
  }

  get loopSeconds(): number {
    return this.totalBars * this.beatsPerBar * this.spb;
  }

  /** Independent random stream for a part (adding a part never changes another). */
  rng(label: string): Rng {
    return this.root.fork(label);
  }

  barStart(bar: number): number {
    return bar * this.beatsPerBar;
  }

  /** Adds a note at a beat position (beats from loop start). */
  note(inst: string, beat: number, lenBeats: number, midi: number, vel: number, rng?: Rng, h: Humanize = {}): void {
    let t = beat * this.spb;
    let v = vel;
    if (rng) {
      if (h.ms) t += (rng.gauss() * h.ms) / 1000;
      if (h.vel) v *= 1 + (rng.next() * 2 - 1) * h.vel;
    }
    this.events.push({ t, d: Math.max(0.01, lenBeats * this.spb), inst, n: midi, v: Math.max(0.02, Math.min(1, v)) });
  }

  build(instruments: Record<string, InstrumentSpec>, fx: Pick<Arrangement, 'reverb' | 'delay' | 'duck'>): Arrangement {
    const loopSeconds = this.loopSeconds;
    return {
      bpm: this.bpm,
      beatsPerBar: this.beatsPerBar,
      bars: this.totalBars,
      loopSeconds,
      events: finalizeEvents(this.events, loopSeconds),
      instruments,
      ...fx,
    };
  }
}

// ---------------------------------------------------------------------------
// Chord timeline
// ---------------------------------------------------------------------------

export type ChordAt = (bar: BarInfo, beat?: number) => Chord;

/**
 * Chord lookup from per-section progressions (falls back to `default`).
 * `barsPerChord` may be 0.5 (two chords per bar), 1, 2 …
 */
export function chordTimeline(key: Key, progressions: Record<string, ChordSpec[]> & { default: ChordSpec[] }, barsPerChord = 1, beatsPerBar = 4): ChordAt {
  const cache = new Map<string, Chord>();
  return (b, beat = 0) => {
    const prog = progressions[b.section.name] ?? progressions.default;
    const pos = (b.local * beatsPerBar + beat) / (barsPerChord * beatsPerBar);
    const idx = Math.floor(pos + 1e-9) % prog.length;
    const spec = prog[idx]!;
    const k = `${b.section.name}:${idx}`;
    let c = cache.get(k);
    if (!c) cache.set(k, (c = chordFor(key, spec)));
    return c;
  };
}

// ---------------------------------------------------------------------------
// Drums
// ---------------------------------------------------------------------------

export interface DrumOptions {
  /** Per bar: instrument id -> 16-step pattern (null/undefined = silent). */
  groove: (b: BarInfo) => Record<string, string | null | undefined>;
  swing?: number;
  humanize?: Humanize;
  fills?: {
    snare: string;
    kick?: string;
    tom?: string;
    /** Instruments whose hits are removed under the fill (e.g. hats). */
    mute?: string[];
    /** 'phrase' = every 4 bars (small fill), 'big' = only every 8 bars / section ends. */
    when?: 'phrase' | 'big';
  };
  /** Crash/cymbal at section starts. */
  crash?: string;
}

export function drumPart(c: Composer, opts: DrumOptions): void {
  const rng = c.rng('drums');
  const h = opts.humanize ?? { ms: 4, vel: 0.12 };
  for (const b of c.bars) {
    const groove = opts.groove(b);
    const f = opts.fills;
    const isFill = !!f && (f.when === 'phrase' ? b.phraseEnd : b.bigPhraseEnd) && b.section.energy > 0.25;
    const picked = isFill ? rng.pick(['roll', 'toms', 'flam', 'stop'] as const) : null;
    const fillKind = picked === 'toms' && !f?.tom ? 'roll' : picked;
    const fillFromStep = fillKind === 'toms' || fillKind === 'roll' ? (b.bigPhraseEnd && b.section.energy > 0.6 ? 8 : 12) : 12;
    for (const [inst, pat] of Object.entries(groove)) {
      if (!pat) continue;
      const p = cleanPattern(pat);
      for (const hit of expandPattern(p, { swing: opts.swing, offsetBeats: c.barStart(b.bar) })) {
        if (isFill && hit.step >= fillFromStep && (inst === f!.snare || f!.mute?.includes(inst) || (fillKind === 'stop' && inst !== f!.kick))) continue;
        c.note(inst, hit.beat, 0.25, 0, hit.vel, rng, h);
      }
    }
    if (isFill && f) {
      const base = c.barStart(b.bar);
      if (fillKind === 'roll') {
        const n = 16 - fillFromStep;
        for (let i = 0; i < n; i++) c.note(f.snare, base + (fillFromStep + i) * 0.25, 0.25, 0, 0.35 + (0.6 * i) / n, rng, h);
      } else if (fillKind === 'toms' && f.tom) {
        const pitches = [50, 50, 47, 47, 45, 45, 43, 43];
        const n = 16 - fillFromStep;
        for (let i = 0; i < n; i++) {
          const pitch = pitches[Math.floor((i / n) * pitches.length)]!;
          if (i % 2 === 1 && rng.chance(0.3)) continue;
          c.note(f.tom, base + (fillFromStep + i) * 0.25, 0.5, pitch, 0.6 + 0.35 * (i / n), rng, h);
        }
      } else if (fillKind === 'flam') {
        for (const s of [12, 13, 14.5, 15]) c.note(f.snare, base + s * 0.25, 0.25, 0, s === 12 ? 0.9 : 0.6, rng, h);
        if (f.kick) c.note(f.kick, base + 14 * 0.25, 0.25, 0, 0.8, rng, h);
      } else {
        // 'stop': a short break on beat 4 with one pickup snare.
        c.note(f.snare, base + 15.5 * 0.25, 0.25, 0, 0.55, rng, h);
      }
    }
    if (opts.crash && b.sectionStart && b.section.energy > 0.45) c.note(opts.crash, c.barStart(b.bar), 2, 0, 0.75, rng, { ms: 2 });
  }
}

// ---------------------------------------------------------------------------
// Bass
// ---------------------------------------------------------------------------

export interface BassOptions {
  inst: string;
  chordAt: ChordAt;
  /** 16-step pattern per bar. R root, O octave, 5 fifth, 3 third, 7 seventh, A approach to next bar's root,
   *  lowercase = softer, '-' = tie (extend previous), '.' = rest. */
  pattern: (b: BarInfo) => string | null;
  /** Lowest root note (MIDI), default 33 (A1). */
  lo?: number;
  /** Note length as a fraction of the time to the next onset. */
  gate?: number;
  swing?: number;
  humanize?: Humanize;
}

export function bassPart(c: Composer, o: BassOptions): void {
  const rng = c.rng(`bass:${o.inst}`);
  const lo = o.lo ?? 33;
  const h = o.humanize ?? { ms: 3, vel: 0.08 };
  for (const b of c.bars) {
    const pat = o.pattern(b);
    if (!pat) continue;
    const p = cleanPattern(pat);
    const base = c.barStart(b.bar);
    const next = c.bars[(b.bar + 1) % c.bars.length]!;
    const nextRoot = pcAtOrAbove(o.chordAt(next).bassPc, lo);
    type N = { step: number; len: number; midi: number; vel: number };
    const notes: N[] = [];
    for (let i = 0; i < p.length; i++) {
      const ch = p[i]!;
      if (ch === '-') {
        const last = notes[notes.length - 1];
        if (last) last.len += 1;
        continue;
      }
      if (ch === '.') continue;
      const chord = o.chordAt(b, i * 0.25);
      const root = pcAtOrAbove(chord.bassPc, lo);
      const up = ch.toUpperCase();
      let midi = root;
      if (up === 'O') midi = root + 12;
      else if (up === '5') midi = pcAtOrAbove(chord.pcs[2] ?? chord.rootPc, root);
      else if (up === '3') midi = pcAtOrAbove(chord.pcs[1] ?? chord.rootPc, root);
      else if (up === '7') midi = pcAtOrAbove(chord.pcs[3] ?? chord.pcs[2]!, root);
      else if (up === 'A') {
        midi = rng.chance(0.5) ? nextRoot - 1 : stepScale(c.key, nextRoot, rng.chance(0.5) ? 1 : -1);
        if (pc(midi) === pc(root)) midi = pcAtOrAbove(chord.pcs[2] ?? chord.rootPc, root);
      }
      const vel = ch === up && ch !== '5' && ch !== '3' && ch !== '7' ? 0.9 : ch === up ? 0.85 : 0.6;
      notes.push({ step: i, len: 1, midi, vel });
    }
    for (let k = 0; k < notes.length; k++) {
      const n = notes[k]!;
      const until = (notes[k + 1]?.step ?? p.length) - n.step;
      const len = Math.max(n.len, 1);
      const gate = o.gate ?? 0.9;
      const lenSteps = Math.min(until, len) * gate;
      const swingOff = n.step % 2 === 1 ? (o.swing ?? 0) * 0.25 : 0;
      c.note(o.inst, base + n.step * 0.25 + swingOff, lenSteps * 0.25, n.midi, n.vel, rng, h);
    }
  }
}

// ---------------------------------------------------------------------------
// Chords
// ---------------------------------------------------------------------------

export interface ChordOptions {
  inst: string;
  chordAt: ChordAt;
  lo: number;
  hi: number;
  /**
   * pad: held for each chord (legato); stabs/block: on the pattern hits;
   * strum: guitar-like spread on the hits (down on beats, up on offbeats);
   * broken: piano arpeggio following `pattern` (digits = voice index from the bottom, b = bass).
   */
  style: 'pad' | 'stabs' | 'strum' | 'broken';
  pattern?: (b: BarInfo) => string | null;
  /** Bars a pad chord lasts before re-striking (default: chord change only). */
  gate?: number;
  vel?: number;
  /** Include the chord root an octave below the voicing (broken style 'b'). */
  bassLo?: number;
  active?: (b: BarInfo) => boolean;
  humanize?: Humanize;
  swing?: number;
}

export function chordPart(c: Composer, o: ChordOptions): void {
  const rng = c.rng(`chords:${o.inst}`);
  const h = o.humanize ?? { ms: 6, vel: 0.1 };
  let prev: number[] | null = null;
  const vel = o.vel ?? 0.7;
  const voicingFor = (ch: Chord) => (prev = voiceLead(ch.pcs, prev, o.lo, o.hi));
  if (o.style === 'pad') {
    // Held chords: one strike per contiguous chord segment (split at chord changes,
    // inactive bars, section starts and every `gate` bars), slightly overlapping.
    let seg: { beat: number; chord: Chord } | null = null;
    const flush = (endBeat: number) => {
      if (!seg) return;
      const notes = voicingFor(seg.chord);
      const start = seg.beat;
      notes.forEach((n, j) => c.note(o.inst, start + j * 0.004, endBeat - start + 0.05, n, vel * (j === 0 ? 1 : 0.9), rng, { ms: 3, vel: 0.06 }));
      seg = null;
    };
    for (const b of c.bars) {
      const base = c.barStart(b.bar);
      const on = !o.active || o.active(b);
      for (let beat = 0; beat < c.beatsPerBar; beat += 0.5) {
        const abs = base + beat;
        if (!on) {
          flush(abs);
          continue;
        }
        const chord = o.chordAt(b, beat);
        const boundary = beat === 0 && (b.sectionStart || (o.gate !== undefined && b.local % o.gate === 0));
        if (!seg || seg.chord !== chord || boundary) {
          flush(abs);
          seg = { beat: abs, chord };
        }
      }
    }
    flush(c.totalBars * c.beatsPerBar);
    return;
  }
  for (const b of c.bars) {
    if (o.active && !o.active(b)) {
      continue;
    }
    const base = c.barStart(b.bar);
    const pat = o.pattern?.(b);
    if (!pat) continue;
    const p = cleanPattern(pat);
    if (o.style === 'broken') {
      const chord = o.chordAt(b, 0);
      let notes = voicingFor(chord);
      let lastChord = chord;
      for (let i = 0; i < p.length; i++) {
        const ch = p[i]!;
        if (ch === '.' || ch === '-') continue;
        const beat = i * 0.25;
        const cur = o.chordAt(b, beat);
        if (cur !== lastChord) {
          notes = voicingFor(cur);
          lastChord = cur;
        }
        let len = 0.25;
        while (i + len * 4 < p.length && p[i + len * 4] === '-') len += 0.25;
        const ring = Math.max(len, 1.5);
        const swingOff = i % 2 === 1 ? (o.swing ?? 0) * 0.25 : 0;
        if (ch === 'b') {
          c.note(o.inst, base + beat + swingOff, Math.max(ring, 2), pcAtOrAbove(cur.bassPc, o.bassLo ?? o.lo - 12), vel * 0.95, rng, h);
        } else if (ch === 'c') {
          notes.forEach((n, j) => c.note(o.inst, base + beat + swingOff + j * 0.006, ring, n, vel * 0.85, rng, h));
        } else {
          const idx = Number(ch);
          if (!Number.isFinite(idx)) continue;
          const n = notes[idx % notes.length]! + 12 * Math.floor(idx / notes.length);
          c.note(o.inst, base + beat + swingOff, ring, n, vel * (i % 4 === 0 ? 0.95 : 0.78), rng, h);
        }
      }
      continue;
    }
    // stabs / strum
    const hits = expandPattern(p, { swing: o.swing });
    hits.forEach((hit, k) => {
      const chord = o.chordAt(b, hit.beat);
      const notes = voicingFor(chord);
      const nextBeat = hits[k + 1]?.beat ?? c.beatsPerBar;
      let len = o.style === 'strum' ? Math.max(0.5, nextBeat - hit.beat) : Math.min(nextBeat - hit.beat, 0.5) * 0.85;
      // Ties after a hit extend it.
      let s = hit.step + 1;
      while (s < p.length && p[s] === '-') {
        len += 0.25;
        s++;
      }
      if (o.style === 'strum') {
        const up = Math.round(hit.beat * 2) % 2 === 1;
        const ordered = up ? [...notes].reverse().slice(0, Math.max(3, notes.length - 1)) : notes;
        const spread = 0.012 / c.spb; // 12 ms between strings, in beats
        ordered.forEach((n, j) => c.note(o.inst, base + hit.beat + j * spread, len, n, vel * hit.vel * (up ? 0.75 : 1) * (1 - j * 0.04), rng, h));
      } else {
        notes.forEach((n, j) => c.note(o.inst, base + hit.beat + j * 0.003, len, n, vel * hit.vel, rng, h));
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Arpeggio
// ---------------------------------------------------------------------------

export interface ArpOptions {
  inst: string;
  chordAt: ChordAt;
  lo: number;
  /** Order through the chord tones (over `octaves`). */
  order: 'up' | 'down' | 'updown' | 'converge' | 'random';
  octaves?: number;
  stepBeats?: number;
  gate?: number;
  /** Rhythm mask (1/16 steps); default every step. */
  rhythm?: (b: BarInfo) => string | null;
  vel?: number;
  active?: (b: BarInfo) => boolean;
  swing?: number;
}

export function arpPart(c: Composer, o: ArpOptions): void {
  const rng = c.rng(`arp:${o.inst}`);
  const step = o.stepBeats ?? 0.25;
  const octaves = o.octaves ?? 2;
  let prev: number[] | null = null;
  for (const b of c.bars) {
    if (o.active && !o.active(b)) continue;
    const base = c.barStart(b.bar);
    const rhythm = o.rhythm ? o.rhythm(b) : null;
    if (o.rhythm && !rhythm) continue;
    const mask = rhythm ? cleanPattern(rhythm) : null;
    const stepsPerBar = Math.round(c.beatsPerBar / step);
    let lastChord: Chord | null = null;
    let seq: number[] = [];
    for (let i = 0; i < stepsPerBar; i++) {
      const beat = i * step;
      const chord = o.chordAt(b, beat);
      if (chord !== lastChord) {
        const v = (prev = voiceLead(chord.pcs, prev, o.lo, o.lo + 14));
        const tones: number[] = [];
        for (let k = 0; k < octaves; k++) for (const n of v) tones.push(n + 12 * k);
        if (o.order === 'up') seq = tones;
        else if (o.order === 'down') seq = [...tones].reverse();
        else if (o.order === 'updown') seq = [...tones, ...tones.slice(1, -1).reverse()];
        else if (o.order === 'converge') {
          seq = [];
          for (let lo = 0, hi = tones.length - 1; lo <= hi; lo++, hi--) {
            seq.push(tones[lo]!);
            if (hi !== lo) seq.push(tones[hi]!);
          }
        } else seq = tones;
        lastChord = chord;
      }
      if (mask) {
        const ch = mask[i % mask.length]!;
        if (ch === '.' || ch === '-') continue;
      }
      const n = o.order === 'random' ? rng.pick(seq) : seq[i % seq.length]!;
      const accent = i % 4 === 0 ? 1 : i % 2 === 0 ? 0.85 : 0.72;
      const swingOff = i % 2 === 1 ? (o.swing ?? 0) * step : 0;
      c.note(o.inst, base + beat + swingOff, step * (o.gate ?? 0.8), n, (o.vel ?? 0.7) * accent, rng, { ms: 2, vel: 0.08 });
    }
  }
}

// ---------------------------------------------------------------------------
// Melody
// ---------------------------------------------------------------------------

export interface MelodyOptions {
  inst: string;
  chordAt: ChordAt;
  lo: number;
  hi: number;
  /** Sections/bars where the melody plays. */
  active: (b: BarInfo) => boolean;
  /** 0..1: rhythmic density. */
  density?: number;
  vel?: number;
  swing?: number;
  /** Leave the last bar of each 4-bar phrase mostly empty (call and response). */
  breathe?: boolean;
}

/** Rhythm cells spanning 2 beats: onset offsets in beats. */
const CELLS_SPARSE: number[][] = [[0], [0, 1], [0, 1.5], [0.5, 1], [0, 1.5], [1]];
const CELLS_DENSE: number[][] = [[0, 0.5, 1], [0, 0.75, 1.5], [0, 0.5, 1, 1.5], [0.5, 1, 1.5], [0, 1, 1.5], [0, 0.5, 1.5]];

/**
 * Motif-based melody: a 1-bar rhythm motif is stated, varied, restated and
 * answered by a cadence over each 4-bar phrase. Strong beats land on chord
 * tones, weak beats move by scale step along an arch contour.
 */
export function melodyPart(c: Composer, o: MelodyOptions): void {
  const rng = c.rng(`melody:${o.inst}`);
  const density = o.density ?? 0.4;
  const vel = o.vel ?? 0.75;
  const center = Math.round((o.lo + o.hi) / 2);
  const cellFor = () => rng.pick(rng.chance(density) ? CELLS_DENSE : CELLS_SPARSE);
  let motif: number[] = [];
  let variant: number[] = [];
  let prevNote = center;
  let phraseStart = -1;
  for (const b of c.bars) {
    if (!o.active(b)) continue;
    const pos = b.local % 4;
    if (pos === 0 || phraseStart < 0) {
      phraseStart = b.bar;
      motif = [...cellFor(), ...cellFor().map((x) => x + 2)];
      variant = [...motif.filter((x) => x < 2), ...cellFor().map((x) => x + 2)];
    }
    let onsets: number[];
    if (pos === 0 || pos === 2) onsets = motif;
    else if (pos === 1) onsets = variant;
    else onsets = o.breathe === false ? variant : [0, ...(rng.chance(0.5) ? [1] : [])];
    const base = c.barStart(b.bar);
    onsets.forEach((beat, i) => {
      const next = onsets[i + 1] ?? (pos === 3 ? 4 : 4.5);
      const len = Math.min(next - beat, pos === 3 ? 3 : 1.5) * 0.92;
      const chord = o.chordAt(b, beat);
      const strong = beat % 1 === 0 && (beat === 0 || beat === 2);
      // Arch contour across the phrase: rise to the 3rd bar, fall into the cadence.
      const phrasePos = (pos * 4 + beat) / 16;
      const target = center + Math.round(Math.sin(phrasePos * Math.PI) * 5) - 2;
      let n: number;
      if (strong || pos === 3) {
        // Nearest chord tone to a point between the previous note and the contour target.
        const aim = Math.round(prevNote * 0.5 + target * 0.5);
        const opts = [] as number[];
        for (let m = o.lo; m <= o.hi; m++) if (chord.pcs.slice(0, 3).includes(pc(m))) opts.push(m);
        n = opts.reduce((a, m) => (Math.abs(m - aim) < Math.abs(a - aim) ? m : a), opts[0] ?? aim);
        if (pos === 3 && i === 0) {
          const rootish = opts.filter((m) => pc(m) === chord.rootPc || pc(m) === chord.pcs[1]);
          if (rootish.length) n = rootish.reduce((a, m) => (Math.abs(m - prevNote) < Math.abs(a - prevNote) ? m : a));
        }
      } else {
        const dir = target > prevNote ? 1 : target < prevNote ? -1 : rng.chance(0.5) ? 1 : -1;
        n = stepScale(c.key, prevNote, dir * (rng.chance(0.75) ? 1 : 2));
      }
      while (n > o.hi) n -= 12;
      while (n < o.lo) n += 12;
      prevNote = n;
      const swingOff = (beat * 2) % 2 === 1 ? (o.swing ?? 0) * 0.5 : 0;
      c.note(o.inst, base + beat + swingOff, Math.max(0.2, len), n, vel * (strong ? 1 : 0.85), rng, { ms: 7, vel: 0.1 });
    });
  }
}

/** Simple per-section part toggles: active when the section lists `part`. */
export const when = (part: string) => (b: BarInfo) => b.has(part);
