/**
 * Pure DSP on plain PCM (no Web Audio): loop wrapping, a look-ahead peak
 * limiter (optionally circular for seamless loops), ITU-R BS.1770 loudness
 * (K-weighted, gated), normalisation, loop tiling and analysis helpers.
 */

export interface Pcm {
  sampleRate: number;
  channels: Float32Array[];
}

export const pcmLength = (p: Pcm): number => p.channels[0]?.length ?? 0;
export const pcmDuration = (p: Pcm): number => pcmLength(p) / p.sampleRate;

/**
 * Folds everything past `loopLength` back onto the start (reverb/delay/note
 * tails of the last bars ring into the first ones), so playing the result in a
 * loop is identical to an endless performance — no gap, no click at the seam.
 */
export function wrapTail(p: Pcm, loopLength: number): Pcm {
  return {
    sampleRate: p.sampleRate,
    channels: p.channels.map((src) => {
      const out = new Float32Array(loopLength);
      for (let off = 0; off < src.length; off += loopLength) {
        const n = Math.min(loopLength, src.length - off);
        for (let i = 0; i < n; i++) out[i]! += src[off + i]!;
      }
      return out;
    }),
  };
}

/** Repeats a loop to exactly `samples` frames. */
export function tileLoop(loop: Pcm, samples: number): Pcm {
  const L = pcmLength(loop);
  return {
    sampleRate: loop.sampleRate,
    channels: loop.channels.map((src) => {
      const out = new Float32Array(samples);
      for (let off = 0; off < samples; off += L) out.set(src.subarray(0, Math.min(L, samples - off)), off);
      return out;
    }),
  };
}

export function peak(p: Pcm): number {
  let m = 0;
  for (const ch of p.channels) for (let i = 0; i < ch.length; i++) m = Math.max(m, Math.abs(ch[i]!));
  return m;
}

export function rms(p: Pcm): number {
  let s = 0;
  let n = 0;
  for (const ch of p.channels) {
    for (let i = 0; i < ch.length; i++) s += ch[i]! * ch[i]!;
    n += ch.length;
  }
  return n ? Math.sqrt(s / n) : 0;
}

export const toDb = (x: number): number => (x > 0 ? 20 * Math.log10(x) : -Infinity);
export const fromDb = (db: number): number => Math.pow(10, db / 20);

// ---------------------------------------------------------------------------
// Loudness (BS.1770-4)
// ---------------------------------------------------------------------------

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

function kWeighting(fs: number): [Biquad, Biquad] {
  // Coefficients derived for any sample rate (same as libebur128 / pyloudnorm).
  let f0 = 1681.974450955533;
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / fs);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf: Biquad = {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / fs);
  a0 = 1 + K / Q + K * K;
  const hp: Biquad = { b0: 1, b1: -2, b2: 1, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0 };
  return [shelf, hp];
}

function filter(x: Float32Array, f: Biquad): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i]!;
    const yi = f.b0 * xi + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
    x2 = x1;
    x1 = xi;
    y2 = y1;
    y1 = yi;
    y[i] = yi;
  }
  return y;
}

/** Mean-square of 400 ms blocks (75 % overlap) of the K-weighted signal, summed over channels. */
function blockPowers(p: Pcm): number[] {
  const [shelf, hp] = kWeighting(p.sampleRate);
  const weighted = p.channels.map((ch) => filter(filter(ch, shelf), hp));
  const n = pcmLength(p);
  const block = Math.round(0.4 * p.sampleRate);
  const hop = Math.round(0.1 * p.sampleRate);
  const out: number[] = [];
  if (n < block) {
    // Short sound: one block over everything (padded with silence).
    let z = 0;
    for (const w of weighted) {
      let s = 0;
      for (let i = 0; i < n; i++) s += w[i]! * w[i]!;
      z += s / block;
    }
    return [z];
  }
  for (let start = 0; start + block <= n; start += hop) {
    let z = 0;
    for (const w of weighted) {
      let s = 0;
      for (let i = start; i < start + block; i++) s += w[i]! * w[i]!;
      z += s / block;
    }
    out.push(z);
  }
  return out;
}

const blockLoudness = (z: number) => -0.691 + 10 * Math.log10(Math.max(z, 1e-12));

