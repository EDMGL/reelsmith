/**
 * Web Audio instrument voices: each call schedules ONE note on a (offline)
 * context into `out`. Voices are calibrated to peak around 0.5 at velocity 1,
 * the instrument's dB gain sets the mix level. Every voice starts from zero
 * (short attack) so nothing clicks, and filters tame raw oscillator edges.
 */
import { midiToFreq } from './theory';
import { bellSample, crackleSample, epianoSample, malletSample, pianoSample, stringSample } from './samples';
import type { NoteEvent, VoiceKind, VoiceParams } from './types';

export interface VoiceEnv {
  ctx: BaseAudioContext;
  /** Shared deterministic white-noise buffer (≥ 2 s). */
  noise: AudioBuffer;
  /** Wraps a cached Float32Array sample in an AudioBuffer (cached per render). */
  buffer(key: string, data: () => Float32Array): AudioBuffer;
}

type Voice = (env: VoiceEnv, out: AudioNode, e: NoteEvent, p: VoiceParams) => void;

const EPS = 0.0001;

function gainNode(ctx: BaseAudioContext, value = 0): GainNode {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

/** Attack to `peak`, exponential decay towards `sustain*peak`, release after `end`. */
function adsr(g: AudioParam, t: number, end: number, peak: number, a: number, d: number, s: number, r: number): number {
  g.setValueAtTime(0, t);
  g.linearRampToValueAtTime(peak, t + a);
  const sus = Math.max(EPS, peak * s);
  g.setTargetAtTime(sus, t + a, Math.max(0.005, d / 3));
  const relAt = Math.max(end, t + a + 0.005);
  g.setTargetAtTime(0, relAt, Math.max(0.005, r / 4));
  return relAt + r * 1.6 + 0.02;
}

/** Percussive envelope: fast attack, exponential decay. Returns stop time. */
function perc(g: AudioParam, t: number, peak: number, decay: number, attack = 0.002): number {
  g.setValueAtTime(0, t);
  g.linearRampToValueAtTime(peak, t + attack);
  g.setTargetAtTime(0, t + attack, decay / 4);
  return t + attack + decay * 1.8 + 0.02;
}

function noiseSrc(env: VoiceEnv, t: number, e: NoteEvent): AudioBufferSourceNode {
  const src = env.ctx.createBufferSource();
  src.buffer = env.noise;
  // Deterministic offset so consecutive hits are not identical.
  const offset = ((e.t * 7919 + e.n * 31) % 1) * (env.noise.duration - 1);
  src.start(t, Math.max(0, offset));
  return src;
}

function biquad(ctx: BaseAudioContext, type: BiquadFilterType, freq: number, q = 0.707): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

function osc(ctx: BaseAudioContext, type: OscillatorType, freq: number, detune = 0): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  o.detune.value = detune;
  return o;
}

// ---------------------------------------------------------------------------
// Drums
// ---------------------------------------------------------------------------

const kick: Voice = ({ ctx, ...env }, out, e, p) => {
  const t = e.t;
  const base = p.pitch ?? 50;
  const decay = p.decay ?? 0.42;
  const o = osc(ctx, 'sine', base * 3.2);
  o.frequency.setValueAtTime(base * 3.2, t);
  o.frequency.exponentialRampToValueAtTime(base * 1.35, t + 0.035);
  o.frequency.exponentialRampToValueAtTime(base, t + 0.12);
  const g = gainNode(ctx);
  const stop = perc(g.gain, t, 0.95 * e.v, decay, 0.0015);
  // Soft saturation-ish body: low-pass keeps it round.
  const lp = biquad(ctx, 'lowpass', 900);
  o.connect(g).connect(lp).connect(out);
  o.start(t);
  o.stop(stop);
  // Beater click.
  const click = p.tone ?? 0.5;
  if (click > 0) {
    const n = noiseSrc({ ctx, ...env }, t, e);
    const hp = biquad(ctx, 'bandpass', 3500, 0.8);
    const cg = gainNode(ctx);
    const cs = perc(cg.gain, t, 0.22 * click * e.v, 0.012, 0.0008);
    n.connect(hp).connect(cg).connect(out);
    n.stop(cs);
  }
};

