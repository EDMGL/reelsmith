import { describe, expect, it } from 'vitest';
import { bassPart, chordPart, chordTimeline, Composer, drumPart } from '../synth/compose';
import { barsForDuration, barsToSeconds, expandForm, expandPattern, finalizeEvents, loopLengthSamples, loopsNeeded, patternBeats } from '../synth/sequence';
import { parseKey, parseProgression } from '../synth/theory';

describe('pattern expansion', () => {
  it('maps characters to hits and velocities', () => {
    const hits = expandPattern('X... x.o. | g...');
    expect(hits.map((h) => h.beat)).toEqual([0, 1, 1.5, 2]);
    expect(hits.map((h) => h.vel)).toEqual([1, 0.8, 0.55, 0.3]);
    expect(patternBeats('x...x...x...x...')).toBe(4);
  });

  it('applies swing to off-steps and offsets', () => {
    const hits = expandPattern('xxxx', { swing: 0.5, offsetBeats: 8 });
    expect(hits.map((h) => h.beat)).toEqual([8, 8.375, 8.5, 8.875]);
    expect(expandPattern('x.x.', { stepBeats: 0.5 }).map((h) => h.beat)).toEqual([0, 1]);
  });
});

describe('loop math', () => {
  it('computes bar and loop lengths', () => {
    expect(barsToSeconds(4, 120)).toBe(8);
    expect(barsToSeconds(1, 90, 3)).toBe(2);
    expect(loopLengthSamples(8, 120, 44100)).toBe(16 * 44100);
    expect(loopsNeeded(20, 8)).toBe(3);
    expect(loopsNeeded(16, 8)).toBe(2);
    expect(loopsNeeded(0, 8)).toBe(0);
    expect(barsForDuration(60, 120)).toBe(32);
    expect(barsForDuration(1, 120)).toBe(4);
  });

  it('wraps humanised notes into the loop and sorts deterministically', () => {
    const ev = finalizeEvents(
      [
        { t: 3, d: 1, inst: 'b', n: 1, v: 0.5 },
        { t: -0.01, d: 1, inst: 'a', n: 1, v: 1.2 },
        { t: 10, d: 1, inst: 'a', n: 2, v: 0.5 },
        { t: 1, d: 0, inst: 'a', n: 2, v: 0.5 },
      ],
      10,
    );
    expect(ev.map((e) => e.t)).toEqual([0, 3, 9.99]);
    expect(ev[2]!.v).toBe(1);
  });
});

describe('song form and parts', () => {
  const form = [
    { name: 'intro', bars: 4, energy: 0.3, parts: ['keys'] },
    { name: 'a', bars: 8, energy: 0.8, parts: ['keys', 'drums', 'bass'] },
  ];

  it('flags phrases and section boundaries', () => {
    const bars = expandForm(form);
    expect(bars).toHaveLength(12);
    expect(bars.filter((b) => b.phraseEnd).map((b) => b.bar)).toEqual([3, 7, 11]);
    expect(bars.filter((b) => b.bigPhraseEnd).map((b) => b.bar)).toEqual([3, 11]);
    expect(bars[4]!.sectionStart).toBe(true);
    expect(bars[4]!.has('drums')).toBe(true);
    expect(bars[0]!.has('drums')).toBe(false);
  });

  it('drums add fills on phrase ends and are deterministic per seed', () => {
    const make = (seed: number) => {
      const c = new Composer(120, parseKey('C major'), seed, form);
      drumPart(c, {
        groove: (b) => (b.has('drums') ? { kick: 'x...x...x...x...', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' } : {}),
        fills: { snare: 'snare', tom: 'tom', mute: ['hat'], when: 'phrase' },
      });
      return c.build({}, { reverb: { seconds: 1, brightness: 0.5, preDelay: 0, level: -10 } }).events;
    };
    const ev = make(5);
    expect(make(5)).toEqual(ev);
    expect(make(6)).not.toEqual(ev);
    // Bar 7 is a phrase end in an energetic section: its last beat differs from the plain groove.
    const spb = 0.5;
    const lastBeat = (bar: number) => ev.filter((e) => e.t >= (bar * 4 + 3) * spb - 0.05 && e.t < (bar + 1) * 4 * spb - 0.05 && e.inst !== 'kick');
    const plain = lastBeat(5).map((e) => e.inst).sort();
    const fill = lastBeat(7).map((e) => e.inst).sort();
    expect(fill).not.toEqual(plain);
    expect(ev.every((e) => e.t >= 0 && e.t < 24)).toBe(true);
  });

  it('bass follows chord roots; pads hold voice-led chords', () => {
    const key = parseKey('C major');
    const c = new Composer(120, key, 1, form);
    const chordAt = chordTimeline(key, { default: parseProgression('I V vi IV') });
    bassPart(c, { inst: 'bass', chordAt, lo: 36, pattern: (b) => (b.has('bass') ? 'R.......O.......' : null) });
    chordPart(c, { inst: 'pad', chordAt, lo: 55, hi: 72, style: 'pad' });
    const arr = c.build({}, { reverb: { seconds: 1, brightness: 0.5, preDelay: 0, level: -10 } });
    const bass = arr.events.filter((e) => e.inst === 'bass');
    expect(bass).toHaveLength(16);
    // Bar 4 (section a, local 0) is chord I -> C; bar 5 -> G.
    const at = (bar: number) => bass.filter((e) => Math.abs(e.t - bar * 2) < 0.1)[0]!.n % 12;
    expect(at(4)).toBe(0);
    expect(at(5)).toBe(7);
    expect(at(6)).toBe(9);
    const pads = arr.events.filter((e) => e.inst === 'pad');
    // One 3-note chord per bar (chord changes every bar) = 36 notes, each about one bar long.
    expect(pads).toHaveLength(36);
    expect(pads.every((e) => e.d > 1.9 && e.d < 2.2)).toBe(true);
  });
});
