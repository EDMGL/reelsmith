import { describe, expect, it } from 'vitest';
import { filterSfx, filterTracks, MUSIC_TRACKS, musicChips, SOUND_EFFECTS } from '../catalogue';
import { VOICES } from '../synth/voices';

describe('catalogue integrity', () => {
  it('has enough distinct items with unique ids', () => {
    expect(MUSIC_TRACKS.length).toBeGreaterThanOrEqual(16);
    expect(SOUND_EFFECTS.length).toBeGreaterThanOrEqual(20);
    const ids = [...MUSIC_TRACKS, ...SOUND_EFFECTS].map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(MUSIC_TRACKS.map((t) => t.name)).size).toBe(MUSIC_TRACKS.length);
    expect(new Set(MUSIC_TRACKS.map((t) => t.genre)).size).toBeGreaterThanOrEqual(16);
  });

  it.each(MUSIC_TRACKS.map((t) => [t.name, t] as const))('%s: every variation composes a valid loop', (_n, t) => {
    expect(t.bpm).toBeGreaterThan(50);
    expect(t.moods.length).toBeGreaterThan(0);
    expect(t.variations.length).toBeGreaterThanOrEqual(2);
    expect(t.variations.length).toBeLessThanOrEqual(3);
    const lists: string[] = [];
    for (const v of t.variations) {
      const a = t.compose(v.seed);
      expect(a.bpm).toBe(t.bpm);
      expect(a.loopSeconds).toBeCloseTo((a.bars * a.beatsPerBar * 60) / a.bpm, 6);
      expect(a.loopSeconds).toBeGreaterThan(25);
      expect(a.loopSeconds).toBeLessThan(120);
      expect(a.events.length).toBeGreaterThan(20);
      for (const e of a.events) {
        expect(e.t).toBeGreaterThanOrEqual(0);
        expect(e.t).toBeLessThan(a.loopSeconds);
        expect(e.d).toBeGreaterThan(0);
        expect(e.v).toBeGreaterThan(0);
        expect(e.v).toBeLessThanOrEqual(1);
        expect(a.instruments[e.inst], `instrument ${e.inst}`).toBeDefined();
      }
      for (const spec of Object.values(a.instruments)) expect(VOICES[spec.voice]).toBeTypeOf('function');
      if (a.duck) expect(a.instruments[a.duck.source]).toBeDefined();
      // Determinism: same recipe + seed -> identical event list.
      expect(JSON.stringify(t.compose(v.seed))).toBe(JSON.stringify(a));
      lists.push(JSON.stringify(a.events));
    }
    // Variations really differ.
    expect(new Set(lists).size).toBe(lists.length);
  });

  it.each(SOUND_EFFECTS.map((s) => [s.name, s] as const))('%s: effect builds', (_n, s) => {
    expect(s.variations.length).toBeGreaterThanOrEqual(2);
    for (const v of s.variations) {
      const b = s.make(v.seed);
      expect(b.seconds).toBeGreaterThan(0.1);
      expect(b.seconds).toBeLessThanOrEqual(5);
      expect(b.build).toBeTypeOf('function');
    }
  });

  it('search and chips filter', () => {
    expect(filterTracks('', null)).toHaveLength(MUSIC_TRACKS.length);
    expect(filterTracks('lo-fi', null).map((t) => t.name)).toContain('Lazy Sunday');
    expect(filterTracks('', 'Synthwave').map((t) => t.genre)).toEqual(['Synthwave']);
    expect(filterTracks('', 'happy').length).toBeGreaterThanOrEqual(2);
    expect(filterTracks('zzzz', null)).toHaveLength(0);
    expect(filterSfx('whoosh', null).length).toBeGreaterThanOrEqual(1);
    expect(filterSfx('', 'UI').every((s) => s.category === 'UI')).toBe(true);
    expect(musicChips()).toContain('Lo-fi');
  });
});
