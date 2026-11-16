/** Fake engine / encoders / muxer for export pipeline tests. */
import type { CodecChoice } from '../codecs';
import type { Closable, EncoderLike, ExportDeps, MixedAudio, MuxerLike } from '../pipeline';
import type { ExportPlan } from '../plan';

export function fakeAudio(seconds: number, sampleRate = 48000, channels = 2): MixedAudio {
  const length = Math.round(seconds * sampleRate);
  const data = Array.from({ length: channels }, (_, c) => new Float32Array(length).fill(c === 0 ? 0.1 : -0.1));
  return { sampleRate, numberOfChannels: channels, length, getChannelData: (c: number) => data[c]! };
}

export class FakeEncoder<In> implements EncoderLike<In, unknown> {
  state = 'unconfigured';
  queue: { input: In; key?: boolean; ts: number }[] = [];
  config: unknown = null;
  maxQueueSeen = 0;
  encoded = 0;
  private listeners: (() => void)[] = [];
  constructor(
    private init: { output: (chunk: never, meta?: never) => void; error: (e: Error) => void },
    private tsOf: (input: In) => number,
    private delayMs = 0,
  ) {}
  get encodeQueueSize() {
    return this.queue.length;
  }
  configure(c: unknown) {
    this.config = c;
    this.state = 'configured';
  }
  encode(input: In, opts?: { keyFrame?: boolean }) {
    if (this.state !== 'configured') throw new Error(`encode in state ${this.state}`);
    this.queue.push({ input, key: opts?.keyFrame, ts: this.tsOf(input) });
    this.maxQueueSeen = Math.max(this.maxQueueSeen, this.queue.length);
    setTimeout(() => this.drainOne(), this.delayMs);
  }
  private drainOne() {
    const item = this.queue.shift();
    if (!item || this.state === 'closed') return;
    this.encoded++;
    const chunk = { timestamp: item.ts, type: item.key ? 'key' : 'delta', byteLength: 10 } as never;
    this.init.output(chunk, (this.encoded === 1 ? { decoderConfig: { codec: 'x' } } : undefined) as never);
    this.listeners.splice(0).forEach((l) => l());
  }
  triggerError(msg: string) {
    this.state = 'closed';
    this.init.error(new Error(msg));
  }
  async flush() {
    while (this.queue.length) await new Promise((r) => setTimeout(r, 1));
    if (this.state === 'closed') throw new Error('closed');
  }
  close() {
    this.state = 'closed';
  }
  addEventListener(_t: 'dequeue', l: () => void) {
    this.listeners.push(l);
  }
}

export interface FakeWorld {
  deps: ExportDeps;
  renders: { t: number; opts: unknown }[];
  frames: { timestamp: number; duration: number; closed: boolean }[];
  audioData: { timestamp: number; numberOfFrames: number; closed: boolean }[];
  muxVideo: { timestamp: number; type: string; hasMeta: boolean }[];
  muxAudio: { timestamp: number }[];
  muxer: MuxerLike & { finalized: boolean; canceled: boolean; opts: unknown };
  video: () => FakeEncoder<Closable & { timestamp: number }>;
  audio: () => FakeEncoder<Closable & { timestamp: number }> | null;
  mixCalls: unknown[];
}

export function makeWorld(opts: { audio?: MixedAudio | Error; renderError?: number; encoderDelayMs?: number } = {}): FakeWorld {
  const w: Partial<FakeWorld> & { _video?: FakeEncoder<never>; _audio?: FakeEncoder<never> } = {
    renders: [],
    frames: [],
    audioData: [],
    muxVideo: [],
    muxAudio: [],
    mixCalls: [],
  };
  const muxer = {
    finalized: false,
    canceled: false,
    opts: null as unknown,
    async addVideoChunk(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata) {
      w.muxVideo!.push({ timestamp: chunk.timestamp, type: chunk.type, hasMeta: !!meta });
    },
    async addAudioChunk(chunk: EncodedAudioChunk) {
      w.muxAudio!.push({ timestamp: chunk.timestamp });
    },
    async finalize() {
      muxer.finalized = true;
      return new Blob(['fake'], { type: 'video/mp4' });
    },
    async cancel() {
      muxer.canceled = true;
    },
  };
  w.muxer = muxer;
  let t = 0;
  w.deps = {
    engine: {
      async renderFrame(time, _ctx, o) {
        w.renders!.push({ t: time, opts: o });
        if (opts.renderError !== undefined && w.renders!.length - 1 === opts.renderError) throw new Error('decoder stalled');
      },
      async mixAudio(o) {
        w.mixCalls!.push(o);
        if (opts.audio instanceof Error) throw opts.audio;
        return (opts.audio ?? fakeAudio(1)) as AudioBuffer;
      },
    },
    createCanvas: () => ({ canvas: {} as CanvasImageSource, ctx: {} as CanvasRenderingContext2D }),
    createVideoEncoder: (init) => {
      w._video = new FakeEncoder(init as never, (f: { timestamp: number }) => f.timestamp, opts.encoderDelayMs ?? 0) as never;
      return w._video as never;
    },
    createAudioEncoder: (init) => {
      w._audio = new FakeEncoder(init as never, (a: { timestamp: number }) => a.timestamp, 0) as never;
      return w._audio as never;
    },
    createVideoFrame: (_src, init) => {
      const f = { ...init, closed: false, close: () => (f.closed = true) };
      w.frames!.push(f);
      return f;
    },
    createAudioData: (init) => {
      const a = { timestamp: init.timestamp, numberOfFrames: init.numberOfFrames, closed: false, close: () => (a.closed = true) };
      w.audioData!.push(a);
      return a;
    },
    createMuxer: async (o) => {
      muxer.opts = o;
      return muxer;
    },
    now: () => (t += 10),
    yieldToUi: () => Promise.resolve(),
  };
  w.video = () => w._video as never;
  w.audio = () => (w._audio ?? null) as never;
  return w as FakeWorld;
}

export const CODECS: CodecChoice = {
  container: 'mp4',
  video: { codec: 'avc', label: 'H.264', config: { codec: 'avc1.640028', width: 64, height: 36 } },
  audio: { codec: 'aac', label: 'AAC', config: { codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2 } },
  label: 'MP4 (H.264 + AAC)',
  extension: '.mp4',
  mimeType: 'video/mp4',
  fallbackNote: null,
};

export function plan(over: Partial<ExportPlan> = {}): ExportPlan {
  return {
    width: 64,
    height: 36,
    fps: 30,
    duration: 1,
    frameCount: 30,
    videoBitrate: 1_000_000,
    audioBitrate: 128_000,
    keyFrameEvery: 60,
    sampleRate: 48000,
    channels: 2,
    fileName: 'test',
    ...over,
  };
}