const snare: Voice = (env, out, e, p) => {
  const { ctx } = env;
  const t = e.t;
  const tone = p.tone ?? 0.5;
  const body = osc(ctx, 'triangle', p.pitch ?? 190);
  body.frequency.setValueAtTime((p.pitch ?? 190) * 1.25, t);
  body.frequency.exponentialRampToValueAtTime(p.pitch ?? 190, t + 0.03);
  const bg = gainNode(ctx);
  const bs = perc(bg.gain, t, 0.55 * e.v, 0.09);
  body.connect(bg).connect(out);
  body.start(t);
  body.stop(bs);
  const n = noiseSrc(env, t, e);
  const hp = biquad(ctx, 'highpass', 1400 + tone * 1200, 0.6);
  const lp = biquad(ctx, 'lowpass', 7000 + tone * 5000);
  const ng = gainNode(ctx);
  const ns = perc(ng.gain, t, 0.5 * e.v, p.decay ?? 0.17);
  n.connect(hp).connect(lp).connect(ng).connect(out);
  n.stop(ns);
};

const clap: Voice = (env, out, e, p) => {
  const { ctx } = env;
  const t = e.t;
  const n = noiseSrc(env, t, e);
  const bp = biquad(ctx, 'bandpass', p.pitch ?? 1150, 1.1);
  const hp = biquad(ctx, 'highpass', 600);
  const g = gainNode(ctx);
  const v = 0.75 * e.v;
  g.gain.setValueAtTime(0, t);
  for (const off of [0, 0.011, 0.021]) {
    g.gain.setValueAtTime(0, t + off);
    g.gain.linearRampToValueAtTime(v, t + off + 0.001);
    g.gain.setTargetAtTime(0, t + off + 0.001, 0.003);
  }
  g.gain.setValueAtTime(0.001, t + 0.03);
  g.gain.linearRampToValueAtTime(v * 0.8, t + 0.031);
  g.gain.setTargetAtTime(0, t + 0.031, (p.decay ?? 0.16) / 4);
  n.connect(bp).connect(hp).connect(g).connect(out);
  n.stop(t + 0.04 + (p.decay ?? 0.16) * 2);
};

function hatLike(env: VoiceEnv, out: AudioNode, e: NoteEvent, decay: number, hpFreq: number, peak: number, bpFreq = 9500): void {
  const { ctx } = env;
  const n = noiseSrc(env, e.t, e);
  const hp = biquad(ctx, 'highpass', hpFreq, 0.7);
  const pk = biquad(ctx, 'peaking', bpFreq, 1.2);
  pk.gain.value = 4;
  const lp = biquad(ctx, 'lowpass', 15000);
  const g = gainNode(ctx);
  const stop = perc(g.gain, e.t, peak * e.v, decay, 0.001);
  n.connect(hp).connect(pk).connect(lp).connect(g).connect(out);
  n.stop(stop);
}

const hat: Voice = (env, out, e, p) => hatLike(env, out, e, p.decay ?? 0.045, 6500 + (p.tone ?? 0.5) * 2500, 0.55);
const openhat: Voice = (env, out, e, p) => hatLike(env, out, e, p.decay ?? 0.32, 6000 + (p.tone ?? 0.5) * 2000, 0.45);

const shaker: Voice = (env, out, e, p) => {
  const { ctx } = env;
  const n = noiseSrc(env, e.t, e);
  const bp = biquad(ctx, 'bandpass', p.pitch ?? 6500, 1.0);
  const g = gainNode(ctx);
  g.gain.setValueAtTime(0, e.t);
  g.gain.linearRampToValueAtTime(0.5 * e.v, e.t + 0.012);
  g.gain.setTargetAtTime(0, e.t + 0.014, (p.decay ?? 0.06) / 3);
  n.connect(bp).connect(g).connect(out);
  n.stop(e.t + 0.3);
};

const rim: Voice = ({ ctx }, out, e, p) => {
  const t = e.t;
  const f = p.pitch ?? 1700;
  const o1 = osc(ctx, 'triangle', f);
  const o2 = osc(ctx, 'sine', f * 0.47);
  const bp = biquad(ctx, 'bandpass', f, 2);
  const g = gainNode(ctx);
  const stop = perc(g.gain, t, 0.9 * e.v, p.decay ?? 0.035, 0.0005);
  o1.connect(bp);
  o2.connect(bp);
  bp.connect(g).connect(out);
  for (const o of [o1, o2]) {
    o.start(t);
    o.stop(stop);
  }
};

