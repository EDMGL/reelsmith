/** Synthetic test signals. */
export const SR = 16000;

export type Segment = { kind: 'tone'; sec: number; amp?: number; freq?: number } | { kind: 'silence'; sec: number; noiseAmp?: number };

/** Deterministic pseudo-random noise in [-1, 1]. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s / 0xffffffff) * 2 - 1;
  };
}

export function buildSignal(segments: Segment[], sampleRate = SR, seed = 1): Float32Array {
  const total = segments.reduce((n, s) => n + Math.round(s.sec * sampleRate), 0);
  const out = new Float32Array(total);
  const rand = rng(seed);
  let pos = 0;
  for (const seg of segments) {
    const n = Math.round(seg.sec * sampleRate);
    for (let i = 0; i < n; i++) {
      if (seg.kind === 'tone') out[pos + i] = (seg.amp ?? 0.5) * Math.sin((2 * Math.PI * (seg.freq ?? 440) * (pos + i)) / sampleRate);
      else out[pos + i] = (seg.noiseAmp ?? 0) * rand();
    }
    pos += n;
  }
  return out;
}

/** Uniform noise amplitude for a target RMS level in dBFS (uniform RMS = amp / sqrt(3)). */
export function noiseAmpForDb(db: number): number {
  return Math.pow(10, db / 20) * Math.sqrt(3);
}
