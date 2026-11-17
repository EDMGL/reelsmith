/**
 * One-shot instrument samples computed in plain JS (deterministic), played back
 * through Web Audio buffer sources. Physical-ish models are much cheaper here
 * than as node graphs: additive piano with per-partial decay and inharmonicity,
 * Karplus–Strong plucked string, two-operator FM electric piano, mallets and
 * bells, plus noise, vinyl crackle and reverb impulse responses.
 */
import { Rng } from './rng';
import { midiToFreq } from './theory';

const cache = new Map<string, Float32Array>();
const CACHE_LIMIT = 160;

function cached(key: string, make: () => Float32Array): Float32Array {
  let s = cache.get(key);
  if (s) {
    cache.delete(key);
    cache.set(key, s);
    return s;
  }
  s = make();
  cache.set(key, s);
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  return s;
}

export function clearSampleCache(): void {
  cache.clear();
}

/** Sum of exponentially decaying sines, computed with a rotating phasor (no Math.sin per sample). */
function addPartial(out: Float32Array, fs: number, freq: number, amp: number, decay: number, phase = 0, startAt = 0): void {
  if (freq >= fs * 0.45 || amp <= 0) return;
  const w = (2 * Math.PI * freq) / fs;
  const cw = Math.cos(w);
  const sw = Math.sin(w);
  let re = Math.cos(phase);
  let im = Math.sin(phase);
  const k = Math.exp(-1 / (decay * fs));
  let a = amp;
  const n = out.length;
  for (let i = startAt; i < n; i++) {
    out[i]! += im * a;
    const r2 = re * cw - im * sw;
    im = re * sw + im * cw;
    re = r2;
    a *= k;
    if (a < 1e-5) break;
  }
}

function applyAttack(out: Float32Array, fs: number, seconds: number): void {
  const n = Math.min(out.length, Math.round(seconds * fs));
  for (let i = 0; i < n; i++) out[i]! *= i / n;
}

function normalizePeak(out: Float32Array, target = 0.5): Float32Array {
  let m = 0;
  for (let i = 0; i < out.length; i++) m = Math.max(m, Math.abs(out[i]!));
  if (m > 0) for (let i = 0; i < out.length; i++) out[i]! *= target / m;
  return out;
}

/** Piano-like tone. `layer` 0 = soft (darker), 1 = hard (brighter). */
export function pianoSample(midi: number, layer: 0 | 1, fs: number): Float32Array {
  return cached(`piano:${midi}:${layer}:${fs}`, () => {
    const f0 = midiToFreq(midi);
    const len = Math.round(fs * Math.min(4.5, Math.max(1.6, 5.5 - (midi - 40) * 0.05)));
    const out = new Float32Array(len);
    const B = 0.00012 * Math.pow(2, (midi - 60) / 24);
    const rng = new Rng(midi * 7 + layer);
    const bright = layer ? 1.0 : 0.55;
    const partials = Math.min(14, Math.floor((fs * 0.42) / f0));
    const baseDecay = Math.max(0.6, 3.2 - (midi - 48) * 0.035);
    for (let k = 1; k <= partials; k++) {
      const fk = k * f0 * Math.sqrt(1 + B * k * k);
      // Hammer strike position ~1/8 of the string: weakens partials near multiples of 8.
      const strike = Math.abs(Math.sin((Math.PI * k) / 8.3));
      const amp = (strike / Math.pow(k, 1.15)) * Math.pow(bright, k - 1) * (k === 1 ? 1 : 0.9);
      const d = baseDecay / Math.pow(k, 0.55);
      // Two slightly detuned strings per note: prompt + aftersound decay and gentle beating.
      addPartial(out, fs, fk, amp * 0.55, d * 0.35, rng.next() * 6.28);
      addPartial(out, fs, fk * (1 + 0.0007 * (k <= 3 ? 1 : 0.3)), amp * 0.45, d, rng.next() * 6.28);
    }
    // Hammer thump: short low-passed noise burst.
    const thump = Math.round(fs * 0.012);
    let lp = 0;
    for (let i = 0; i < thump && i < len; i++) {
      lp += (rng.next() * 2 - 1 - lp) * 0.15;
      out[i]! += lp * 0.25 * bright * (1 - i / thump);
    }
    applyAttack(out, fs, 0.002);
    return normalizePeak(out);
  });
}