const tom: Voice = (env, out, e, p) => {
  const { ctx } = env;
  const t = e.t;
  const f = midiToFreq(e.n || 45);
  const o = osc(ctx, 'sine', f * 1.6);
  o.frequency.setValueAtTime(f * 1.6, t);
  o.frequency.exponentialRampToValueAtTime(f, t + 0.06);
  const g = gainNode(ctx);
  const stop = perc(g.gain, t, 0.8 * e.v, p.decay ?? 0.32);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(stop);
  const n = noiseSrc(env, t, e);
  const lp = biquad(ctx, 'lowpass', 2500);
  const ng = gainNode(ctx);
  n.connect(lp).connect(ng).connect(out);
  n.stop(perc(ng.gain, t, 0.12 * e.v, 0.03));
};

const crash: Voice = (env, out, e, p) => {
  const { ctx } = env;
  const n = noiseSrc(env, e.t, e);
  const hp = biquad(ctx, 'highpass', 3800 + (p.tone ?? 0.5) * 2000, 0.5);
  const pk = biquad(ctx, 'peaking', 7000, 0.8);
  pk.gain.value = 3;
  const lp = biquad(ctx, 'lowpass', 13000);
  const g = gainNode(ctx);
  const stop = perc(g.gain, e.t, 0.38 * e.v, p.decay ?? 1.8, 0.003);
  n.connect(hp).connect(pk).connect(lp).connect(g).connect(out);
  n.loop = true;
  n.stop(stop);
};

// ---------------------------------------------------------------------------
// Bass
// ---------------------------------------------------------------------------

const bass: Voice = ({ ctx }, out, e, p) => {
  const t = e.t;
  const f = midiToFreq(e.n);
  const o1 = osc(ctx, p.wave ?? 'sawtooth', f);
  const o2 = osc(ctx, 'sine', f);
  const cutoff = p.cutoff ?? 420;
  const lp = biquad(ctx, 'lowpass', cutoff, p.reso ?? 2);
  const peakCut = Math.min(9000, cutoff * (1 + (p.env ?? 2.5) * e.v));
  lp.frequency.setValueAtTime(peakCut, t);
  lp.frequency.setTargetAtTime(cutoff, t + 0.005, (p.decay ?? 0.18) / 3);
  const mix1 = gainNode(ctx, 0.5);
  const mix2 = gainNode(ctx, 0.55);
  const g = gainNode(ctx);
  const stop = adsr(g.gain, t, t + e.d, 0.85 * Math.pow(e.v, 0.7), p.attack ?? 0.004, p.decay ?? 0.25, p.sustain ?? 0.7, p.release ?? 0.06);
  o1.connect(mix1).connect(lp);
  o2.connect(mix2).connect(lp);
  lp.connect(g).connect(out);
  for (const o of [o1, o2]) {
    o.start(t);
    o.stop(stop);
  }
};

const sub: Voice = ({ ctx }, out, e, p) => {
  const t = e.t;
  const f = midiToFreq(e.n);
  const o = osc(ctx, 'sine', f);
  const o2 = osc(ctx, 'triangle', f * 2);
  const g2 = gainNode(ctx, 0.08 + (p.tone ?? 0.3) * 0.15);
  const lp = biquad(ctx, 'lowpass', 600);
  const g = gainNode(ctx);
  const stop = adsr(g.gain, t, t + e.d, 0.9 * Math.pow(e.v, 0.6), p.attack ?? 0.008, p.decay ?? 0.5, p.sustain ?? 0.85, p.release ?? 0.09);
  o.connect(lp);
  o2.connect(g2).connect(lp);
  lp.connect(g).connect(out);
  for (const x of [o, o2]) {
    x.start(t);
    x.stop(stop);
  }
};

// ---------------------------------------------------------------------------
// Sustained synths
// ---------------------------------------------------------------------------

