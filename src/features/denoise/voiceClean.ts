/**
 * Speech cleanup chain (pure, no DOM: runs in the denoise worker, in the
 * voiceover recorder and in unit tests):
 *
 * 1. High-pass at 80 Hz: desk thumps, rumble, AC hum below the voice.
 * 2. De-reverb (late-reverberation suppression, Lebart et al. 2001): room echo
 *    is modelled as a delayed, exponentially decaying copy of what was said
 *    `delay` earlier. Its expected power per frequency is subtracted
 *    spectrally (with a floor), which dries out the "talking in a bathroom"
 *    tail without touching the direct sound.
 * 3. Spectral-gate noise reduction (spectralGate.ts).
 * 4. Level: speech brought to ~-20 dBFS RMS (at most +18 dB), peaks kept below -1 dBFS.
 */
import { FFT, denoiseChannel, frameSizeFor, type DenoiseOptions, type ProgressHooks } from './spectralGate';

/** 2nd-order Butterworth high-pass (RBJ biquad), in place. */
export function highPass(x: Float32Array, sampleRate: number, cutoff = 80): Float32Array {
  const w0 = (2 * Math.PI * cutoff) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Math.SQRT1_2);
  const a0 = 1 + alpha;
  const b0 = (1 + cos) / 2 / a0;
  const b1 = -(1 + cos) / a0;
  const b2 = b0;
  const a1 = (-2 * cos) / a0;
  const a2 = (1 - alpha) / a0;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i]!;
    const y = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = xi;
    y2 = y1;
    y1 = y;
    x[i] = y;
  }
  return x;
}

export interface DereverbOptions {
  /** 0..1: how hard the estimated echo is removed. */
  amount: number;
  /** Assumed reverberation time (s) of the room. */
  rt60?: number;
  /** Start of the "late" echo (s): earlier reflections are left alone (they carry no smear). */
  delay?: number;
  /** Lowest gain, dB (keeps it natural, avoids holes). */
  floorDb?: number;
}

/** Suppresses late room reverberation. Returns a new array of the same length. */
export function dereverbChannel(x: Float32Array, sampleRate: number, o: DereverbOptions, hooks: ProgressHooks = {}): Float32Array {
  const out = new Float32Array(x.length);
  if (x.length === 0 || !(o.amount > 0)) {
    out.set(x);
    return out;
  }
  const n = frameSizeFor(sampleRate);
  const hop = n / 4;
  const bins = n / 2 + 1;
  const frames = Math.ceil((x.length + n) / hop);
  const rt60 = o.rt60 ?? 0.5;
  const delta = (3 * Math.LN10) / rt60;
  const D = Math.max(1, Math.round(((o.delay ?? 0.05) * sampleRate) / hop));
  const decay = Math.exp(-2 * delta * D * (hop / sampleRate));
  const floor = Math.pow(10, (o.floorDb ?? -12) / 20);
  const fft = new FFT(n);
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);

  // Smoothed power history (ring of D+1 frames) and the running gain (for release smoothing).
  const hist = Array.from({ length: D + 1 }, () => new Float64Array(bins));
  const prevGain = new Float64Array(bins).fill(1);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const acc = new Float64Array(x.length);
  const norm = new Float64Array(x.length);
  const SMOOTH = 0.6; // power smoothing between frames
  const RELEASE = 0.5; // gain may rise instantly, falls at most this fast

  for (let f = 0; f < frames; f++) {
    if ((f & 255) === 0) {
      if (hooks.shouldAbort?.()) throw Object.assign(new Error('Cleanup aborted'), { name: 'AbortError' });
      hooks.onProgress?.(f / frames);
    }
    const s0 = f * hop - n + hop;
    for (let i = 0; i < n; i++) {
      const s = s0 + i;
      re[i] = s >= 0 && s < x.length ? x[s]! * w[i]! : 0;
      im[i] = 0;
    }
    fft.transform(re, im);
    const cur = hist[f % (D + 1)]!;
    const prev = hist[(f + D) % (D + 1)]!; // frame f-1
    const late = hist[(f + 1) % (D + 1)]!; // frame f-D (oldest in the ring)
    for (let k = 0; k < bins; k++) {
      const p = re[k]! * re[k]! + im[k]! * im[k]!;
      cur[k] = f === 0 ? p : SMOOTH * prev[k]! + (1 - SMOOTH) * p;
    }
    for (let k = 0; k < bins; k++) {
      const pl = f >= D ? decay * late[k]! : 0;
      let g = 1 - (o.amount * pl) / (cur[k]! + 1e-20);
      g = Math.max(floor, Math.min(1, g));
      g = Math.max(g, prevGain[k]! * RELEASE);
      prevGain[k] = g;
    }
    for (let k = 0; k < bins; k++) {
      const g = prevGain[k]!;
      re[k] = re[k]! * g;
      im[k] = im[k]! * g;
      if (k > 0 && k < n / 2) {
        re[n - k] = re[n - k]! * g;
        im[n - k] = im[n - k]! * g;
      }
    }
    fft.transform(re, im, true);
    for (let i = 0; i < n; i++) {
      const s = s0 + i;
      if (s < 0 || s >= x.length) continue;
      acc[s] = acc[s]! + re[i]! * w[i]!;
      norm[s] = norm[s]! + w[i]! * w[i]!;
    }
  }
  for (let i = 0; i < x.length; i++) out[i] = norm[i]! > 1e-9 ? acc[i]! / norm[i]! : 0;
  hooks.onProgress?.(1);
  return out;
}

