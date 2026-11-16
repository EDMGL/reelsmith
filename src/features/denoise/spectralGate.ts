/**
 * Stationary noise reduction by spectral gating (pure, no DOM: runs in a worker
 * and in unit tests).
 *
 * 1. Noise profile: the quietest ~15% of STFT frames (by time-domain energy)
 *    are assumed to be "background only"; per frequency bin we take the mean
 *    and standard deviation of their level in dB.
 * 2. Gate: each STFT bin above `mean + nStd * std` passes, bins below are
 *    attenuated by `reductionDb` (soft sigmoid transition, not a hard switch).
 * 3. The gain mask is smoothed across neighbouring bins and over time (instant
 *    attack, ~80 ms release) to avoid "musical noise", then the signal is
 *    resynthesized by weighted overlap-add (output length == input length).
 *
 * Good at constant background noise (fan, AC hum, hiss, room tone, wind-ish
 * rumble). It does not remove non-stationary noise such as music or voices.
 */

export interface DenoiseOptions {
  /** How much noise bins are attenuated, dB (0 = bypass). */
  reductionDb: number;
  /** Threshold above the noise mean, in noise standard deviations. */
  nStd: number;
}

export type DenoiseStrength = 'light' | 'medium' | 'strong';

export const DENOISE_STRENGTHS: Record<DenoiseStrength, DenoiseOptions & { label: string; hint: string }> = {
  light: { label: 'Light', reductionDb: 9, nStd: 1.0, hint: 'Gentle cleanup, keeps the room sound natural' },
  medium: { label: 'Medium', reductionDb: 15, nStd: 1.5, hint: 'Removes most hum and hiss (recommended)' },
  strong: { label: 'Strong', reductionDb: 24, nStd: 2.0, hint: 'Maximum reduction; may sound slightly processed' },
};

// ---------------------------------------------------------------------------
// FFT (iterative radix-2, in place)
// ---------------------------------------------------------------------------

export class FFT {
  readonly size: number;
  private readonly rev: Uint32Array;
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;

  constructor(size: number) {
    if (size < 2 || (size & (size - 1)) !== 0) throw new Error(`FFT size must be a power of two, got ${size}`);
    this.size = size;
    const bits = Math.log2(size);
    this.rev = new Uint32Array(size);
    for (let i = 0; i < size; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.cos = new Float64Array(size / 2);
    this.sin = new Float64Array(size / 2);
    for (let i = 0; i < size / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / size);
      this.sin[i] = Math.sin((2 * Math.PI * i) / size);
    }
  }

