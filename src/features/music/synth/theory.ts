/**
 * Music theory helpers (pure): notes, scales, diatonic chords, roman-numeral
 * progressions and smooth voice leading.
 */

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  majorPentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10],
} as const satisfies Record<string, readonly number[]>;

export type ScaleName = keyof typeof SCALES;

export interface Key {
  /** Pitch class of the tonic, 0 = C. */
  tonic: number;
  scale: ScaleName;
}

/** 'C4' -> 60, 'A#2' -> 46, 'Bb3' -> 58. */
export function noteToMidi(name: string): number {
  const m = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(name.trim());
  if (!m) throw new Error(`Bad note name: ${name}`);
  const base = NOTE_NAMES.indexOf(m[1]!.toUpperCase() as (typeof NOTE_NAMES)[number]);
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return (Number(m[3]) + 1) * 12 + base + acc;
}

export function midiToName(midi: number): string {
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export const pc = (midi: number): number => ((midi % 12) + 12) % 12;

/** 'A minor' / 'F# dorian' -> Key. */
export function parseKey(s: string): Key {
  const [note, mode = 'major'] = s.trim().split(/\s+/);
  const tonic = pc(noteToMidi(`${note}4`));
  if (!(mode in SCALES)) throw new Error(`Unknown scale: ${mode}`);
  return { tonic, scale: mode as ScaleName };
}

export function keyName(k: Key): string {
  const mode = k.scale === 'major' ? 'major' : k.scale === 'minor' ? 'minor' : k.scale;
  return `${NOTE_NAMES[k.tonic]} ${mode}`;
}

/** Pitch classes of the key's scale. */
export function scalePcs(k: Key): number[] {
  return SCALES[k.scale].map((i) => (k.tonic + i) % 12);
}

/**
 * MIDI note of a scale degree (0-based; negative/large degrees wrap into other
 * octaves) relative to the tonic in `octave` (4 -> tonic near middle C).
 */
export function degreeToMidi(k: Key, degree: number, octave = 4): number {
  const sc = SCALES[k.scale];
  const n = sc.length;
  const oct = Math.floor(degree / n);
  const idx = ((degree % n) + n) % n;
  return (octave + 1) * 12 + k.tonic + sc[idx]! + 12 * oct;
}

/** Nearest MIDI note at or above `lo` with pitch class `p`. */
export function pcAtOrAbove(p: number, lo: number): number {
  return lo + ((p - pc(lo) + 12) % 12);
}

/** Nearest scale tone to `midi` (ties go up). */
export function snapToScale(k: Key, midi: number): number {
  const pcs = scalePcs(k);
  for (let d = 0; d < 12; d++) {
    if (pcs.includes(pc(midi + d))) return midi + d;
    if (pcs.includes(pc(midi - d))) return midi - d;
  }
  return midi;
}

/** Moves `steps` scale steps from a (scale) note. */
export function stepScale(k: Key, midi: number, steps: number): number {
  const sc = SCALES[k.scale];
  const start = snapToScale(k, midi);
  const rel = pc(start - k.tonic);
  let idx = sc.indexOf(rel as never);
  if (idx < 0) idx = 0;
  const octBase = start - rel;
  const total = idx + steps;
  const n = sc.length;
  const o = Math.floor(total / n);
  return octBase + sc[((total % n) + n) % n]! + 12 * o;
}

// ---------------------------------------------------------------------------
// Chords
// ---------------------------------------------------------------------------

export interface ChordSpec {
  /** 0-based scale degree of the root. */
  degree: number;
  /** 3 = triad, 4 = seventh, 5 = ninth. */
  size?: 3 | 4 | 5;
  sus?: 2 | 4;
  add9?: boolean;
  /** Bass degree for slash chords (e.g. I/3). */
  bass?: number;
}

export interface Chord {
  degree: number;
  rootPc: number;
  /** Chord pitch classes, root first. */
  pcs: number[];
  bassPc: number;
  symbol: string;
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

/** 'vi7' -> { degree: 5, size: 4 }; 'IVadd9', 'Vsus4', 'I/3'. Quality comes from the key (diatonic). */
export function parseChord(sym: string): ChordSpec {
  const m = /^([ivIV]+)(7|9)?(sus2|sus4)?(add9)?(?:\/(\d))?$/.exec(sym.trim());
  if (!m) throw new Error(`Bad chord symbol: ${sym}`);
  const degree = ROMAN.indexOf(m[1]!.toUpperCase());
  if (degree < 0) throw new Error(`Bad roman numeral: ${sym}`);
  const spec: ChordSpec = { degree };
  if (m[2] === '7') spec.size = 4;
  if (m[2] === '9') spec.size = 5;
  if (m[3]) spec.sus = m[3] === 'sus2' ? 2 : 4;
  if (m[4]) spec.add9 = true;
  if (m[5]) spec.bass = degree + Number(m[5]) - 1;
  return spec;
}

export function parseProgression(s: string): ChordSpec[] {
  return s.trim().split(/[\s,-]+/).filter(Boolean).map(parseChord);
}

/** Diatonic chord (stacked scale thirds) for a spec in a key. */
export function chordFor(k: Key, spec: ChordSpec | number): Chord {
  const sp: ChordSpec = typeof spec === 'number' ? { degree: spec } : spec;
  const sc = SCALES[k.scale];
  if (sc.length !== 7) throw new Error('Chords need a heptatonic scale');
  const deg = (d: number) => (k.tonic + sc[((d % 7) + 7) % 7]!) % 12;
  const size = sp.size ?? 3;
  const steps = [0, 2, 4, 6, 8].slice(0, size);
  let pcs = steps.map((s) => deg(sp.degree + s));
  if (sp.sus === 2) pcs[1] = deg(sp.degree + 1);
  if (sp.sus === 4) pcs[1] = deg(sp.degree + 3);
  if (sp.add9 && size < 5) pcs = [...pcs, deg(sp.degree + 1)];
  const rootPc = pcs[0]!;
  const third = pc(deg(sp.degree + 2) - rootPc);
  const fifth = pc(deg(sp.degree + 4) - rootPc);
  let symbol = ROMAN[((sp.degree % 7) + 7) % 7]!;
  if (third === 3) symbol = symbol.toLowerCase();
  if (fifth === 6) symbol += '°';
  if (size === 4) symbol += '7';
  if (size === 5) symbol += '9';
  if (sp.sus) symbol += `sus${sp.sus}`;
  if (sp.add9) symbol += 'add9';
  return { degree: sp.degree, rootPc, pcs, bassPc: sp.bass !== undefined ? deg(sp.bass) : rootPc, symbol };
}

/**
 * Chooses a voicing of `pcs` inside [lo, hi] that moves least from `prev`
 * (sum of absolute semitone motion between sorted voices). Without `prev`
 * the voicing closest to the middle of the range wins. Deterministic.
 */
export function voiceLead(pcs: readonly number[], prev: readonly number[] | null, lo: number, hi: number): number[] {
  const n = pcs.length;
  let best: number[] | null = null;
  let bestCost = Infinity;
  const center = (lo + hi) / 2;
  for (let inv = 0; inv < n; inv++) {
    const order = [...pcs.slice(inv), ...pcs.slice(0, inv)];
    for (let base = lo; base < lo + 12; base++) {
      if (pc(base) !== order[0]) continue;
      for (let oct = 0; base + oct * 12 <= hi; oct++) {
        const notes: number[] = [base + oct * 12];
        for (let i = 1; i < n; i++) notes.push(pcAtOrAbove(order[i]!, notes[i - 1]! + 1));
        if (notes[n - 1]! > hi) continue;
        let cost: number;
        if (prev && prev.length) {
          cost = 0;
          for (const x of notes) cost += Math.min(...prev.map((p) => Math.abs(p - x)));
          for (const p of prev) cost += Math.min(...notes.map((x) => Math.abs(p - x))) * 0.5;
        } else {
          cost = Math.abs(notes.reduce((a, b) => a + b, 0) / n - center);
        }
        // Prefer not-too-wide voicings slightly.
        cost += (notes[n - 1]! - notes[0]!) * 0.05;
        if (cost < bestCost - 1e-9) {
          bestCost = cost;
          best = notes;
        }
      }
    }
  }
  if (!best) {
    // Range too narrow: stack from lo.
    best = [pcAtOrAbove(pcs[0]!, lo)];
    for (let i = 1; i < n; i++) best.push(pcAtOrAbove(pcs[i]!, best[i - 1]! + 1));
  }
  return best;
}

/** Voice-leads a whole progression. */
export function voiceProgression(chords: readonly Chord[], lo: number, hi: number): number[][] {
  let prev: number[] | null = null;
  return chords.map((c) => (prev = voiceLead(c.pcs, prev, lo, hi)));
}