/** Brings speech to ~`targetDb` RMS (measured on the louder half of 50 ms windows), peaks <= -1 dBFS. In place. */
export function normalizeVoice(x: Float32Array, sampleRate: number, targetDb = -20, maxGainDb = 18): Float32Array {
  const win = Math.max(1, Math.round(sampleRate * 0.05));
  const rms: number[] = [];
  let peak = 0;
  for (let s = 0; s < x.length; s += win) {
    let e = 0;
    const end = Math.min(x.length, s + win);
    for (let i = s; i < end; i++) {
      e += x[i]! * x[i]!;
      peak = Math.max(peak, Math.abs(x[i]!));
    }
    rms.push(e / (end - s));
  }
  if (peak <= 1e-6 || rms.length === 0) return x;
  rms.sort((a, b) => b - a);
  const loud = rms.slice(0, Math.max(1, Math.ceil(rms.length / 2)));
  const level = Math.sqrt(loud.reduce((a, b) => a + b, 0) / loud.length);
  const want = Math.pow(10, targetDb / 20) / Math.max(1e-9, level);
  const gain = Math.min(want, Math.pow(10, maxGainDb / 20), 0.89 / peak);
  for (let i = 0; i < x.length; i++) x[i] = x[i]! * gain;
  return x;
}

/** The whole chain for one channel, as selected by `opts` (`voice` / `dereverb` flags). */
export function cleanChannel(x: Float32Array, sampleRate: number, opts: DenoiseOptions, hooks: ProgressHooks = {}): Float32Array {
  const stages = (opts.voice ? 1 : 0) + (opts.dereverb ? 1 : 0) + 1;
  let done = 0;
  const sub = (): ProgressHooks => {
    const base = done++;
    return { shouldAbort: hooks.shouldAbort, onProgress: (f) => hooks.onProgress?.((base + f) / stages) };
  };
  let y: Float32Array = x;
  if (opts.voice) {
    y = highPass(Float32Array.from(y), sampleRate);
    sub().onProgress?.(1);
  }
  if (opts.dereverb) y = dereverbChannel(y, sampleRate, { amount: opts.dereverb }, sub());
  y = denoiseChannel(y, sampleRate, opts, undefined, sub());
  if (opts.voice) normalizeVoice(y, sampleRate);
  return y;
}

/** `cleanChannel` for every channel. */
export function cleanChannels(channels: Float32Array[], sampleRate: number, opts: DenoiseOptions, hooks: ProgressHooks = {}): Float32Array[] {
  return channels.map((ch, c) =>
    cleanChannel(ch, sampleRate, opts, {
      shouldAbort: hooks.shouldAbort,
      onProgress: (f) => hooks.onProgress?.((c + f) / channels.length),
    }),
  );
}