  /** In-place transform. `inverse` also scales by 1/N. */
  transform(re: Float64Array, im: Float64Array, inverse = false): void {
    const n = this.size;
    const rev = this.rev;
    for (let i = 0; i < n; i++) {
      const j = rev[i]!;
      if (j > i) {
        let t = re[i]!;
        re[i] = re[j]!;
        re[j] = t;
        t = im[i]!;
        im[i] = im[j]!;
        im[j] = t;
      }
    }
    const sign = inverse ? 1 : -1;
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1;
      const step = n / len;
      for (let i = 0; i < n; i += len) {
        for (let k = 0; k < half; k++) {
          const wr = this.cos[k * step]!;
          const wi = sign * this.sin[k * step]!;
          const a = i + k;
          const b = a + half;
          const xr = re[b]! * wr - im[b]! * wi;
          const xi = re[b]! * wi + im[b]! * wr;
          re[b] = re[a]! - xr;
          im[b] = im[a]! - xi;
          re[a] = re[a]! + xr;
          im[a] = im[a]! + xi;
        }
      }
    }
    if (inverse) {
      for (let i = 0; i < n; i++) {
        re[i] = re[i]! / n;
        im[i] = im[i]! / n;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// STFT helpers
// ---------------------------------------------------------------------------

/** ~46 ms frames: 2048 at 44.1/48 kHz, 1024 at 22.05/24 kHz, 512 at 8-16 kHz... */
export function frameSizeFor(sampleRate: number): number {
  let n = 256;
  while (n * 2 <= sampleRate * 0.05) n *= 2;
  return n;
}

function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

const MIN_DB = -120;
const toDb = (power: number) => Math.max(MIN_DB, 10 * Math.log10(power + 1e-20));

export interface NoiseProfile {
  mean: Float64Array;
  std: Float64Array;
}

/** Number of STFT frames for a signal of `len` samples (frame starts at -n+hop .. len). */
function frameCount(len: number, n: number, hop: number): number {
  return Math.ceil((len + n) / hop);
}

/** Frame `f` starts at sample `f * hop - n + hop` (so the first frame overlaps sample 0). */
function frameStart(f: number, n: number, hop: number): number {
  return f * hop - n + hop;
}

export function estimateNoiseProfile(x: Float32Array, sampleRate: number, quietFraction = 0.15): NoiseProfile {
  const n = frameSizeFor(sampleRate);
  const hop = n / 4;
  const bins = n / 2 + 1;
  const frames = frameCount(x.length, n, hop);
  // Pass 1: time-domain energy per frame (cheap), pick the quietest frames.
  const energy: { f: number; e: number }[] = [];
  for (let f = 0; f < frames; f++) {
    const s0 = frameStart(f, n, hop);
    if (s0 < 0 || s0 + n > x.length) continue; // only full frames
    let e = 0;
    for (let i = 0; i < n; i++) e += x[s0 + i]! * x[s0 + i]!;
    energy.push({ f, e });
  }
  const mean = new Float64Array(bins).fill(MIN_DB);
  const std = new Float64Array(bins);
  if (energy.length === 0) return { mean, std };
  energy.sort((a, b) => a.e - b.e);
  const pick = energy.slice(0, Math.max(Math.min(8, energy.length), Math.round(energy.length * quietFraction)));
  // Pass 2: spectra of the chosen frames.
  const fft = new FFT(n);
  const w = hann(n);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const sum = new Float64Array(bins);
  const sumSq = new Float64Array(bins);
  for (const { f } of pick) {
    const s0 = frameStart(f, n, hop);
    for (let i = 0; i < n; i++) {
      re[i] = x[s0 + i]! * w[i]!;
      im[i] = 0;
    }
    fft.transform(re, im);
    for (let k = 0; k < bins; k++) {
      const db = toDb(re[k]! * re[k]! + im[k]! * im[k]!);
      sum[k] = sum[k]! + db;
      sumSq[k] = sumSq[k]! + db * db;
    }
  }
  for (let k = 0; k < bins; k++) {
    const m = sum[k]! / pick.length;
    mean[k] = m;
    std[k] = Math.sqrt(Math.max(0, sumSq[k]! / pick.length - m * m));
  }
  return { mean, std };
}

export interface ProgressHooks {
  onProgress?: (fraction: number) => void;
  shouldAbort?: () => boolean;
}

/** Denoises one channel. Returns a new array of the same length. */
export function denoiseChannel(x: Float32Array, sampleRate: number, opts: DenoiseOptions, profile = estimateNoiseProfile(x, sampleRate), hooks: ProgressHooks = {}): Float32Array {
  const out = new Float32Array(x.length);
  if (x.length === 0) return out;
  if (opts.reductionDb <= 0) {
    out.set(x);
    return out;
  }
  const n = frameSizeFor(sampleRate);
  const hop = n / 4;
  const bins = n / 2 + 1;
  const frames = frameCount(x.length, n, hop);
  const fft = new FFT(n);
  const w = hann(n);
  const acc = new Float64Array(x.length);
  const norm = new Float64Array(x.length);
  const floor = Math.pow(10, -opts.reductionDb / 20);
  const thr = new Float64Array(bins);
  for (let k = 0; k < bins; k++) thr[k] = profile.mean[k]! + opts.nStd * profile.std[k]!;

  // The gate mask is averaged over a (2*T+1) frames x (2*F+1) bins box, so a
  // frame is resynthesized T frames after its FFT: spectra + masks of the last
  // 2*T+1 frames live in ring buffers.
  const T = 2;
  const F = 2;
  const SLOPE_DB = 1.5;
  const ring = 2 * T + 1;
  const specRe = Array.from({ length: ring }, () => new Float64Array(n));
  const specIm = Array.from({ length: ring }, () => new Float64Array(n));
  const masks = Array.from({ length: ring }, () => new Float64Array(bins));
  const gain = new Float64Array(bins);
  const re = new Float64Array(n);
  const im = new Float64Array(n);

  const analyze = (f: number) => {
    const slot = f % ring;
    const r = specRe[slot]!;
    const m = specIm[slot]!;
    const s0 = frameStart(f, n, hop);
    for (let i = 0; i < n; i++) {
      const s = s0 + i;
      r[i] = s >= 0 && s < x.length ? x[s]! * w[i]! : 0;
      m[i] = 0;
    }
    fft.transform(r, m);
    const raw = masks[slot]!;
    for (let k = 0; k < bins; k++) {
      const db = toDb(r[k]! * r[k]! + m[k]! * m[k]!);
      raw[k] = 1 / (1 + Math.exp(-(db - thr[k]!) / SLOPE_DB));
    }
  };

  const synthesize = (f: number) => {
    const lo = Math.max(0, f - T);
    const hi = Math.min(frames - 1, f + T);
    for (let k = 0; k < bins; k++) {
      const k0 = Math.max(0, k - F);
      const k1 = Math.min(bins - 1, k + F);
      let s = 0;
      for (let g = lo; g <= hi; g++) {
        const mk = masks[g % ring]!;
        for (let j = k0; j <= k1; j++) s += mk[j]!;
      }
      gain[k] = floor + ((1 - floor) * s) / ((hi - lo + 1) * (k1 - k0 + 1));
    }
    const slot = f % ring;
    re.set(specRe[slot]!);
    im.set(specIm[slot]!);
    for (let k = 0; k < bins; k++) {
      re[k] = re[k]! * gain[k]!;
      im[k] = im[k]! * gain[k]!;
      if (k > 0 && k < n / 2) {
        re[n - k] = re[n - k]! * gain[k]!;
        im[n - k] = im[n - k]! * gain[k]!;
      }
    }
    fft.transform(re, im, true);
    const s0 = frameStart(f, n, hop);
    for (let i = 0; i < n; i++) {
      const s = s0 + i;
      if (s < 0 || s >= x.length) continue;
      acc[s] = acc[s]! + re[i]! * w[i]!;
      norm[s] = norm[s]! + w[i]! * w[i]!;
    }
  };

  for (let f = 0; f < frames + T; f++) {
    if ((f & 255) === 0) {
      if (hooks.shouldAbort?.()) throw Object.assign(new Error('Noise reduction aborted'), { name: 'AbortError' });
      hooks.onProgress?.(f / (frames + T));
    }
    if (f < frames) analyze(f);
    if (f - T >= 0) synthesize(f - T);
  }
  for (let i = 0; i < x.length; i++) out[i] = norm[i]! > 1e-9 ? acc[i]! / norm[i]! : 0;
  hooks.onProgress?.(1);
  return out;
}

/** Denoises every channel (each with its own noise profile). */
export function denoiseChannels(channels: Float32Array[], sampleRate: number, opts: DenoiseOptions, hooks: ProgressHooks = {}): Float32Array[] {
  return channels.map((ch, c) =>
    denoiseChannel(ch, sampleRate, opts, undefined, {
      shouldAbort: hooks.shouldAbort,
      onProgress: (f) => hooks.onProgress?.((c + f) / channels.length),
    }),
  );
}