function unison(ctx: BaseAudioContext, out: AudioNode, wave: OscillatorType, f: number, cents: number, t: number, stop: number, vibrato?: { rate: number; depth: number; delay: number }): void {
  const spread = [-1, 0, 1];
  let lfoGain: GainNode | null = null;
  if (vibrato && vibrato.depth > 0) {
    const lfo = osc(ctx, 'sine', vibrato.rate);
    lfoGain = gainNode(ctx, 0);
    lfoGain.gain.setValueAtTime(0, t);
    lfoGain.gain.linearRampToValueAtTime(vibrato.depth, t + vibrato.delay);
    lfo.connect(lfoGain);
    lfo.start(t);
    lfo.stop(stop);
  }
  for (const s of spread) {
    const o = osc(ctx, wave, f, s * cents);
    const pan = ctx.createStereoPanner();
    pan.pan.value = s * 0.55;
    const g = gainNode(ctx, s === 0 ? 0.42 : 0.34);
    if (lfoGain) lfoGain.connect(o.detune);
    o.connect(g).connect(pan).connect(out);
    o.start(t);
    o.stop(stop);
  }
}

const pad: Voice = ({ ctx }, out, e, p) => {
  const t = e.t;
  const f = midiToFreq(e.n);
  const cutoff = p.cutoff ?? 1400;
  const lp = biquad(ctx, 'lowpass', cutoff, p.reso ?? 0.6);
  lp.frequency.setValueAtTime(cutoff * 0.6, t);
  lp.frequency.linearRampToValueAtTime(cutoff, t + Math.max(0.3, (p.attack ?? 0.6) * 1.5));
  const g = gainNode(ctx);
  const stop = adsr(g.gain, t, t + e.d, 0.32 * e.v, p.attack ?? 0.6, p.decay ?? 1.5, p.sustain ?? 0.8, p.release ?? 1.2);
  unison(ctx, lp, p.wave ?? 'sawtooth', f, p.detune ?? 9, t, stop, p.vibrato ? { rate: 0.35, depth: p.vibrato, delay: 1 } : undefined);
  lp.connect(g).connect(out);
};

const strings: Voice = ({ ctx }, out, e, p) => {
  const t = e.t;
  const f = midiToFreq(e.n);
  const lp = biquad(ctx, 'lowpass', p.cutoff ?? 2600, 0.5);
  const hp = biquad(ctx, 'highpass', 180);
  const g = gainNode(ctx);
  const stop = adsr(g.gain, t, t + e.d, 0.3 * e.v, p.attack ?? 0.35, p.decay ?? 2, p.sustain ?? 0.85, p.release ?? 0.7);
  unison(ctx, lp, 'sawtooth', f, p.detune ?? 7, t, stop, { rate: 5.2, depth: p.vibrato ?? 9, delay: 0.5 });
  lp.connect(hp).connect(g).connect(out);
};

const brass: Voice = ({ ctx }, out, e, p) => {
  const t = e.t;
  const f = midiToFreq(e.n);
  const cutoff = p.cutoff ?? 1100;
  const lp = biquad(ctx, 'lowpass', cutoff * 0.3, 1.2);
  lp.frequency.setValueAtTime(cutoff * 0.3, t);
  lp.frequency.linearRampToValueAtTime(cutoff * (1.5 + e.v), t + (p.attack ?? 0.06) + 0.04);
  lp.frequency.setTargetAtTime(cutoff, t + 0.12, 0.15);
  const g = gainNode(ctx);
  const stop = adsr(g.gain, t, t + e.d, 0.33 * e.v, p.attack ?? 0.05, p.decay ?? 0.4, p.sustain ?? 0.75, p.release ?? 0.25);
  unison(ctx, lp, 'sawtooth', f, p.detune ?? 6, t, stop, { rate: 5, depth: p.vibrato ?? 0, delay: 0.4 });
  lp.connect(g).connect(out);
};

