/**
 * Renders an `Arrangement` with an OfflineAudioContext (async, off the UI's
 * critical path: the audio graph runs on the audio rendering thread; notes are
 * scheduled in ~2 s chunks from `suspend()` callbacks, which also report
 * progress). Then, in JS: tails are wrapped into the loop start, the loop is
 * limited circularly and normalised to the loudness target.
 */
import { clonePcm, fadeEdgesInPlace, normalize, pcmLength, wrapTail, type NormalizeOptions, type Pcm } from './master';
import { Rng } from './rng';
import { noiseSample, reverbImpulse } from './samples';
import type { Arrangement, InstrumentSpec, NoteEvent } from './types';
import { VOICES, type VoiceEnv } from './voices';

export const MUSIC_SAMPLE_RATE = 44100;
/** Integrated loudness of every music loop (LUFS). Clip volume (~30 %) then sits it under speech. */
export const MUSIC_TARGET_LUFS = -16;
/** Loudest 400 ms of every sound effect (LUFS). */
export const SFX_TARGET_LUFS = -14;
/** True-peak-ish ceiling: -1 dBFS. */
export const CEILING = 0.891;

export type ContextFactory = (channels: number, length: number, sampleRate: number) => OfflineAudioContext;

export interface RenderOptions {
  sampleRate?: number;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
  createContext?: ContextFactory;
  /** Skip loudness normalisation/limiting (diagnostics: stem balance). */
  raw?: boolean;
}

const defaultContext: ContextFactory = (c, l, r) => new OfflineAudioContext(c, l, r);

const dbToGain = (db: number) => Math.pow(10, db / 20);

/** Tail length rendered past the loop end (then wrapped to the start). */
export function tailSeconds(arr: Arrangement): number {
  const delayRing = arr.delay ? ((arr.delay.beats * 60) / arr.bpm) * Math.log(0.001) / Math.log(Math.max(0.05, arr.delay.feedback)) : 0;
  return Math.min(arr.loopSeconds, Math.max(arr.reverb.seconds + 1.5, Math.min(8, delayRing)) + 0.5);
}

/**
 * Sidechain envelope (gain multiplier 0..1 per curve point, `rate` points/s)
 * for `depth`: dips at every hit of the duck source and recovers with
 * `release`. Periodic: hits from the previous/next loop pass are included.
 */
export function duckCurve(arr: Arrangement, depth: number, seconds: number, rate = 400): Float32Array {
  const n = Math.max(2, Math.ceil(seconds * rate) + 1);
  const env = new Float32Array(n);
  if (!arr.duck || depth <= 0) return env.fill(1);
  const rel = arr.duck.release;
  const hits = arr.events.filter((e) => e.inst === arr.duck!.source);
  const attack = 0.006;
  for (const shift of [-arr.loopSeconds, 0, arr.loopSeconds, 2 * arr.loopSeconds]) {
    for (const h of hits) {
      const t0 = h.t + shift;
      if (t0 > seconds || t0 + rel * 6 < 0) continue;
      const i0 = Math.max(0, Math.floor((t0 - attack) * rate));
      const i1 = Math.min(n - 1, Math.ceil((t0 + rel * 6) * rate));
      for (let i = i0; i <= i1; i++) {
        const t = i / rate - t0;
        const v = t < 0 ? 1 + t / attack : Math.exp(-t / rel);
        env[i] = Math.max(env[i]!, Math.max(0, v) * h.v);
      }
    }
  }
  for (let i = 0; i < n; i++) env[i] = 1 - depth * Math.min(1, env[i]!);
  return env;
}

interface InstrumentBus {
  input: GainNode;
  spec: InstrumentSpec;
}