/** Karplus–Strong plucked string (nylon/steel-ish via `bright` 0..1), tuned with an all-pass fractional delay. */
export function stringSample(midi: number, bright: number, fs: number): Float32Array {
  return cached(`ks:${midi}:${bright.toFixed(2)}:${fs}`, () => {
    const f0 = midiToFreq(midi);
    const len = Math.round(fs * 2.6);
    const out = new Float32Array(len);
    const period = fs / f0;
    let N = Math.floor(period - 0.5);
    let frac = period - 0.5 - N;
    if (frac < 0.1) {
      N -= 1;
      frac += 1;
    }
    const C = (1 - frac) / (1 + frac);
    const line = new Float32Array(N);
    const rng = new Rng(midi * 13 + Math.round(bright * 100));
    // Excitation: noise low-passed by pick softness, with a pick-position comb.
    let lp = 0;
    const soft = 0.2 + bright * 0.6;
    for (let i = 0; i < N; i++) {
      lp += (rng.next() * 2 - 1 - lp) * soft;
      line[i] = lp;
    }
    const pickPos = Math.max(1, Math.round(N * 0.17));
    for (let i = N - 1; i >= pickPos; i--) line[i]! -= line[i - pickPos]! * 0.7;
    const t60 = 1.2 + bright * 2.2;
    const loopGain = Math.pow(10, -3 / (f0 * t60));
    let p = 0;
    let prevCur = 0;
    let apX1 = 0;
    let apY1 = 0;
    for (let i = 0; i < len; i++) {
      const cur = line[p]!;
      out[i] = cur;
      const avg = 0.5 * (cur + prevCur);
      prevCur = cur;
      const x = loopGain * avg;
      const ap = C * x + apX1 - C * apY1;
      apX1 = x;
      apY1 = ap;
      line[p] = ap;
      p = p + 1 === N ? 0 : p + 1;
    }
    applyAttack(out, fs, 0.001);
    let z = 0;
    const smooth = 0.5 + bright * 0.45;
    for (let i = 0; i < len; i++) {
      z += (out[i]! - z) * smooth;
      out[i] = z;
    }
    return normalizePeak(out);
  });
}

/** Two-operator FM electric piano (tine + bark), velocity layer 0/1. */
export function epianoSample(midi: number, layer: 0 | 1, fs: number): Float32Array {
  return cached(`ep:${midi}:${layer}:${fs}`, () => {
    const f = midiToFreq(midi);
    const len = Math.round(fs * Math.max(1.5, 3.2 - (midi - 48) * 0.03));
    const out = new Float32Array(len);
    const idx0 = layer ? 1.6 : 0.8;
    const tine = layer ? 0.18 : 0.08;
    const w = (2 * Math.PI * f) / fs;
    const wt = (2 * Math.PI * f * 14) / fs;
    const ampDecay = Math.max(0.7, 2.4 - (midi - 48) * 0.02);
    for (let i = 0; i < len; i++) {
      const t = i / fs;
      const mod = Math.sin(w * i) * idx0 * Math.exp(-t / 0.5) + Math.sin(wt * i) * tine * 8 * Math.exp(-t / 0.03);
      const env = 0.65 * Math.exp(-t / ampDecay) + 0.35 * Math.exp(-t / (ampDecay * 0.25));
      out[i] = Math.sin(w * i + mod) * env;
    }
    applyAttack(out, fs, 0.0015);
    return normalizePeak(out);
  });
}

/** Mallet (marimba/kalimba-like, `hard` 0..1). */
export function malletSample(midi: number, hard: number, fs: number): Float32Array {
  return cached(`mallet:${midi}:${hard.toFixed(2)}:${fs}`, () => {
    const f = midiToFreq(midi);
    const len = Math.round(fs * 1.4);
    const out = new Float32Array(len);
    const d = Math.max(0.25, 1.1 - (midi - 60) * 0.015);
    addPartial(out, fs, f, 1, d);
    addPartial(out, fs, f * 3.93, 0.25 * hard, d * 0.18);
    addPartial(out, fs, f * 9.2, 0.08 * hard, d * 0.06);
    addPartial(out, fs, f * 2.01, 0.06, d * 0.4);
    applyAttack(out, fs, 0.0015);
    return normalizePeak(out);
  });
}

