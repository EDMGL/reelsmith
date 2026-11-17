/**
 * Built-in sound effects: synthesized one-shots (oscillators, filtered noise,
 * envelopes, a short reverb). Each `make(seed)` returns a deterministic build.
 */
import type { SfxBuild, SfxContext } from '../synth/render';
import { VOICES } from '../synth/voices';
import type { SfxDef } from './types';

// ---------------------------------------------------------------------------
// Tiny toolkit
// ---------------------------------------------------------------------------

interface ToneOpts {
  type?: OscillatorType;
  f0: number;
  f1?: number;
  /** Pitch glide curve: 'exp' (default) or 'lin'. */
  glide?: 'exp' | 'lin';
  at: number;
  dur: number;
  peak: number;
  attack?: number;
  /** Exponential decay time constant; omitted = hold then release. */
  decay?: number;
  pan?: number;
  lowpass?: number;
  send?: number;
}

function tone(s: SfxContext, o: ToneOpts): void {
  const { ctx } = s;
  const osc = ctx.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.f0, o.at);
  if (o.f1 !== undefined) {
    if (o.glide === 'lin') osc.frequency.linearRampToValueAtTime(o.f1, o.at + o.dur);
    else osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), o.at + o.dur);
  }
  const g = ctx.createGain();
  const a = o.attack ?? 0.003;
  g.gain.setValueAtTime(0, o.at);
  g.gain.linearRampToValueAtTime(o.peak, o.at + a);
  if (o.decay !== undefined) g.gain.setTargetAtTime(0, o.at + a, o.decay);
  else {
    g.gain.setValueAtTime(o.peak, o.at + Math.max(a, o.dur - 0.02));
    g.gain.linearRampToValueAtTime(0, o.at + o.dur);
  }
  let node: AudioNode = osc;
  if (o.lowpass) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = o.lowpass;
    node = node.connect(lp);
  }
  const pan = ctx.createStereoPanner();
  pan.pan.value = o.pan ?? 0;
  node.connect(g).connect(pan).connect(s.out);
  if (o.send) {
    const sg = ctx.createGain();
    sg.gain.value = o.send;
    pan.connect(sg).connect(s.reverb);
  }
  osc.start(o.at);
  osc.stop(o.at + (o.decay !== undefined ? Math.max(o.dur, o.decay * 7) : o.dur) + 0.05);
}

interface NoiseOpts {
  at: number;
  dur: number;
  peak: number;
  filter: BiquadFilterType;
  f0: number;
  f1?: number;
  q?: number;
  attack?: number;
  /** Fraction of `dur` where the level peaks (swells), default: attack only. */
  peakAt?: number;
  decay?: number;
  pan0?: number;
  pan1?: number;
  send?: number;
}

function noise(s: SfxContext, o: NoiseOpts): void {
  const { ctx } = s;
  const src = ctx.createBufferSource();
  src.buffer = s.noise;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = o.filter;
  f.Q.value = o.q ?? 1;
  f.frequency.setValueAtTime(o.f0, o.at);
  if (o.f1 !== undefined) f.frequency.exponentialRampToValueAtTime(o.f1, o.at + o.dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, o.at);
  if (o.peakAt !== undefined) {
    g.gain.linearRampToValueAtTime(o.peak, o.at + o.dur * o.peakAt);
    g.gain.linearRampToValueAtTime(0, o.at + o.dur);
  } else {
    const a = o.attack ?? 0.002;
    g.gain.linearRampToValueAtTime(o.peak, o.at + a);
    if (o.decay !== undefined) g.gain.setTargetAtTime(0, o.at + a, o.decay);
    else g.gain.linearRampToValueAtTime(0, o.at + o.dur);
  }
  const pan = ctx.createStereoPanner();
  pan.pan.setValueAtTime(o.pan0 ?? 0, o.at);
  if (o.pan1 !== undefined) pan.pan.linearRampToValueAtTime(o.pan1, o.at + o.dur);
  src.connect(f).connect(g).connect(pan).connect(s.out);
  if (o.send) {
    const sg = ctx.createGain();
    sg.gain.value = o.send;
    pan.connect(sg).connect(s.reverb);
  }
  src.start(o.at, s.rng.next() * 1.5);
  src.stop(o.at + (o.decay !== undefined ? Math.max(o.dur, o.decay * 7) : o.dur) + 0.05);
}