function buildGraph(ctx: OfflineAudioContext, arr: Arrangement, seconds: number): Map<string, InstrumentBus> {
  const fs = ctx.sampleRate;
  const master = ctx.createGain();
  master.gain.value = 0.5;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 28;
  hp.Q.value = 0.6;
  master.connect(hp).connect(ctx.destination);

  // Reverb
  const [irL, irR] = reverbImpulse(arr.reverb.seconds, arr.reverb.brightness, arr.reverb.preDelay, fs);
  const ir = ctx.createBuffer(2, irL.length, fs);
  ir.copyToChannel(irL as Float32Array<ArrayBuffer>, 0);
  ir.copyToChannel(irR as Float32Array<ArrayBuffer>, 1);
  const conv = ctx.createConvolver();
  conv.normalize = false;
  conv.buffer = ir;
  const revIn = ctx.createGain();
  const revHp = ctx.createBiquadFilter();
  revHp.type = 'highpass';
  revHp.frequency.value = 220;
  const revOut = ctx.createGain();
  revOut.gain.value = dbToGain(arr.reverb.level);
  revIn.connect(revHp).connect(conv).connect(revOut).connect(master);

  // Tempo-synced feedback delay (darkening repeats), slightly widened.
  let delayIn: GainNode | null = null;
  if (arr.delay) {
    delayIn = ctx.createGain();
    const time = (arr.delay.beats * 60) / arr.bpm;
    const dl = ctx.createDelay(4);
    dl.delayTime.value = time;
    const dr = ctx.createDelay(4);
    dr.delayTime.value = time * 1.5;
    const fb = ctx.createGain();
    fb.gain.value = arr.delay.feedback;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = arr.delay.tone;
    const hpD = ctx.createBiquadFilter();
    hpD.type = 'highpass';
    hpD.frequency.value = 300;
    delayIn.connect(hpD).connect(dl);
    dl.connect(tone).connect(fb).connect(dl);
    const out = ctx.createGain();
    out.gain.value = dbToGain(arr.delay.level);
    const pl = ctx.createStereoPanner();
    pl.pan.value = -0.45;
    const pr = ctx.createStereoPanner();
    pr.pan.value = 0.45;
    tone.connect(pl).connect(out);
    tone.connect(dr).connect(pr).connect(out);
    out.connect(master);
    const toRev = ctx.createGain();
    toRev.gain.value = 0.3;
    out.connect(toRev).connect(revIn);
  }

  const buses = new Map<string, InstrumentBus>();
  for (const [id, spec] of Object.entries(arr.instruments)) {
    const input = ctx.createGain();
    input.gain.value = dbToGain(spec.gain);
    let node: AudioNode = input;
    if (spec.duck && arr.duck) {
      const duck = ctx.createGain();
      duck.gain.setValueCurveAtTime(duckCurve(arr, spec.duck, seconds), 0, seconds);
      node = node.connect(duck);
    }
    const pan = ctx.createStereoPanner();
    pan.pan.value = spec.pan ?? 0;
    node = node.connect(pan);
    node.connect(master);
    if (spec.reverb) {
      const s = ctx.createGain();
      s.gain.value = spec.reverb;
      node.connect(s).connect(revIn);
    }
    if (spec.delay && delayIn) {
      const s = ctx.createGain();
      s.gain.value = spec.delay;
      node.connect(s).connect(delayIn);
    }
    buses.set(id, { input, spec });
  }
  return buses;
}

function makeVoiceEnv(ctx: BaseAudioContext): VoiceEnv {
  const fs = ctx.sampleRate;
  const noiseData = noiseSample(2.5, fs, 7);
  const noise = ctx.createBuffer(1, noiseData.length, fs);
  noise.copyToChannel(noiseData as Float32Array<ArrayBuffer>, 0);
  const buffers = new Map<string, AudioBuffer>();
  return {
    ctx,
    noise,
    buffer(key, data) {
      let b = buffers.get(key);
      if (!b) {
        const d = data();
        b = ctx.createBuffer(1, Math.max(1, d.length), fs);
        if (d.length) b.copyToChannel(d as Float32Array<ArrayBuffer>, 0);
        buffers.set(key, b);
      }
      return b;
    },
  };
}

// ---------------------------------------------------------------------------
// Mastering worker (falls back to the main thread where workers are unavailable, e.g. tests)
// ---------------------------------------------------------------------------

let worker: Worker | null | undefined;
let reqId = 0;
const waiting = new Map<number, (r: { channels: Float32Array[]; lufs: number; peak: number }) => void>();

function masterWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = typeof Worker !== 'undefined' ? new Worker(new URL('./master.worker.ts', import.meta.url), { type: 'module' }) : null;
    worker?.addEventListener('message', (e: MessageEvent<{ id: number; channels: Float32Array[]; lufs: number; peak: number }>) => {
      waiting.get(e.data.id)?.(e.data);
      waiting.delete(e.data.id);
    });
    worker?.addEventListener('error', () => {
      worker = null;
    });
  } catch {
    worker = null;
  }
  return worker;
}

/** Loudness-normalises + limits a buffer in a worker (transferring the samples). */
export async function masterOffThread(p: Pcm, o: NormalizeOptions): Promise<{ pcm: Pcm; lufs: number; peak: number }> {
  const w = masterWorker();
  if (!w) {
    const r = normalize(p, o);
    return { pcm: p, lufs: r.lufs, peak: r.peak };
  }
  const id = ++reqId;
  const res = await new Promise<{ channels: Float32Array[]; lufs: number; peak: number }>((resolve, reject) => {
    waiting.set(id, resolve);
    const timer = setTimeout(() => {
      if (waiting.delete(id)) reject(new Error('Mastering timed out'));
    }, 60000);
    waiting.set(id, (r) => {
      clearTimeout(timer);
      resolve(r);
    });
    w.postMessage({ id, sampleRate: p.sampleRate, channels: p.channels, opts: o }, p.channels.map((c) => c.buffer as ArrayBuffer));
  });
  return { pcm: { sampleRate: p.sampleRate, channels: res.channels }, lufs: res.lufs, peak: res.peak };
}

export interface RenderResult {
  pcm: Pcm;
  /** Wall time of the render, ms. */
  ms: number;
  lufs: number;
  peak: number;
}

