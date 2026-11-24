import { describe, expect, it } from 'vitest';
import { DENOISE_STRENGTHS } from '../spectralGate';
import { cleanChannel, dereverbChannel, highPass, normalizeVoice } from '../voiceClean';

const SR = 16000;

/** Deterministic noise. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32 - 0.5;
  };
}

const rms = (x: Float32Array, a: number, b: number) => {
  let e = 0;
  for (let i = a; i < b; i++) e += x[i]! * x[i]!;
  return Math.sqrt(e / (b - a));
};
const db = (r: number) => 20 * Math.log10(r + 1e-12);

/** 0.3 s "syllable" bursts (tone + noise) every 0.8 s, convolved with an exponentially decaying random room tail (RT60 0.6 s). */
function reverberantSpeech(seconds = 4): { dry: Float32Array; wet: Float32Array; bursts: [number, number][] } {
  const n = Math.round(seconds * SR);
  const dry = new Float32Array(n);
  const r = rng(7);
  const bursts: [number, number][] = [];
  for (let t = 0.2; t + 0.3 < seconds - 0.6; t += 0.8) {
    const a = Math.round(t * SR);
    const b = Math.round((t + 0.3) * SR);
    bursts.push([a, b]);
    for (let i = a; i < b; i++) dry[i] = 0.3 * Math.sin((2 * Math.PI * 220 * i) / SR) + 0.2 * r();
  }
  const irLen = Math.round(0.6 * SR);
  const decay = (3 * Math.LN10) / 0.6;
  const ir = new Float32Array(irLen);
  ir[0] = 1;
  const rr = rng(11);
  for (let i = Math.round(0.01 * SR); i < irLen; i++) ir[i] = 0.35 * rr() * Math.exp(-decay * (i / SR));
  const wet = new Float32Array(n);
  // Sparse convolution: only where the dry signal is non-zero.
  for (let i = 0; i < n; i++) {
    const v = dry[i]!;
    if (v === 0) continue;
    const end = Math.min(n, i + irLen);
    for (let j = i; j < end; j++) wet[j] = wet[j]! + v * ir[j - i]!;
  }
  return { dry, wet, bursts };
}

describe('dereverb', () => {
  it('shortens the room tail after each syllable while keeping the syllable itself', () => {
    const { wet, bursts } = reverberantSpeech();
    const out = dereverbChannel(wet, SR, { amount: 0.9, rt60: 0.6 });
    let tailBefore = 0;
    let tailAfter = 0;
    let bodyLoss = 0;
    for (const [a, b] of bursts) {
      const t0 = b + Math.round(0.08 * SR);
      const t1 = b + Math.round(0.35 * SR);
      tailBefore += db(rms(wet, t0, t1));
      tailAfter += db(rms(out, t0, t1));
      bodyLoss += db(rms(wet, a, b)) - db(rms(out, a, b));
    }
    const k = bursts.length;
    expect(tailBefore / k - tailAfter / k).toBeGreaterThan(4); // echo tail at least 4 dB lower
    expect(bodyLoss / k).toBeLessThan(3); // the voice itself stays
  });

  it('is a bypass at amount 0 and keeps the length', () => {
    const x = Float32Array.from({ length: 5000 }, (_, i) => Math.sin(i / 10));
    const y = dereverbChannel(x, SR, { amount: 0 });
    expect(y).toEqual(x);
    expect(dereverbChannel(x, SR, { amount: 0.8 })).toHaveLength(5000);
  });
});

describe('high-pass and level', () => {
  it('removes rumble below 80 Hz and keeps the voice band', () => {
    const n = SR * 2;
    const rumble = Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * 30 * i) / SR));
    const voice = Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * 300 * i) / SR));
    expect(db(rms(highPass(Float32Array.from(rumble), SR), SR, n))).toBeLessThan(db(rms(rumble, SR, n)) - 12);
    expect(db(rms(highPass(Float32Array.from(voice), SR), SR, n))).toBeGreaterThan(db(rms(voice, SR, n)) - 1);
  });

  it('lifts a quiet take to speech level without clipping', () => {
    const x = Float32Array.from({ length: SR }, (_, i) => 0.02 * Math.sin((2 * Math.PI * 200 * i) / SR));
    normalizeVoice(x, SR);
    const peak = Math.max(...Array.from(x, Math.abs));
    expect(peak).toBeLessThanOrEqual(0.89 + 1e-6);
    expect(db(rms(x, 0, SR))).toBeCloseTo(-20, 0);
  });
});

describe('voice preset', () => {
  it('runs the whole chain and returns a same-length, finite signal', () => {
    const { wet } = reverberantSpeech(2);
    const { label: _l, hint: _h, ...opts } = DENOISE_STRENGTHS.voice;
    const out = cleanChannel(wet, SR, opts);
    expect(out).toHaveLength(wet.length);
    expect(out.every(Number.isFinite)).toBe(true);
    expect(out).not.toBe(wet);
  });
});