/** Plays an instrument voice once (bell, mallet, pluck …) into the effect. */
function inst(s: SfxContext, voice: keyof typeof VOICES, midi: number, at: number, dur: number, vel: number, send = 0.3): void {
  const g = s.ctx.createGain();
  g.gain.value = 1;
  g.connect(s.out);
  if (send) {
    const sg = s.ctx.createGain();
    sg.gain.value = send;
    g.connect(sg).connect(s.reverb);
  }
  VOICES[voice](s.env, g, { t: at, d: dur, inst: voice, n: midi, v: vel }, {});
}

const V2 = (a: number, b: number) => [
  { label: 'A', seed: a },
  { label: 'B', seed: b },
];

const sfx = (id: string, name: string, category: string, tags: string[], seeds: [number, number], make: (seed: number) => SfxBuild): SfxDef => ({
  id: `sfx-${id}`,
  name,
  category,
  tags,
  variations: V2(seeds[0], seeds[1]),
  make,
});

const jitter = (seed: number, amount: number) => 1 + (((seed * 2654435761) >>> 0) / 4294967296 - 0.5) * 2 * amount;

// ---------------------------------------------------------------------------

export const SOUND_EFFECTS: readonly SfxDef[] = [
  sfx('whoosh', 'Whoosh', 'Transitions', ['whoosh', 'transition', 'fast'], [11, 12], (seed) => ({
    seconds: 1.2,
    build: (s) => noise(s, { at: 0.02, dur: 0.75 * jitter(seed, 0.15), peak: 0.9, filter: 'bandpass', f0: 400, f1: 2400 * jitter(seed, 0.2), q: 1.4, peakAt: 0.55, pan0: -0.6, pan1: 0.6, send: 0.25 }),
  })),
  sfx('swoosh-up', 'Swoosh up', 'Transitions', ['swoosh', 'rise', 'up'], [21, 22], (seed) => ({
    seconds: 1.1,
    build: (s) => {
      noise(s, { at: 0.01, dur: 0.6, peak: 0.8, filter: 'bandpass', f0: 300, f1: 6000 * jitter(seed, 0.2), q: 2, peakAt: 0.85, send: 0.3 });
      tone(s, { type: 'sine', f0: 300, f1: 1400, at: 0.05, dur: 0.55, peak: 0.12, attack: 0.3, send: 0.3 });
    },
  })),
  sfx('swoosh-down', 'Swoosh down', 'Transitions', ['swoosh', 'fall', 'down'], [31, 32], (seed) => ({
    seconds: 1.1,
    build: (s) => {
      noise(s, { at: 0.01, dur: 0.6, peak: 0.8, filter: 'bandpass', f0: 6000 * jitter(seed, 0.2), f1: 250, q: 2, peakAt: 0.15, send: 0.3 });
      tone(s, { type: 'sine', f0: 1400, f1: 260, at: 0.02, dur: 0.55, peak: 0.12, decay: 0.2, send: 0.3 });
    },
  })),
  sfx('transition-sweep', 'Transition sweep', 'Transitions', ['sweep', 'transition', 'riser'], [41, 42], (seed) => ({
    seconds: 2.4,
    reverb: { seconds: 2, brightness: 0.6, level: -6 },
    build: (s) => {
      noise(s, { at: 0, dur: 1.6, peak: 0.7, filter: 'bandpass', f0: 200, f1: 9000, q: 3 * jitter(seed, 0.3), peakAt: 0.9, pan0: -0.4, pan1: 0.4, send: 0.5 });
      noise(s, { at: 1.6, dur: 0.6, peak: 0.5, filter: 'lowpass', f0: 9000, f1: 300, q: 0.7, decay: 0.15, send: 0.5 });
    },
  })),
  sfx('riser', 'Riser', 'Transitions', ['riser', 'build', 'tension'], [51, 52], (seed) => ({
    seconds: 3.4,
    reverb: { seconds: 2.4, brightness: 0.5, level: -6 },
    build: (s) => {
      noise(s, { at: 0, dur: 3, peak: 0.6, filter: 'bandpass', f0: 250, f1: 7000, q: 2, peakAt: 0.97, send: 0.4 });
      for (const [i, det] of [0, 7, -7].entries()) {
        const k = Math.pow(2, det / 1200);
        tone(s, { type: 'sawtooth', f0: 110 * k * jitter(seed, 0.05), f1: 880 * k, at: 0, dur: 3, peak: 0.07, attack: 2.6, lowpass: 2500, pan: (i - 1) * 0.5, send: 0.4 });
      }
    },
  })),
  sfx('impact', 'Impact boom', 'Hits', ['impact', 'boom', 'hit', 'cinematic'], [61, 62], (seed) => ({
    seconds: 3.2,
    reverb: { seconds: 3, brightness: 0.35, level: -4 },
    build: (s) => {
      inst(s, 'boom', 0, 0.01, 3, 1, 0.5);
      noise(s, { at: 0.01, dur: 0.4, peak: 0.6, filter: 'lowpass', f0: 5000 * jitter(seed, 0.2), f1: 300, q: 0.7, decay: 0.12, send: 0.6 });
    },
  })),
  sfx('pop', 'Pop', 'UI', ['pop', 'bubble', 'ui'], [71, 72], (seed) => ({
    seconds: 0.35,
    reverb: { seconds: 0.5, brightness: 0.6, level: -14 },
    build: (s) => tone(s, { type: 'sine', f0: 380 * jitter(seed, 0.2), f1: 1200 * jitter(seed, 0.2), at: 0.005, dur: 0.05, peak: 0.9, decay: 0.03, send: 0.2 }),
  })),
  sfx('click', 'Click', 'UI', ['click', 'tap', 'ui', 'button'], [81, 82], (seed) => ({
    seconds: 0.2,
    reverb: { seconds: 0.3, brightness: 0.6, level: -20 },
    build: (s) => {
      noise(s, { at: 0.003, dur: 0.02, peak: 0.8, filter: 'bandpass', f0: 3500 * jitter(seed, 0.3), q: 3, decay: 0.004 });
      tone(s, { type: 'triangle', f0: 1800 * jitter(seed, 0.2), at: 0.003, dur: 0.02, peak: 0.4, decay: 0.006 });
    },
  })),
  sfx('typing', 'Typing key', 'UI', ['typing', 'keyboard', 'key'], [91, 92], (seed) => ({
    seconds: 0.25,
    reverb: { seconds: 0.3, brightness: 0.5, level: -20 },
    build: (s) => {
      noise(s, { at: 0.003, dur: 0.03, peak: 0.7, filter: 'bandpass', f0: 2500 * jitter(seed, 0.2), q: 2, decay: 0.008 });
      noise(s, { at: 0.055, dur: 0.03, peak: 0.35, filter: 'bandpass', f0: 1800 * jitter(seed, 0.2), q: 2, decay: 0.01 });
      tone(s, { type: 'sine', f0: 180, at: 0.003, dur: 0.03, peak: 0.3, decay: 0.012 });
    },
  })),
  sfx('ding', 'Ding', 'Notifications', ['ding', 'bell', 'correct'], [101, 102], (seed) => ({
    seconds: 2.2,
    build: (s) => inst(s, 'bell', seed % 2 ? 84 : 88, 0.005, 1.5, 0.9, 0.35),
  })),
  sfx('notification', 'Notification', 'Notifications', ['notification', 'message', 'alert', 'ui'], [111, 112], (seed) => ({
    seconds: 1.4,
    build: (s) => {
      const notes = seed % 2 ? [79, 84] : [76, 83];
      notes.forEach((n, i) => inst(s, 'mallet', n, 0.005 + i * 0.12, 0.6, 0.85, 0.3));
    },
  })),
  sfx('success', 'Success chime', 'Notifications', ['success', 'complete', 'win', 'chime'], [121, 122], (seed) => ({
    seconds: 2.2,
    build: (s) => {
      const notes = seed % 2 ? [72, 76, 79, 84] : [67, 72, 76, 79];
      notes.forEach((n, i) => inst(s, 'bell', n, 0.005 + i * 0.09, 1.2, 0.75, 0.4));
    },
  })),
  sfx('error', 'Error buzz', 'Notifications', ['error', 'wrong', 'buzz', 'fail'], [131, 132], (seed) => ({
    seconds: 0.7,
    reverb: { seconds: 0.5, brightness: 0.4, level: -16 },
    build: (s) => {
      for (const at of [0.005, 0.2]) {
        tone(s, { type: 'square', f0: 140 * jitter(seed, 0.08), at, dur: 0.16, peak: 0.25, attack: 0.005, lowpass: 1400 });
        tone(s, { type: 'sawtooth', f0: 147 * jitter(seed, 0.08), at, dur: 0.16, peak: 0.18, attack: 0.005, lowpass: 1400 });
      }
    },
  })),
  sfx('countdown', 'Countdown beep', 'Notifications', ['countdown', 'beep', 'timer'], [141, 142], (seed) => ({
    seconds: 3.6,
    reverb: { seconds: 0.6, brightness: 0.5, level: -16 },
    build: (s) => {
      const f = seed % 2 ? 880 : 1000;
      for (let i = 0; i < 3; i++) tone(s, { type: 'sine', f0: f, at: 0.01 + i, dur: 0.15, peak: 0.6, attack: 0.004, send: 0.2 });
      tone(s, { type: 'sine', f0: f * 2, at: 3.01, dur: 0.45, peak: 0.6, attack: 0.004, send: 0.2 });
    },
  })),
  sfx('shutter', 'Camera shutter', 'Foley', ['camera', 'shutter', 'photo'], [151, 152], (seed) => ({
    seconds: 0.45,
    reverb: { seconds: 0.3, brightness: 0.5, level: -18 },
    build: (s) => {
      noise(s, { at: 0.004, dur: 0.03, peak: 0.9, filter: 'bandpass', f0: 4000 * jitter(seed, 0.2), q: 1.5, decay: 0.006 });
      noise(s, { at: 0.012, dur: 0.06, peak: 0.4, filter: 'lowpass', f0: 1800, q: 1, decay: 0.02 });
      noise(s, { at: 0.11 * jitter(seed, 0.2), dur: 0.04, peak: 0.7, filter: 'bandpass', f0: 3000, q: 1.5, decay: 0.008 });
      tone(s, { type: 'triangle', f0: 900, f1: 500, at: 0.11 * jitter(seed, 0.2), dur: 0.03, peak: 0.25, decay: 0.01 });
    },
  })),
  sfx('bubble', 'Bubble', 'Foley', ['bubble', 'water', 'blip'], [161, 162], (seed) => ({
    seconds: 0.8,
    reverb: { seconds: 0.6, brightness: 0.6, level: -12 },
    build: (s) => {
      for (let i = 0; i < 3; i++) {
        const f = (500 + s.rng.next() * 500) * jitter(seed, 0.1);
        tone(s, { type: 'sine', f0: f, f1: f * 2.4, at: 0.01 + i * 0.11 + s.rng.next() * 0.04, dur: 0.07, peak: 0.6 - i * 0.12, decay: 0.03, send: 0.3 });
      }
    },
  })),
  sfx('sparkle', 'Sparkle', 'Magic', ['sparkle', 'magic', 'shine', 'glitter'], [171, 172], () => ({
    seconds: 2.4,
    reverb: { seconds: 2.2, brightness: 0.8, level: -5 },
    build: (s) => {
      const scale = [84, 86, 88, 91, 93, 96, 98, 100];
      for (let i = 0; i < 12; i++) inst(s, 'bell', scale[Math.floor(s.rng.next() * scale.length)]!, 0.005 + i * 0.06 + s.rng.next() * 0.03, 0.4, 0.35 + s.rng.next() * 0.3, 0.6);
      noise(s, { at: 0, dur: 0.9, peak: 0.08, filter: 'highpass', f0: 8000, peakAt: 0.3, send: 0.4 });
    },
  })),
  sfx('scratch', 'Record scratch', 'Foley', ['scratch', 'record', 'stop', 'dj'], [181, 182], (seed) => ({
    seconds: 0.8,
    reverb: { seconds: 0.4, brightness: 0.5, level: -18 },
    build: (s) => {
      // Back-and-forth filtered noise sweeps with a pitched resonance (vinyl stop-ish).
      noise(s, { at: 0.005, dur: 0.16, peak: 0.8, filter: 'bandpass', f0: 600, f1: 2600 * jitter(seed, 0.2), q: 6, peakAt: 0.4 });
      noise(s, { at: 0.17, dur: 0.22, peak: 0.8, filter: 'bandpass', f0: 2600 * jitter(seed, 0.2), f1: 300, q: 6, peakAt: 0.3 });
      tone(s, { type: 'sawtooth', f0: 220, f1: 700, at: 0.005, dur: 0.16, peak: 0.12, lowpass: 2000 });
      tone(s, { type: 'sawtooth', f0: 700, f1: 120, at: 0.17, dur: 0.22, peak: 0.12, lowpass: 2000 });
    },
  })),
  sfx('applause', 'Applause', 'Foley', ['applause', 'clap', 'crowd', 'cheer'], [191, 192], (seed) => ({
    seconds: 3.4,
    reverb: { seconds: 1.4, brightness: 0.5, level: -8 },
    build: (s) => {
      // Many small claps (band-passed noise bursts) under a swelling/decaying envelope.
      const count = 140;
      for (let i = 0; i < count; i++) {
        const at = Math.pow(s.rng.next(), 0.8) * 3;
        const env = at < 0.4 ? at / 0.4 : Math.max(0, 1 - (at - 0.4) / 2.6);
        noise(s, { at, dur: 0.03, peak: 0.25 * env * (0.5 + s.rng.next() * 0.5), filter: 'bandpass', f0: (900 + s.rng.next() * 1600) * jitter(seed, 0.1), q: 1.6, decay: 0.012, pan0: s.rng.next() * 1.6 - 0.8, send: 0.4 });
      }
    },
  })),
  sfx('glitch', 'Glitch', 'Transitions', ['glitch', 'digital', 'error', 'stutter'], [201, 202], () => ({
    seconds: 0.7,
    reverb: { seconds: 0.4, brightness: 0.6, level: -16 },
    build: (s) => {
      let t = 0.005;
      for (let i = 0; i < 9; i++) {
        const len = 0.015 + s.rng.next() * 0.045;
        if (s.rng.chance(0.5)) tone(s, { type: 'square', f0: 200 + s.rng.next() * 2400, at: t, dur: len, peak: 0.25, attack: 0.001, lowpass: 6000, pan: s.rng.next() * 1.4 - 0.7 });
        else noise(s, { at: t, dur: len, peak: 0.5, filter: 'bandpass', f0: 800 + s.rng.next() * 6000, q: 4, attack: 0.001, pan0: s.rng.next() * 1.4 - 0.7 });
        t += len + s.rng.next() * 0.02;
      }
    },
  })),
  sfx('heartbeat', 'Heartbeat', 'Foley', ['heartbeat', 'heart', 'pulse', 'tension'], [211, 212], (seed) => ({
    seconds: 2.2,
    reverb: { seconds: 0.6, brightness: 0.3, level: -18 },
    build: (s) => {
      const period = seed % 2 ? 0.95 : 0.8;
      for (let b = 0; b < 2; b++) {
        for (const [off, v] of [[0, 1], [0.26, 0.7]] as const) {
          tone(s, { type: 'sine', f0: 90, f1: 45, at: 0.01 + b * period + off, dur: 0.12, peak: 0.9 * v, decay: 0.06, attack: 0.008 });
        }
      }
    },
  })),
  sfx('coin', 'Coin', 'Game', ['coin', 'reward', 'game', 'collect'], [221, 222], (seed) => ({
    seconds: 0.8,
    reverb: { seconds: 0.5, brightness: 0.7, level: -14 },
    build: (s) => {
      const base = seed % 2 ? 1319 : 1175;
      tone(s, { type: 'square', f0: base, at: 0.005, dur: 0.07, peak: 0.2, lowpass: 5000 });
      tone(s, { type: 'square', f0: base * 1.335, at: 0.075, dur: 0.4, peak: 0.2, decay: 0.12, lowpass: 5000, send: 0.2 });
    },
  })),
  sfx('tada', 'Ta-da', 'Notifications', ['tada', 'reveal', 'celebrate', 'fanfare'], [231, 232], (seed) => ({
    seconds: 2.6,
    reverb: { seconds: 1.8, brightness: 0.55, level: -7 },
    build: (s) => {
      const root = seed % 2 ? 60 : 62;
      const chord = [root, root + 4, root + 7, root + 12];
      inst(s, 'brass', root + 7, 0.01, 0.12, 0.7, 0.3);
      for (const n of chord) inst(s, 'brass', n, 0.16, 1.2, 0.85, 0.4);
      inst(s, 'bell', root + 24, 0.16, 1, 0.5, 0.5);
    },
  })),
  sfx('swipe', 'Swipe', 'UI', ['swipe', 'slide', 'ui', 'page'], [241, 242], (seed) => ({
    seconds: 0.5,
    reverb: { seconds: 0.4, brightness: 0.6, level: -16 },
    build: (s) => noise(s, { at: 0.005, dur: 0.22 * jitter(seed, 0.2), peak: 0.7, filter: 'highpass', f0: 1500, f1: 5000, q: 0.8, peakAt: 0.4, pan0: 0.5, pan1: -0.5 }),
  })),
  sfx('drumroll', 'Drum roll + crash', 'Hits', ['drum roll', 'reveal', 'suspense', 'drums'], [251, 252], () => ({
    seconds: 4,
    reverb: { seconds: 1.6, brightness: 0.5, level: -8 },
    build: (s) => {
      for (let i = 0; i < 40; i++) inst(s, 'snare', 0, 0.01 + i * 0.06 + s.rng.next() * 0.008, 0.1, 0.25 + (0.5 * i) / 40, 0.2);
      inst(s, 'kick', 0, 2.42, 0.3, 1, 0);
      inst(s, 'crash', 0, 2.42, 1.5, 1, 0.3);
    },
  })),
];
