/**
 * Export pipeline: engine.renderFrame -> VideoFrame -> VideoEncoder -> muxer,
 * engine.mixAudio -> AudioData chunks -> AudioEncoder -> muxer.
 *
 * All platform objects come through `ExportDeps`, so the orchestration
 * (ordering, timestamps, backpressure, cancel, errors) is unit-testable with
 * fakes. `browserExportDeps()` supplies the real WebCodecs/mediabunny ones.
 */
import type { Canvas2D, PlaybackEngine } from '../../core';
import type { AudioCodecId, CodecChoice, Container, VideoCodecId } from './codecs';
import { frameDurationUs, frameTimestampUs, isKeyFrame, type ExportPlan } from './plan';

export class ExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportError';
  }
}

export function isAbortError(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError';
}

function abortError(): Error {
  const e = new Error('Export cancelled');
  e.name = 'AbortError';
  return e;
}

export interface MuxerOptions {
  container: Container;
  videoCodec: VideoCodecId;
  audioCodec: AudioCodecId | null;
  fps: number;
  mimeType: string;
}

export interface MuxerLike {
  addVideoChunk(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata): Promise<void>;
  addAudioChunk(chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata): Promise<void>;
  finalize(): Promise<Blob>;
  cancel(): Promise<void>;
}

export interface EncoderLike<Input, Config> {
  configure(config: Config): void;
  encode(input: Input, opts?: { keyFrame?: boolean }): void;
  flush(): Promise<void>;
  close(): void;
  readonly encodeQueueSize: number;
  readonly state: string;
  addEventListener?(type: 'dequeue', listener: () => void, opts?: { once?: boolean }): void;
}

export interface Closable {
  close(): void;
}

/** Minimal AudioBuffer surface the pipeline reads. */
export type MixedAudio = Pick<AudioBuffer, 'sampleRate' | 'numberOfChannels' | 'length' | 'getChannelData'>;

export interface ExportDeps {
  engine: Pick<PlaybackEngine, 'renderFrame' | 'mixAudio'>;
  createCanvas(width: number, height: number): { canvas: CanvasImageSource; ctx: Canvas2D };
  createVideoEncoder(init: { output: (chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata) => void; error: (e: Error) => void }): EncoderLike<Closable, VideoEncoderConfig>;
  createAudioEncoder(init: { output: (chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata) => void; error: (e: Error) => void }): EncoderLike<Closable, AudioEncoderConfig>;
  createVideoFrame(source: CanvasImageSource, init: { timestamp: number; duration: number }): Closable;
  createAudioData(init: { sampleRate: number; numberOfChannels: number; numberOfFrames: number; timestamp: number; data: Float32Array<ArrayBuffer> }): Closable;
  createMuxer(opts: MuxerOptions): Promise<MuxerLike>;
  now(): number;
  /** Lets the UI breathe; default setTimeout(0). */
  yieldToUi?(): Promise<void>;
}

export type ExportPhase = 'audio' | 'video' | 'finalizing';

export interface ExportProgress {
  phase: ExportPhase;
  framesDone: number;
  totalFrames: number;
  elapsedMs: number;
  /** null until enough frames are done to estimate. */
  etaMs: number | null;
  /** 0..1 overall. */
  fraction: number;
}

export interface RunExportOptions {
  signal?: AbortSignal;
  onProgress?: (p: ExportProgress) => void;
}

/** Max frames waiting in the video encoder before we wait for it. */
export const MAX_VIDEO_QUEUE = 8;
/** Audio is sent in chunks of this many sample frames. */
export const AUDIO_CHUNK_FRAMES = 4800;
/** Wait for pending muxer writes every N frames. */
const MUX_SYNC_EVERY = 10;
const YIELD_EVERY = 4;

function errText(e: unknown): string {
  return e instanceof Error ? e.message || e.name : String(e);
}

function waitForDequeue(enc: EncoderLike<unknown, unknown>): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    enc.addEventListener?.('dequeue', finish, { once: true });
    setTimeout(finish, 20);
  });
}

