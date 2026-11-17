import { describe, expect, it } from 'vitest';
import { Rng } from '../synth/rng';
import { chordFor, degreeToMidi, midiToFreq, midiToName, noteToMidi, parseChord, parseKey, parseProgression, scalePcs, snapToScale, stepScale, voiceLead, voiceProgression } from '../synth/theory';

describe('notes and scales', () => {
  it('converts note names and frequencies', () => {
    expect(noteToMidi('C4')).toBe(60);
    expect(noteToMidi('A4')).toBe(69);
    expect(noteToMidi('Bb3')).toBe(58);
    expect(noteToMidi('F#2')).toBe(42);
    expect(midiToName(61)).toBe('C#4');
    expect(midiToFreq(69)).toBeCloseTo(440);
    expect(midiToFreq(81)).toBeCloseTo(880);
  });

  it('builds scales from keys', () => {
    expect(scalePcs(parseKey('C major'))).toEqual([0, 2, 4, 5, 7, 9, 11]);
    expect(scalePcs(parseKey('A minor'))).toEqual([9, 11, 0, 2, 4, 5, 7]);
    expect(scalePcs(parseKey('D dorian'))).toEqual([2, 4, 5, 7, 9, 11, 0]);
    expect(() => parseKey('C bogus')).toThrow();
  });

  it('maps degrees and steps through the scale', () => {
    const c = parseKey('C major');
    expect(degreeToMidi(c, 0)).toBe(60);
    expect(degreeToMidi(c, 7)).toBe(72);
    expect(degreeToMidi(c, -1)).toBe(59);
    expect(stepScale(c, 64, 1)).toBe(65);
    expect(stepScale(c, 71, 1)).toBe(72);
    expect(stepScale(c, 60, -2)).toBe(57);
    expect(snapToScale(c, 61)).toBe(62);
  });
});

describe('chords and progressions', () => {
  const C = parseKey('C major');
  it('derives diatonic chord qualities', () => {
    expect(chordFor(C, 0).pcs).toEqual([0, 4, 7]);
    expect(chordFor(C, 0).symbol).toBe('I');
    expect(chordFor(C, 5).pcs).toEqual([9, 0, 4]);
    expect(chordFor(C, 5).symbol).toBe('vi');
    expect(chordFor(C, 6).symbol).toBe('vii°');
    expect(chordFor(C, { degree: 4, size: 4 }).pcs).toEqual([7, 11, 2, 5]); // G7
    expect(chordFor(C, { degree: 0, sus: 4 }).pcs).toEqual([0, 5, 7]);
    expect(chordFor(C, { degree: 0, add9: true }).pcs).toEqual([0, 4, 7, 2]);
    expect(chordFor(parseKey('A minor'), 4).symbol).toBe('v');
    expect(chordFor(parseKey('A harmonicMinor'), 4).symbol).toBe('V');
  });

  it('parses roman numeral progressions', () => {
    expect(parseProgression('I V vi IV').map((s) => s.degree)).toEqual([0, 4, 5, 3]);
    expect(parseChord('ii7')).toEqual({ degree: 1, size: 4 });
    expect(parseChord('Vsus4').sus).toBe(4);
    expect(parseChord('IVadd9').add9).toBe(true);
    expect(parseChord('V/3').bass).toBe(6);
    expect(chordFor(C, parseChord('V/3')).bassPc).toBe(11);
    expect(() => parseChord('X')).toThrow();
  });

  it('voice-leads with small movement inside the range', () => {
    const prog = parseProgression('I V vi IV').map((s) => chordFor(C, s));
    const v = voiceProgression(prog, 55, 72);
    for (let i = 0; i < v.length; i++) {
      expect(v[i]!.every((n) => n >= 55 && n <= 72)).toBe(true);
      expect(new Set(v[i]!.map((n) => n % 12))).toEqual(new Set(prog[i]!.pcs));
      if (i > 0) {
        const moved = v[i]!.reduce((a, n, k) => a + Math.abs(n - v[i - 1]![k]!), 0);
        expect(moved).toBeLessThanOrEqual(5); // common-tone voice leading
      }
    }
    // Without a previous chord the voicing centres in the range.
    const first = voiceLead([0, 4, 7], null, 48, 72);
    const mean = first.reduce((a, b) => a + b) / 3;
    expect(Math.abs(mean - 60)).toBeLessThan(4);
  });
});

describe('Rng', () => {
  it('is deterministic per seed and forks independently', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    expect(Array.from({ length: 5 }, () => a.next())).toEqual(Array.from({ length: 5 }, () => b.next()));
    const r = new Rng(7);
    const f1 = r.fork('drums').next();
    r.next();
    r.next();
    expect(r.fork('drums').next()).toBe(f1);
    expect(new Rng(7).fork('bass').next()).not.toBe(f1);
  });
});
