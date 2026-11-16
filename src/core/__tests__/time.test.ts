import { describe, expect, it } from 'vitest';
import { fitRect, detectAspectPreset, sanitizeCanvasSize } from '../aspect';
import {
  formatDuration,
  formatTimecode,
  framesToSeconds,
  normalizeRanges,
  parseTimecode,
  pxToTime,
  secondsToFrames,
  snapInterval,
  snapTime,
  snapToFrame,
  timeToPx,
} from '../time';

describe('time utils', () => {
  it('converts seconds <-> frames', () => {
    expect(secondsToFrames(1, 30)).toBe(30);
    expect(secondsToFrames(0.5, 25)).toBe(13); // 12.5 rounds up
    expect(framesToSeconds(45, 30)).toBe(1.5);
    expect(snapToFrame(1.01, 30)).toBeCloseTo(1);
  });

  it('formats and parses timecode', () => {
    expect(formatTimecode(0, 30)).toBe('00:00:00:00');
    expect(formatTimecode(3661.5, 30)).toBe('01:01:01:15');
    expect(formatTimecode(-1, 30)).toBe('00:00:00:00');
    expect(parseTimecode('01:01:01:15', 30)).toBeCloseTo(3661.5);
    expect(parseTimecode('00:02:10', 30)).toBeCloseTo(2 + 10 / 30);
    expect(parseTimecode('abc', 30)).toBeNaN();
    expect(formatDuration(65.34)).toBe('1:05.3');
  });

  it('converts px <-> time', () => {
    expect(timeToPx(2, 50)).toBe(100);
    expect(pxToTime(100, 50)).toBe(2);
  });

  it('snaps to the closest candidate within threshold', () => {
    expect(snapTime(4.9, [0, 5, 10], 0.2)).toEqual({ time: 5, snappedTo: 5 });
    expect(snapTime(4.5, [0, 5, 10], 0.2)).toEqual({ time: 4.5, snappedTo: null });
    // interval 2..4 (length 2): end edge 4 is near candidate 4.1
    expect(snapInterval(2, 2, [4.1], 0.2).time).toBeCloseTo(2.1);
  });

  it('normalizes ranges', () => {
    expect(normalizeRanges([{ start: 5, end: 6 }, { start: 1, end: 3 }, { start: 2, end: 4 }, { start: 7, end: 7 }])).toEqual([
      { start: 1, end: 4 },
      { start: 5, end: 6 },
    ]);
  });
});

describe('aspect utils', () => {
  it('fits and detects', () => {
    const r = fitRect(1080, 1920, 1000, 1000);
    expect(r.width).toBeCloseTo(562.5);
    expect(r.height).toBeCloseTo(1000);
    expect(r.x).toBeCloseTo(218.75);
    expect(r.y).toBeCloseTo(0);
    expect(detectAspectPreset(1920, 1080)).toBe('16:9');
    expect(detectAspectPreset(1000, 1000)).toBe('custom');
    expect(sanitizeCanvasSize(3, 99999)).toEqual({ width: 16, height: 7680 });
  });
});