/** Runs one export; resolves with the finished file. Throws AbortError on cancel, ExportError on failure. */
export async function runExport(plan: ExportPlan, codecs: CodecChoice, deps: ExportDeps, opts: RunExportOptions = {}): Promise<Blob> {
  const { signal, onProgress } = opts;
  const total = plan.frameCount;
  if (total <= 0) throw new ExportError('Nothing to export: the timeline is empty.');
  const yieldToUi = deps.yieldToUi ?? (() => new Promise<void>((r) => setTimeout(r, 0)));
  const t0 = deps.now();
  const checkAbort = () => {
    if (signal?.aborted) throw abortError();
  };
  let fatal: Error | null = null;
  const fail = (e: unknown) => {
    fatal ??= e instanceof ExportError ? e : new ExportError(`Writing the file failed: ${errText(e)}`);
  };
  const report = (phase: ExportPhase, framesDone: number) => {
    const elapsedMs = deps.now() - t0;
    const etaMs = framesDone > 0 && phase === 'video' ? (elapsedMs / framesDone) * (total - framesDone) : null;
    const fraction = phase === 'audio' ? 0 : phase === 'finalizing' ? 1 : framesDone / total;
    onProgress?.({ phase, framesDone, totalFrames: total, elapsedMs, etaMs, fraction });
  };

  checkAbort();

  // ---- audio mix (one offline render up front) ----
  let mixed: MixedAudio | null = null;
  if (codecs.audio) {
    report('audio', 0);
    try {
      mixed = await deps.engine.mixAudio({ start: 0, end: plan.duration, sampleRate: plan.sampleRate, channels: plan.channels });
    } catch (e) {
      throw new ExportError(`Mixing the audio failed: ${errText(e)}`);
    }
    checkAbort();
  }

  let muxer: MuxerLike;
  try {
    muxer = await deps.createMuxer({
      container: codecs.container,
      videoCodec: codecs.video.codec,
      audioCodec: codecs.audio?.codec ?? null,
      fps: plan.fps,
      mimeType: codecs.mimeType,
    });
  } catch (e) {
    throw new ExportError(`Could not create the ${codecs.container.toUpperCase()} writer: ${errText(e)}`);
  }

  let muxChain: Promise<void> = Promise.resolve();
  const enqueueMux = (fn: () => Promise<void>) => {
    muxChain = muxChain.then(() => (fatal ? undefined : fn())).catch(fail);
  };

  let videoEncoder: EncoderLike<Closable, VideoEncoderConfig> | null = null;
  let audioEncoder: EncoderLike<Closable, AudioEncoderConfig> | null = null;
  const closeEncoders = () => {
    for (const enc of [videoEncoder, audioEncoder]) {
      try {
        if (enc && enc.state !== 'closed') enc.close();
      } catch {
        /* already closed */
      }
    }
  };

  try {
    try {
      videoEncoder = deps.createVideoEncoder({
        output: (chunk, meta) => enqueueMux(() => muxer.addVideoChunk(chunk, meta)),
        error: (e) => fail(new ExportError(`Video encoder error: ${errText(e)}`)),
      });
      videoEncoder.configure(codecs.video.config);
      if (codecs.audio && mixed) {
        audioEncoder = deps.createAudioEncoder({
          output: (chunk, meta) => enqueueMux(() => muxer.addAudioChunk(chunk, meta)),
          error: (e) => fail(new ExportError(`Audio encoder error: ${errText(e)}`)),
        });
        audioEncoder.configure({ ...codecs.audio.config, sampleRate: mixed.sampleRate, numberOfChannels: mixed.numberOfChannels });
      }
    } catch (e) {
      throw new ExportError(`Could not start the encoder: ${errText(e)}`);
    }

    // ---- audio feeding, interleaved with video by time ----
    let audioPos = 0;
    const audioLen = mixed?.length ?? 0;
    const feedAudioUntil = (endSec: number, final: boolean) => {
      if (!audioEncoder || !mixed) return;
      const sr = mixed.sampleRate;
      const ch = mixed.numberOfChannels;
      const end = Math.min(audioLen, Math.round(endSec * sr));
      while (audioPos < end && (final || end - audioPos >= AUDIO_CHUNK_FRAMES)) {
        const n = Math.min(AUDIO_CHUNK_FRAMES, end - audioPos);
        const data = new Float32Array(n * ch);
        for (let c = 0; c < ch; c++) data.set(mixed.getChannelData(c).subarray(audioPos, audioPos + n), c * n);
        const ad = deps.createAudioData({ sampleRate: sr, numberOfChannels: ch, numberOfFrames: n, timestamp: Math.round((audioPos * 1_000_000) / sr), data });
        try {
          audioEncoder.encode(ad);
        } finally {
          ad.close();
        }
        audioPos += n;
      }
    };

    // ---- video frames ----
    const { canvas, ctx } = deps.createCanvas(plan.width, plan.height);
    report('video', 0);
    for (let i = 0; i < total; i++) {
      checkAbort();
      if (fatal) throw fatal;
      const t = i / plan.fps;
      try {
        await deps.engine.renderFrame(t, ctx, { isExport: true, width: plan.width, height: plan.height });
      } catch (e) {
        throw new ExportError(`Rendering frame ${i + 1} (${t.toFixed(2)} s) failed: ${errText(e)}`);
      }
      checkAbort();
      if (fatal) throw fatal;
      const frame = deps.createVideoFrame(canvas, { timestamp: frameTimestampUs(i, plan.fps), duration: frameDurationUs(i, plan.fps) });
      try {
        videoEncoder.encode(frame, { keyFrame: isKeyFrame(i, plan.fps) });
      } finally {
        frame.close();
      }
      feedAudioUntil(frameTimestampUs(i + 1, plan.fps) / 1_000_000, false);
      while (videoEncoder.encodeQueueSize > MAX_VIDEO_QUEUE && !fatal && !signal?.aborted) await waitForDequeue(videoEncoder);
      if ((i + 1) % MUX_SYNC_EVERY === 0) await muxChain;
      if ((i + 1) % YIELD_EVERY === 0) await yieldToUi();
      report('video', i + 1);
    }
    feedAudioUntil(audioLen / (mixed?.sampleRate ?? 1), true);
    checkAbort();

    // ---- drain + finalize ----
    report('finalizing', total);
    try {
      await videoEncoder.flush();
      await audioEncoder?.flush();
    } catch (e) {
      throw fatal ?? new ExportError(`Encoding failed while finishing: ${errText(e)}`);
    }
    await muxChain;
    if (fatal) throw fatal;
    checkAbort();
    closeEncoders();
    let blob: Blob;
    try {
      blob = await muxer.finalize();
    } catch (e) {
      throw new ExportError(`Finalizing the file failed: ${errText(e)}`);
    }
    report('finalizing', total);
    return blob;
  } catch (e) {
    closeEncoders();
    try {
      await muxer.cancel();
    } catch {
      /* ignore */
    }
    if (signal?.aborted) throw abortError();
    // An encoder/muxer error callback usually comes first; later calls then fail
    // with a less useful InvalidStateError, so report the recorded cause.
    const cause: unknown = fatal ?? e;
    throw cause instanceof ExportError ? cause : new ExportError(`Export failed: ${errText(cause)}`);
  }
}

// ---------------------------------------------------------------------------
// Browser implementations
// ---------------------------------------------------------------------------

export function browserExportDeps(engine: ExportDeps['engine']): ExportDeps {
  return {
    engine,
    createCanvas(width, height) {
      if (typeof OffscreenCanvas !== 'undefined') {
        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) throw new ExportError('Could not create a 2D canvas for rendering.');
        return { canvas, ctx };
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) throw new ExportError('Could not create a 2D canvas for rendering.');
      return { canvas, ctx };
    },
    createVideoEncoder: (init) => new VideoEncoder(init),
    createAudioEncoder: (init) => new AudioEncoder(init),
    createVideoFrame: (source, init) => new VideoFrame(source, { ...init, alpha: 'discard' }),
    createAudioData: (init) => new AudioData({ format: 'f32-planar', ...init }),
    createMuxer: async (opts) => (await import('./muxer')).createMediabunnyMuxer(opts),
    now: () => performance.now(),
  };
}

/** WebCodecs available at all? */
export function hasWebCodecs(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}