/** Integrated loudness, LUFS (gated). -Infinity for silence. */
export function integratedLoudness(p: Pcm): number {
  const zs = blockPowers(p).filter((z) => blockLoudness(z) > -70);
  if (!zs.length) return -Infinity;
  const rel = blockLoudness(zs.reduce((a, b) => a + b, 0) / zs.length) - 10;
  const gated = zs.filter((z) => blockLoudness(z) > rel);
  if (!gated.length) return -Infinity;
  return blockLoudness(gated.reduce((a, b) => a + b, 0) / gated.length);
}

/** Loudest 400 ms block, LUFS (useful for short one-shots). */
export function maxMomentaryLoudness(p: Pcm): number {
  const zs = blockPowers(p);
  return zs.length ? blockLoudness(Math.max(...zs)) : -Infinity;
}

// ---------------------------------------------------------------------------
// Limiter
// ---------------------------------------------------------------------------

export interface LimiterOptions {
  /** Max absolute sample value after limiting. */
  ceiling: number;
  lookahead?: number;
  release?: number;
  /** Treat the buffer as a loop (gain at the end continues into the start). */
  circular?: boolean;
}

/** Sliding minimum over [i - w, i + w] (clamped or circular), O(n). */
function slidingMin(x: Float32Array, w: number, circular: boolean): Float32Array {
  const n = x.length;
  const ext = new Float32Array(n + 2 * w);
  for (let i = 0; i < ext.length; i++) {
    let j = i - w;
    if (circular) j = ((j % n) + n) % n;
    else j = Math.max(0, Math.min(n - 1, j));
    ext[i] = x[j]!;
  }
  const out = new Float32Array(n);
  const dq = new Int32Array(ext.length);
  let head = 0;
  let tail = 0;
  const win = 2 * w + 1;
  for (let i = 0; i < ext.length; i++) {
    while (tail > head && ext[dq[tail - 1]!]! >= ext[i]!) tail--;
    dq[tail++] = i;
    if (dq[head]! <= i - win) head++;
    const centre = i - w;
    if (centre >= w && centre < n + w) out[centre - w] = ext[dq[head]!]!;
  }
  return out;
}

/**
 * Look-ahead peak limiter (in place): the gain dips smoothly *before* a peak
 * (no overshoot, no hard clipping) and recovers with `release`.
 * Returns the minimum gain applied.
 */
export function limitInPlace(p: Pcm, o: LimiterOptions): number {
  const n = pcmLength(p);
  if (!n) return 1;
  const fs = p.sampleRate;
  const la = Math.max(1, Math.round((o.lookahead ?? 0.005) * fs));
  const circular = !!o.circular;
  const req = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (const ch of p.channels) m = Math.max(m, Math.abs(ch[i]!));
    req[i] = m > o.ceiling ? o.ceiling / m : 1;
  }
  const mins = slidingMin(req, la, circular);
  // Box-smooth over ±la/2: every averaged value is a window minimum that contains i, so it stays ≤ req[i].
  const h = Math.max(1, Math.floor(la / 2));
  const smooth = new Float32Array(n);
  let acc = 0;
  const at = (j: number) => (circular ? mins[((j % n) + n) % n]! : mins[Math.max(0, Math.min(n - 1, j))]!);
  for (let j = -h; j <= h; j++) acc += at(j);
  for (let i = 0; i < n; i++) {
    smooth[i] = acc / (2 * h + 1);
    acc += at(i + h + 1) - at(i - h);
  }
  // Release: instant down (already smooth), exponential recovery up.
  const rc = 1 - Math.exp(-1 / ((o.release ?? 0.08) * fs));
  let g = 1;
  if (circular) {
    for (let i = 0; i < n; i++) g = Math.min(smooth[i]!, g + (1 - g) * rc);
  }
  let minG = 1;
  for (let i = 0; i < n; i++) {
    g = Math.min(smooth[i]!, g + (1 - g) * rc);
    if (g < minG) minG = g;
    for (const ch of p.channels) ch[i]! *= g;
  }
  // Numerical safety: nothing may exceed the ceiling.
  for (const ch of p.channels) for (let i = 0; i < n; i++) ch[i] = Math.max(-o.ceiling, Math.min(o.ceiling, ch[i]!));
  return minG;
}