function toPcm(buf: AudioBuffer): Pcm {
  return { sampleRate: buf.sampleRate, channels: Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c)) };
}

/** Renders one seamless, mastered loop of the arrangement. */
export async function renderArrangement(arr: Arrangement, opts: RenderOptions = {}): Promise<RenderResult> {
  const t0 = performance.now();
  const fs = opts.sampleRate ?? MUSIC_SAMPLE_RATE;
  const loopLen = Math.round(arr.loopSeconds * fs);
  const tail = Math.round(tailSeconds(arr) * fs);
  const total = loopLen + tail;
  const seconds = total / fs;
  const ctx = (opts.createContext ?? defaultContext)(2, total, fs);
  const buses = buildGraph(ctx, arr, seconds);
  const env = makeVoiceEnv(ctx);
  const events = arr.events;
  let next = 0;
  const schedule = (until: number) => {
    while (next < events.length && events[next]!.t < until) {
      const e: NoteEvent = events[next++]!;
      const bus = buses.get(e.inst);
      if (!bus) continue;
      VOICES[bus.spec.voice](env, bus.input, e, bus.spec.params ?? {});
    }
  };
  // Chunked scheduling: suspend points every ~2 s (quantised to the 128-frame render quantum).
  const chunk = Math.max(128, Math.floor((2 * fs) / 128) * 128);
  const lead = 0.25; // schedule a little ahead of each boundary
  schedule(chunk / fs + lead);
  for (let f = chunk; f < total; f += chunk) {
    const at = f / fs;
    void ctx.suspend(at).then(() => {
      if (!opts.signal?.aborted) schedule(at + chunk / fs + lead);
      opts.onProgress?.(Math.min(0.95, (f / total) * 0.9));
      void ctx.resume();
    });
  }
  const rendered = await ctx.startRendering();
  if (opts.signal?.aborted) throw new DOMException('Render aborted', 'AbortError');
  // Yield before the JS mastering pass.
  await new Promise((r) => setTimeout(r, 0));
  const loop = wrapTail(toPcm(rendered), loopLen);
  if (opts.raw) return { pcm: loop, ms: performance.now() - t0, lufs: NaN, peak: NaN };
  const { pcm, lufs, peak } = await masterOffThread(loop, { targetLufs: MUSIC_TARGET_LUFS, ceiling: CEILING, circular: true });
  opts.onProgress?.(1);
  return { pcm, ms: performance.now() - t0, lufs, peak };
}

// ---------------------------------------------------------------------------
// One-shot sound effects
// ---------------------------------------------------------------------------

export interface SfxContext {
  ctx: OfflineAudioContext;
  /** Destination for the effect (goes through a gentle high-pass). */
  out: AudioNode;
  noise: AudioBuffer;
  rng: Rng;
  /** Reverb send (short room/plate). */
  reverb: AudioNode;
  env: VoiceEnv;
}

export interface SfxBuild {
  seconds: number;
  /** Reverb tail length (default 1.2 s) and brightness. */
  reverb?: { seconds: number; brightness: number; level: number };
  build(s: SfxContext): void;
}

/** Renders a one-shot effect, peak-limited and loudness-normalised. */
export async function renderSfx(def: SfxBuild, seed: number, opts: RenderOptions = {}): Promise<RenderResult> {
  const t0 = performance.now();
  const fs = opts.sampleRate ?? MUSIC_SAMPLE_RATE;
  const total = Math.round(def.seconds * fs);
  const ctx = (opts.createContext ?? defaultContext)(2, total, fs);
  const out = ctx.createGain();
  out.gain.value = 0.5;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 25;
  out.connect(hp).connect(ctx.destination);
  const rv = def.reverb ?? { seconds: 1.2, brightness: 0.6, level: -8 };
  const [l, r] = reverbImpulse(rv.seconds, rv.brightness, 0.01, fs);
  const ir = ctx.createBuffer(2, l.length, fs);
  ir.copyToChannel(l as Float32Array<ArrayBuffer>, 0);
  ir.copyToChannel(r as Float32Array<ArrayBuffer>, 1);
  const conv = ctx.createConvolver();
  conv.normalize = false;
  conv.buffer = ir;
  const rin = ctx.createGain();
  const rout = ctx.createGain();
  rout.gain.value = dbToGain(rv.level);
  rin.connect(conv).connect(rout).connect(out);
  const env = makeVoiceEnv(ctx);
  def.build({ ctx, out, noise: env.noise, rng: new Rng(seed), reverb: rin, env });
  opts.onProgress?.(0.3);
  const rendered = await ctx.startRendering();
  const pcm = clonePcm(toPcm(rendered));
  fadeEdgesInPlace(pcm, 0, Math.min(0.02, def.seconds / 10));
  const res = await masterOffThread(pcm, { targetLufs: SFX_TARGET_LUFS, ceiling: CEILING, momentary: true, maxBoostDb: 24 });
  opts.onProgress?.(1);
  return { pcm: res.pcm, ms: performance.now() - t0, lufs: res.lufs, peak: res.peak };
}

export { pcmLength };
