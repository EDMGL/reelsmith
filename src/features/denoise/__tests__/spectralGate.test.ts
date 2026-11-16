import { describe, expect, it } from 'vitest';
import { DENOISE_STRENGTHS, denoiseChannel, FFT, frameSizeFor } from '../spectralGate';

const SR = 16000;

/** Deterministic pseudo-random white noise. */
function noise(len: number, amp: number, seed = 1): Float32Array {
  const out = new Float32Array(len);
  let s = seed;
  for (let i = 0; i < len; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    out[i] = ((s / 2 ** 32) * 2 - 1) * amp;
  }
  return out;
}

function rmsDb(x: Float32Array, a: number, b: number): number {
  let e = 0;
  for (let i = a; i < b; i++) e += x[i]! * x[i]!;
  return 10 * Math.log10(e / (b - a));
}

/** 6 s: noise everywhere, a 440+1200 Hz "voice" during 1-2.5 s and 3.5-5 s. */
function speechLike(): { x: Float32Array; voice: [number, number][]; quiet: [number, number][] } {
  const x = noise(6 * SR, 0.02);
  const voice: [number, number][] = [
    [1, 2.5],
    [3.5, 5],
  ];
  for (const [a, b] of voice) {
    for (let i = a * SR; i < b * SR; i++) x[i] = x[i]! + 0.3 * Math.sin((2 * Math.PI * 440 * i) / SR) + 0.15 * Math.sin((2 * Math.PI * 1200 * i) / SR);
  }
  return { x, voice, quiet: [[0.1, 0.9], [2.7, 3.3], [5.2, 5.9]] };
}

describe('FFT', () => {
  it('round-trips and finds a pure tone in the right bin', () => {
    const n = 64;
    const fft = new FFT(n);
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.cos((2 * Math.PI * 5 * i) / n);
    const orig = re.slice();
    fft.transform(re, im);
    const mags = Array.from(re, (r, i) => Math.hypot(r, im[i]!));
    expect(mags.indexOf(Math.max(...mags.slice(0, n / 2)))).toBe(5);
    fft.transform(re, im, true);
    for (let i = 0; i < n; i++) expect(re[i]).toBeCloseTo(orig[i]!, 9);
  });

  it('rejects non power-of-two sizes', () => {
    expect(() => new FFT(100)).toThrow();
  });
});

describe('denoiseChannel', () => {
  it('chooses ~46 ms frames', () => {
    expect(frameSizeFor(48000)).toBe(2048);
    expect(frameSizeFor(44100)).toBe(2048);
    expect(frameSizeFor(16000)).toBe(512);
  });

  it('is transparent with 0 dB reduction and preserves length', () => {
    const { x } = speechLike();
    const y = denoiseChannel(x, SR, { reductionDb: 0, nStd: 1.5 });
    expect(y.length).toBe(x.length);
    expect(Array.from(y.subarray(1000, 1010))).toEqual(Array.from(x.subarray(1000, 1010)));
  });

  it('reduces background noise a lot while keeping the voice level', () => {
    const { x, voice, quiet } = speechLike();
    const y = denoiseChannel(x, SR, DENOISE_STRENGTHS.medium);
    expect(y.length).toBe(x.length);
    for (const [a, b] of quiet) {
      const before = rmsDb(x, a * SR, b * SR);
      const after = rmsDb(y, a * SR, b * SR);
      expect(before - after).toBeGreaterThan(10);
    }
    for (const [a, b] of voice) {
      const s = (a + 0.2) * SR;
      const e = (b - 0.2) * SR;
      expect(Math.abs(rmsDb(y, s, e) - rmsDb(x, s, e))).toBeLessThan(1.5);
    }
  });

  it('stronger settings remove more noise', () => {
    const { x, quiet } = speechLike();
    const [a, b] = quiet[1]!;
    const level = (k: keyof typeof DENOISE_STRENGTHS) => rmsDb(denoiseChannel(x, SR, DENOISE_STRENGTHS[k]), a * SR, b * SR);
    expect(level('light')).toBeGreaterThan(level('medium'));
    expect(level('medium')).toBeGreaterThan(level('strong'));
  });

  it('handles empty and very short input, and aborts on request', () => {
    expect(denoiseChannel(new Float32Array(0), SR, DENOISE_STRENGTHS.medium)).toHaveLength(0);
    expect(denoiseChannel(noise(100, 0.1), SR, DENOISE_STRENGTHS.medium)).toHaveLength(100);
    expect(() => denoiseChannel(noise(SR, 0.1), SR, DENOISE_STRENGTHS.medium, undefined, { shouldAbort: () => true })).toThrow(/aborted/);
  });
});