export function scaleInPlace(p: Pcm, gain: number): void {
  for (const ch of p.channels) for (let i = 0; i < ch.length; i++) ch[i]! *= gain;
}

export function clonePcm(p: Pcm): Pcm {
  return { sampleRate: p.sampleRate, channels: p.channels.map((c) => c.slice()) };
}

export interface NormalizeOptions {
  /** Integrated loudness target, LUFS (loops) or max momentary target (one-shots). */
  targetLufs: number;
  ceiling: number;
  circular?: boolean;
  /** Measure with max momentary loudness instead of integrated (short sounds). */
  momentary?: boolean;
  /** Never boost more than this (dB) — very quiet material stays quiet. */
  maxBoostDb?: number;
}

/**
 * Brings `p` to the loudness target with the limiter guarding the ceiling.
 * Two passes, because limiting lowers the loudness a little.
 */
export function normalize(p: Pcm, o: NormalizeOptions): { gainDb: number; lufs: number; peak: number } {
  const measure = (x: Pcm) => (o.momentary ? maxMomentaryLoudness(x) : integratedLoudness(x));
  const before = measure(p);
  if (!Number.isFinite(before)) return { gainDb: 0, lufs: before, peak: peak(p) };
  let gainDb = Math.min(o.targetLufs - before, o.maxBoostDb ?? 30);
  let out = p;
  for (let pass = 0; pass < 2; pass++) {
    out = clonePcm(p);
    scaleInPlace(out, fromDb(gainDb));
    limitInPlace(out, { ceiling: o.ceiling, circular: o.circular });
    const got = measure(out);
    if (pass === 0 && Number.isFinite(got)) gainDb = Math.min(gainDb + (o.targetLufs - got), (o.maxBoostDb ?? 30) + 3);
  }
  p.channels.forEach((ch, c) => ch.set(out.channels[c]!));
  return { gainDb, lufs: measure(p), peak: peak(p) };
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

/** Largest sample step when the loop wraps from its last frame to its first. */
export function seamJump(p: Pcm): number {
  const n = pcmLength(p);
  let m = 0;
  for (const ch of p.channels) m = Math.max(m, Math.abs(ch[0]! - ch[n - 1]!));
  return m;
}

/** A quantile (0..1) of |x[i] - x[i-1]| over the whole buffer: what a "normal" sample step looks like. */
export function stepQuantile(p: Pcm, q: number): number {
  const steps: number[] = [];
  for (const ch of p.channels) for (let i = 1; i < ch.length; i += 3) steps.push(Math.abs(ch[i]! - ch[i - 1]!));
  if (!steps.length) return 0;
  steps.sort((a, b) => a - b);
  return steps[Math.min(steps.length - 1, Math.floor(q * steps.length))]!;
}

/** Normalised peaks (0..1) for the timeline waveform. */
export function waveformPeaks(p: Pcm, points: number): number[] {
  const n = pcmLength(p);
  const bucket = Math.max(1, Math.floor(n / points));
  const out: number[] = [];
  let max = 0;
  for (let i = 0; i < n; i += bucket) {
    let m = 0;
    const end = Math.min(n, i + bucket);
    for (const ch of p.channels) for (let j = i; j < end; j += 2) m = Math.max(m, Math.abs(ch[j]!));
    out.push(m);
    max = Math.max(max, m);
  }
  return out.map((x) => Math.round((max > 0 ? x / max : 0) * 100) / 100);
}

/** Fades the first/last `seconds` (in place, equal-power-ish curves). */
export function fadeEdgesInPlace(p: Pcm, fadeIn: number, fadeOut: number): void {
  const n = pcmLength(p);
  const fi = Math.min(n, Math.round(fadeIn * p.sampleRate));
  const fo = Math.min(n, Math.round(fadeOut * p.sampleRate));
  for (const ch of p.channels) {
    for (let i = 0; i < fi; i++) ch[i]! *= Math.sin(((i / fi) * Math.PI) / 2);
    for (let i = 0; i < fo; i++) ch[n - 1 - i]! *= Math.sin(((i / fo) * Math.PI) / 2);
  }
}