/** Bell/glockenspiel (inharmonic partials). */
export function bellSample(midi: number, fs: number): Float32Array {
  return cached(`bell:${midi}:${fs}`, () => {
    const f = midiToFreq(midi);
    const len = Math.round(fs * 2.4);
    const out = new Float32Array(len);
    const ratios = [1, 2.0, 2.76, 4.07, 5.4, 6.8];
    const amps = [1, 0.35, 0.45, 0.2, 0.12, 0.06];
    const decays = [1.6, 1.0, 0.7, 0.4, 0.25, 0.15];
    ratios.forEach((r, i) => addPartial(out, fs, f * r, amps[i]!, decays[i]!, i));
    applyAttack(out, fs, 0.001);
    return normalizePeak(out);
  });
}

/** Deterministic white noise. */
export function noiseSample(seconds: number, fs: number, seed = 1): Float32Array {
  return cached(`noise:${seconds}:${fs}:${seed}`, () => {
    const rng = new Rng(seed);
    const out = new Float32Array(Math.round(seconds * fs));
    for (let i = 0; i < out.length; i++) out[i] = rng.next() * 2 - 1;
    return out;
  });
}

/** Vinyl crackle bed (sparse clicks + soft hiss), loopable length `seconds`. */
export function crackleSample(seconds: number, fs: number, seed: number): Float32Array {
  return cached(`crackle:${seconds.toFixed(4)}:${fs}:${seed}`, () => {
    const rng = new Rng(seed);
    const n = Math.round(seconds * fs);
    const out = new Float32Array(n);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      lp += (rng.next() * 2 - 1 - lp) * 0.08;
      out[i] = lp * 0.08;
    }
    const clicks = Math.round(seconds * 14);
    for (let k = 0; k < clicks; k++) {
      const at = Math.floor(rng.next() * n);
      const amp = Math.pow(rng.next(), 3) * 0.9 + 0.05;
      const sign = rng.chance(0.5) ? 1 : -1;
      const w = 2 + Math.floor(rng.next() * 6);
      for (let j = 0; j < w * 4; j++) out[(at + j) % n]! += sign * amp * Math.exp(-j / w) * (j % 2 ? -0.5 : 1);
    }
    return out;
  });
}

/**
 * Stereo reverb impulse response: decorrelated noise with an exponential decay,
 * frequency-dependent damping (high frequencies die faster), a short pre-delay
 * and a few early reflections. Peak-normalised; the send level sets the amount.
 */
export function reverbImpulse(seconds: number, brightness: number, preDelay: number, fs: number): [Float32Array, Float32Array] {
  const key = `ir:${seconds}:${brightness}:${preDelay}:${fs}`;
  const l = cached(`${key}:L`, () => makeIr(seconds, brightness, preDelay, fs, 11));
  const r = cached(`${key}:R`, () => makeIr(seconds, brightness, preDelay, fs, 23));
  return [l, r];
}

function makeIr(seconds: number, brightness: number, preDelay: number, fs: number, seed: number): Float32Array {
  const rng = new Rng(seed);
  const pre = Math.round(preDelay * fs);
  const n = pre + Math.round(seconds * fs);
  const out = new Float32Array(n);
  let lp = 0;
  for (let i = pre; i < n; i++) {
    const t = (i - pre) / fs;
    const env = Math.exp((-6.9 * t) / seconds);
    // Damping: the low-pass coefficient falls over time (darker tail).
    const coef = Math.max(0.04, (0.25 + 0.7 * brightness) * Math.exp(-t * (2.5 - brightness * 1.5)));
    lp += (rng.next() * 2 - 1 - lp) * coef;
    out[i] = lp * env;
  }
  // Early reflections.
  for (let k = 0; k < 6; k++) {
    const at = pre + Math.round((0.007 + rng.next() * 0.035) * fs);
    if (at < n) out[at]! += (rng.next() < 0.5 ? -1 : 1) * (0.35 - k * 0.04);
  }
  // Fade in over 2 ms to avoid a click at the onset of the tail.
  for (let i = 0; i < Math.round(0.002 * fs); i++) out[pre + i]! *= i / (0.002 * fs);
  return normalizePeak(out, 0.6);
}