const lead: Voice = ({ ctx }, out, e, p) => {
  const t = e.t;
  const f = midiToFreq(e.n);
  const lp = biquad(ctx, 'lowpass', p.cutoff ?? 2400, p.reso ?? 0.8);
  const g = gainNode(ctx);
  const stop = adsr(g.gain, t, t + e.d, 0.4 * e.v, p.attack ?? 0.015, p.decay ?? 0.3, p.sustain ?? 0.7, p.release ?? 0.18);
  const vib = { rate: 5.4, depth: p.vibrato ?? 14, delay: 0.25 };
  const o1 = osc(ctx, p.wave ?? 'triangle', f);
  const o2 = osc(ctx, p.wave === 'sine' ? 'triangle' : 'sine', f * 2, 3);
  const lfo = osc(ctx, 'sine', vib.rate);
  const lg = gainNode(ctx, 0);
  lg.gain.setValueAtTime(0, t);
  lg.gain.linearRampToValueAtTime(vib.depth, t + Math.min(e.d, 0.6));
  lfo.connect(lg);
  lg.connect(o1.detune);
  lg.connect(o2.detune);
  const g1 = gainNode(ctx, 0.75);
  const g2 = gainNode(ctx, 0.12);
  o1.connect(g1).connect(lp);
  o2.connect(g2).connect(lp);
  lp.connect(g).connect(out);
  for (const o of [o1, o2, lfo]) {
    o.start(t);
    o.stop(stop);
  }
};

const synthpluck: Voice = ({ ctx }, out, e, p) => {
  const t = e.t;
  const f = midiToFreq(e.n);
  const cutoff = p.cutoff ?? 900;
  const lp = biquad(ctx, 'lowpass', cutoff, p.reso ?? 3);
  lp.frequency.setValueAtTime(Math.min(12000, cutoff * (1 + (p.env ?? 5) * e.v)), t);
  lp.frequency.setTargetAtTime(cutoff, t + 0.002, (p.decay ?? 0.2) / 3);
  const g = gainNode(ctx);
  const stop = adsr(g.gain, t, t + e.d, 0.42 * e.v, 0.002, p.decay ?? 0.25, p.sustain ?? 0.15, p.release ?? 0.12);
  const o1 = osc(ctx, p.wave ?? 'sawtooth', f, -(p.detune ?? 6));
  const o2 = osc(ctx, p.wave ?? 'sawtooth', f, p.detune ?? 6);
  const p1 = ctx.createStereoPanner();
  p1.pan.value = -0.3;
  const p2 = ctx.createStereoPanner();
  p2.pan.value = 0.3;
  o1.connect(p1).connect(lp);
  o2.connect(p2).connect(lp);
  lp.connect(g).connect(out);
  for (const o of [o1, o2]) {
    o.start(t);
    o.stop(stop);
  }
};

// ---------------------------------------------------------------------------
// Sampled (JS-generated) instruments
// ---------------------------------------------------------------------------

function playSample(env: VoiceEnv, out: AudioNode, e: NoteEvent, buf: AudioBuffer, peak: number, release: number, cutoff?: number): void {
  const { ctx } = env;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = gainNode(ctx);
  g.gain.setValueAtTime(peak, e.t);
  const end = e.t + e.d;
  g.gain.setValueAtTime(peak, end);
  g.gain.setTargetAtTime(0, end, release / 4);
  let node: AudioNode = src;
  if (cutoff) {
    const lp = biquad(ctx, 'lowpass', cutoff, 0.5);
    node = node.connect(lp);
  }
  node.connect(g).connect(out);
  src.start(e.t);
  src.stop(Math.min(e.t + buf.duration, end + release * 1.6 + 0.02));
}

const piano: Voice = (env, out, e, p) => {
  const fs = env.ctx.sampleRate;
  const layer: 0 | 1 = e.v > 0.62 ? 1 : 0;
  const buf = env.buffer(`piano:${e.n}:${layer}`, () => pianoSample(e.n, layer, fs));
  playSample(env, out, e, buf, 0.9 * Math.pow(e.v, 1.3), p.release ?? 0.25, (p.cutoff ?? 3500) * (0.5 + e.v));
};

const epiano: Voice = (env, out, e, p) => {
  const fs = env.ctx.sampleRate;
  const layer: 0 | 1 = e.v > 0.6 ? 1 : 0;
  const buf = env.buffer(`ep:${e.n}:${layer}`, () => epianoSample(e.n, layer, fs));
  playSample(env, out, e, buf, 0.85 * Math.pow(e.v, 1.2), p.release ?? 0.3, p.cutoff);
};

