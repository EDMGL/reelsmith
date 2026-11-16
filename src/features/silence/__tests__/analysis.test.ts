import { describe, expect, it } from 'vitest';
import {
  computeLevels,
  detectSilence,
  downmix,
  estimateThreshold,
  findActiveRanges,
  refineSilences,
} from '../analysis';
import { buildSignal, noiseAmpForDb, SR } from './signals';

const TOL = 0.05;

function expectRange(r: { start: number; end: number } | undefined, start: number, end: number) {
  expect(r).toBeDefined();
  expect(Math.abs(r!.start - start)).toBeLessThanOrEqual(TOL);
  expect(Math.abs(r!.end - end)).toBeLessThanOrEqual(TOL);
}

describe('detectSilence on synthetic signals', () => {
  const toneSilenceTone = buildSignal([
    { kind: 'tone', sec: 1 },
    { kind: 'silence', sec: 1 },
    { kind: 'tone', sec: 1 },
  ]);

  it('finds the silence between two tones within ±50 ms (no padding)', () => {
    const r = detectSilence(toneSilenceTone, SR, { paddingMs: 0 });
    expect(r.silences).toHaveLength(1);
    expectRange(r.silences[0], 1, 2);
    expect(r.durationSec).toBeCloseTo(3, 5);
  });

  it('keeps padding around speech', () => {
    const r = detectSilence(toneSilenceTone, SR, { paddingMs: 100 });
    expect(r.silences).toHaveLength(1);
    expectRange(r.silences[0], 1.1, 1.9);
  });

  it('does not pad at the signal boundaries (leading / trailing silence)', () => {
    const sig = buildSignal([
      { kind: 'silence', sec: 0.8 },
      { kind: 'tone', sec: 1 },
      { kind: 'silence', sec: 0.7 },
    ]);
    const r = detectSilence(sig, SR, { paddingMs: 100 });
    expect(r.silences).toHaveLength(2);
    expectRange(r.silences[0], 0, 0.7);
    expectRange(r.silences[1], 1.9, 2.5);
  });

  it('respects the minimum silence duration', () => {
    const sig = buildSignal([
      { kind: 'tone', sec: 1 },
      { kind: 'silence', sec: 0.3 },
      { kind: 'tone', sec: 1 },
    ]);
    expect(detectSilence(sig, SR, { minSilenceMs: 500, paddingMs: 0 }).silences).toHaveLength(0);
    const r = detectSilence(sig, SR, { minSilenceMs: 200, paddingMs: 0 });
    expect(r.silences).toHaveLength(1);
    expectRange(r.silences[0], 1, 1.3);
  });

  it('uses the fixed threshold: -30 dBFS noise is silence at -25 dB but not at -35 dB', () => {
    const sig = buildSignal([
      { kind: 'tone', sec: 1 },
      { kind: 'silence', sec: 1, noiseAmp: noiseAmpForDb(-30) },
      { kind: 'tone', sec: 1 },
    ]);
    expect(detectSilence(sig, SR, { thresholdDb: -35, paddingMs: 0 }).silences).toHaveLength(0);
    const r = detectSilence(sig, SR, { thresholdDb: -25, paddingMs: 0 });
    expect(r.silences).toHaveLength(1);
    expectRange(r.silences[0], 1, 2);
  });

  it('min-keep removes tiny speech slivers between silences', () => {
    const sig = buildSignal([
      { kind: 'tone', sec: 1 },
      { kind: 'silence', sec: 1 },
      { kind: 'tone', sec: 0.1 },
      { kind: 'silence', sec: 1 },
      { kind: 'tone', sec: 1 },
    ]);
    const off = detectSilence(sig, SR, { paddingMs: 0, minKeepMs: 0 });
    expect(off.silences).toHaveLength(2);
    expectRange(off.silences[0], 1, 2);
    expectRange(off.silences[1], 2.1, 3.1);
    const on = detectSilence(sig, SR, { paddingMs: 0, minKeepMs: 200 });
    expect(on.silences).toHaveLength(1);
    expectRange(on.silences[0], 1, 3.1);
  });

  it('auto threshold follows the noise floor', () => {
    // Noise floor at -45 dBFS: a fixed -50 dB threshold sees no silence, auto does.
    const sig = buildSignal([
      { kind: 'tone', sec: 1 },
      { kind: 'silence', sec: 1.5, noiseAmp: noiseAmpForDb(-45) },
      { kind: 'tone', sec: 1 },
      { kind: 'silence', sec: 1.5, noiseAmp: noiseAmpForDb(-45) },
      { kind: 'tone', sec: 1 },
    ]);
    expect(detectSilence(sig, SR, { thresholdDb: -50, paddingMs: 0 }).silences).toHaveLength(0);
    const r = detectSilence(sig, SR, { autoThreshold: true, paddingMs: 0 });
    expect(r.floorDb!).toBeGreaterThan(-48);
    expect(r.floorDb!).toBeLessThan(-42);
    expect(r.thresholdDb).toBeGreaterThan(-45);
    expect(r.thresholdDb).toBeLessThan(-9);
    expect(r.silences).toHaveLength(2);
    expectRange(r.silences[0], 1, 2.5);
    expectRange(r.silences[1], 3.5, 5);
  });

  it('auto threshold reports no silence for a steady tone and all silence for digital silence', () => {
    const tone = buildSignal([{ kind: 'tone', sec: 2 }]);
    expect(detectSilence(tone, SR, { autoThreshold: true }).silences).toHaveLength(0);
    const quiet = buildSignal([{ kind: 'silence', sec: 2 }]);
    const r = detectSilence(quiet, SR, { autoThreshold: true });
    expect(r.silences).toHaveLength(1);
    expectRange(r.silences[0], 0, 2);
  });

  it('handles an empty signal', () => {
    expect(detectSilence(new Float32Array(0), SR).silences).toEqual([]);
  });

  it('reports progress and aborts', () => {
    const seen: number[] = [];
    detectSilence(toneSilenceTone, SR, {}, { onProgress: (f) => seen.push(f) });
    expect(seen.at(-1)).toBe(1);
    expect(() => detectSilence(toneSilenceTone, SR, {}, { shouldAbort: () => true })).toThrow(/Aborted/);
  });
});

