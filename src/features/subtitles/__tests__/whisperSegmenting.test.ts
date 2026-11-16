import { describe, expect, it } from 'vitest';
import { isHallucination, levelDb, normalizeCues, planChunks, segmentsToCues } from '../whisper/segmenting';

const SR = 1000;

function tone(seconds: number, quietAt: number[] = []): Float32Array {
  const s = new Float32Array(seconds * SR);
  for (let i = 0; i < s.length; i++) s[i] = Math.sin(i) * 0.5;
  for (const q of quietAt) s.fill(0, Math.floor((q - 0.2) * SR), Math.floor((q + 0.2) * SR));
  return s;
}

describe('planChunks', () => {
  it('keeps short audio in a single chunk', () => {
    expect(planChunks(tone(10), SR)).toEqual([{ start: 0, end: 10 * SR }]);
  });

  it('cuts long audio at the quietest point inside [minSec, maxSec]', () => {
    const chunks = planChunks(tone(60, [22, 45]), SR, { maxSec: 28, minSec: 18 });
    expect(chunks.length).toBe(3);
    expect(Math.abs(chunks[0].end / SR - 22)).toBeLessThan(0.15);
    expect(Math.abs(chunks[1].end / SR - 45)).toBeLessThan(0.15);
    // contiguous, covers everything, every chunk <= 28 s
    expect(chunks[0].start).toBe(0);
    expect(chunks.at(-1)!.end).toBe(60 * SR);
    for (let i = 1; i < chunks.length; i++) expect(chunks[i].start).toBe(chunks[i - 1].end);
    for (const c of chunks) expect(c.end - c.start).toBeLessThanOrEqual(28 * SR);
  });

  it('handles empty audio', () => {
    expect(planChunks(new Float32Array(0), SR)).toEqual([]);
  });
});

describe('levelDb', () => {
  it('is -Infinity for silence and ~-9 dB for a 0.5 sine', () => {
    expect(levelDb(new Float32Array(100))).toBe(-Infinity);
    expect(levelDb(tone(2))).toBeCloseTo(-9, 0);
  });
});

describe('segmentsToCues', () => {
  it('offsets by the chunk start and keeps short segments whole', () => {
    expect(segmentsToCues([{ start: 1, end: 2.5, text: ' Merhaba dünya ' }], 30, 58)).toEqual([{ start: 31, end: 32.5, text: 'Merhaba dünya' }]);
  });

  it('splits long segments into short cues with proportional timing', () => {
    const text = 'Bugün sizlere yeni bir video düzenleme uygulamasını tanıtacağım ve nasıl kullanıldığını göstereceğim';
    const cues = segmentsToCues([{ start: 0, end: 9, text }], 0, 28, { maxChars: 42, maxDur: 5 });
    expect(cues.length).toBeGreaterThanOrEqual(3);
    expect(cues.map((c) => c.text).join(' ')).toBe(text);
    for (const c of cues) expect(c.text.length).toBeLessThanOrEqual(42);
    expect(cues[0].start).toBe(0);
    expect(cues.at(-1)!.end).toBeCloseTo(9);
    for (let i = 1; i < cues.length; i++) expect(cues[i].start).toBeCloseTo(cues[i - 1].end);
  });

  it('closes an open segment at the next segment start or the chunk end', () => {
    const cues = segmentsToCues(
      [
        { start: 0, end: null, text: 'bir' },
        { start: 2, end: null, text: 'iki' },
      ],
      10,
      15,
    );
    expect(cues).toEqual([
      { start: 10, end: 12, text: 'bir' },
      { start: 12, end: 15, text: 'iki' },
    ]);
  });

  it('drops empty segments and known hallucinations', () => {
    const cues = segmentsToCues(
      [
        { start: 0, end: 1, text: '   ' },
        { start: 1, end: 2, text: 'Altyazı M.K.' },
        { start: 2, end: 3, text: '♪ ♪' },
        { start: 3, end: 4, text: 'Gerçek konuşma' },
      ],
      0,
      10,
    );
    expect(cues.map((c) => c.text)).toEqual(['Gerçek konuşma']);
  });
});

describe('isHallucination', () => {
  it('matches only whole known phrases', () => {
    expect(isHallucination(' altyazı mk ')).toBe(true);
    expect(isHallucination('Subtitles by the Amara.org community')).toBe(true);
    expect(isHallucination('Bu altyazı M.K. tarafından değil')).toBe(false);
  });
});

describe('normalizeCues', () => {
  it('sorts, trims overlaps and drops slivers', () => {
    expect(
      normalizeCues([
        { start: 2, end: 4, text: 'b' },
        { start: 0, end: 2.5, text: 'a' },
        { start: 4, end: 4.1, text: 'tiny' },
      ]),
    ).toEqual([
      { start: 0, end: 2, text: 'a' },
      { start: 2, end: 4, text: 'b' },
    ]);
  });
});