const guitar: Voice = (env, out, e, p) => {
  const fs = env.ctx.sampleRate;
  const bright = Math.round((p.tone ?? 0.5) * 10) / 10;
  const buf = env.buffer(`ks:${e.n}:${bright}`, () => stringSample(e.n, bright, fs));
  playSample(env, out, e, buf, 0.8 * e.v, p.release ?? 0.2, p.cutoff);
};

const pluck: Voice = (env, out, e, p) => {
  const fs = env.ctx.sampleRate;
  const bright = Math.round((p.tone ?? 0.8) * 10) / 10;
  const buf = env.buffer(`ks:${e.n}:${bright}`, () => stringSample(e.n, bright, fs));
  playSample(env, out, e, buf, 0.8 * e.v, p.release ?? 0.12, p.cutoff);
};

const mallet: Voice = (env, out, e, p) => {
  const fs = env.ctx.sampleRate;
  const hard = Math.round((p.tone ?? 0.6) * 10) / 10;
  const buf = env.buffer(`mallet:${e.n}:${hard}`, () => malletSample(e.n, hard, fs));
  playSample(env, out, e, buf, 0.85 * e.v, p.release ?? 0.4, p.cutoff);
};

const bell: Voice = (env, out, e, p) => {
  const fs = env.ctx.sampleRate;
  const buf = env.buffer(`bell:${e.n}`, () => bellSample(e.n, fs));
  playSample(env, out, e, buf, 0.7 * e.v, p.release ?? 1.2, p.cutoff);
};

// ---------------------------------------------------------------------------
// FX voices
// ---------------------------------------------------------------------------

const boom: Voice = (env, out, e, p) => {
  const { ctx } = env;
  const t = e.t;
  const base = p.pitch ?? 42;
  const o = osc(ctx, 'sine', base * 2.5);
  o.frequency.setValueAtTime(base * 2.5, t);
  o.frequency.exponentialRampToValueAtTime(base, t + 0.25);
  o.frequency.exponentialRampToValueAtTime(base * 0.7, t + (p.decay ?? 2));
  const g = gainNode(ctx);
  const stop = perc(g.gain, t, 0.9 * e.v, p.decay ?? 2, 0.003);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(stop);
  const n = noiseSrc(env, t, e);
  n.loop = true;
  const lp = biquad(ctx, 'lowpass', 1800);
  lp.frequency.setValueAtTime(3000, t);
  lp.frequency.exponentialRampToValueAtTime(200, t + 0.8);
  const ng = gainNode(ctx);
  n.connect(lp).connect(ng).connect(out);
  n.stop(perc(ng.gain, t, 0.45 * e.v, 0.6, 0.002));
};

const riser: Voice = (env, out, e, p) => {
  const { ctx } = env;
  const t = e.t;
  const end = t + e.d;
  const n = noiseSrc(env, t, e);
  n.loop = true;
  const bp = biquad(ctx, 'bandpass', 300, 2.5);
  bp.frequency.setValueAtTime(p.pitch ?? 300, t);
  bp.frequency.exponentialRampToValueAtTime(p.cutoff ?? 7000, end);
  const g = gainNode(ctx);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.25 * e.v, t + e.d * 0.6);
  g.gain.linearRampToValueAtTime(0.6 * e.v, end - 0.01);
  g.gain.linearRampToValueAtTime(0, end + 0.04);
  n.connect(bp).connect(g).connect(out);
  n.stop(end + 0.06);
};

const vinyl: Voice = (env, out, e) => {
  // e.n carries the crackle seed; the buffer spans the event.
  const { ctx } = env;
  const src = ctx.createBufferSource();
  src.buffer = env.buffer(`crackle:${e.d.toFixed(4)}:${e.n}`, () => crackleSample(e.d, ctx.sampleRate, e.n));
  const g = gainNode(ctx, 0.6 * e.v);
  const hp = biquad(ctx, 'highpass', 500);
  src.connect(hp).connect(g).connect(out);
  src.start(e.t);
};

export const VOICES: Record<VoiceKind, Voice> = {
  kick,
  snare,
  clap,
  hat,
  openhat,
  shaker,
  rim,
  tom,
  crash,
  bass,
  sub,
  pad,
  strings,
  piano,
  epiano,
  pluck,
  guitar,
  mallet,
  bell,
  synthpluck,
  lead,
  brass,
  boom,
  riser,
  vinyl,
};