describe('building blocks', () => {
  it('computeLevels gives ~-9 dBFS for a 0.5 sine and the floor for zeros', () => {
    const lv = computeLevels(buildSignal([{ kind: 'tone', sec: 0.1 }, { kind: 'silence', sec: 0.1 }]), SR, 20);
    expect(lv[0]).toBeCloseTo(-9.03, 0);
    expect(lv[lv.length - 1]).toBe(-120);
  });

  it('hysteresis keeps state inside the band', () => {
    // threshold -35, hysteresis 4 => loud above -33, quiet below -37.
    const lv = Float32Array.from([-10, -36, -34, -36, -38, -36, -34, -32, -36]);
    const r = findActiveRanges(lv, 1, -35, 4, lv.length);
    // loud [0,4) (stays loud through -36/-34/-36 until -38), quiet until -32 at index 7.
    expect(r).toEqual([
      { start: 0, end: 4 },
      { start: 7, end: 9 },
    ]);
  });

  it('estimateThreshold uses floor + margin', () => {
    const lv = Float32Array.from([...Array(50).fill(-60), ...Array(50).fill(-10)]);
    const est = estimateThreshold(lv);
    expect(est.floorDb).toBe(-60);
    expect(est.speechDb).toBe(-10);
    expect(est.thresholdDb).toBe(-50);
  });

  it('refineSilences only pads edges touching loud content', () => {
    const r = refineSilences(
      [
        { start: 0, end: 1 },
        { start: 2, end: 3 },
      ],
      { minSilenceSec: 0.5, paddingSec: 0.1, minKeepSec: 0, loud: [{ start: 1, end: 2 }] },
    );
    expect(r[0]!.start).toBeCloseTo(0);
    expect(r[0]!.end).toBeCloseTo(0.9);
    expect(r[1]!.start).toBeCloseTo(2.1);
    expect(r[1]!.end).toBeCloseTo(3);
  });

  it('downmix averages channels', () => {
    const m = downmix([Float32Array.from([1, 0]), Float32Array.from([0, 1])]);
    expect(Array.from(m)).toEqual([0.5, 0.5]);
  });
});
