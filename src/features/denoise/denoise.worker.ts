/**
 * Noise-reduction worker (mediabunny + WebCodecs).
 *
 * 1. Decode the file's primary audio track to planar float PCM.
 * 2. Spectral-gate every channel (`spectralGate.ts`).
 * 3. Re-mux: video packets are copied untouched (no re-encode, no quality
 *    loss); audio is re-encoded from the cleaned PCM via `Conversion`'s
 *    `process` hook. Audio-only inputs become 16-bit WAV.
 */
import {
  ALL_FORMATS,
  AudioSample,
  AudioSampleSink,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  MATROSKA,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  WavOutputFormat,
  WEBM,
  WebMOutputFormat,
  type OutputFormat,
} from 'mediabunny';
import type { DenoiseMessage, DenoiseRequest, DenoiseResponse } from './protocol';
import { denoiseChannels } from './spectralGate';

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<DenoiseMessage>) => void) | null;
  postMessage(msg: DenoiseResponse): void;
};

const cancelled = new Set<number>();
let queue: Promise<void> = Promise.resolve();

class Aborted extends Error {}

/** Outputs larger than this are written to disk (OPFS): an in-memory ArrayBuffer cannot exceed ~2 GB. */
const DISK_OUTPUT_BYTES = 1024 * 1024 * 1024;
const OPFS_DIR = 'denoise-output';

interface SyncAccessHandle {
  write(data: Uint8Array, opts: { at: number }): number;
  flush(): void;
  close(): void;
}

/** Output target: memory for normal files, an OPFS file for huge ones (phone videos are often several GB). */
async function makeTarget(inputSize: number): Promise<{ target: BufferTarget | StreamTarget; finish: () => Promise<Blob | null> }> {
  const storage = (navigator as Navigator & { storage?: { getDirectory?: () => Promise<FileSystemDirectoryHandle> } }).storage;
  if (inputSize < DISK_OUTPUT_BYTES || !storage?.getDirectory) {
    const target = new BufferTarget();
    return { target, finish: async () => (target.buffer ? new Blob([target.buffer]) : null) };
  }
  const root = await storage.getDirectory();
  const dir = await root.getDirectoryHandle(OPFS_DIR, { create: true });
  await cleanupOldOutputs(dir);
  const handle = await dir.getFileHandle(`${Date.now()}-${Math.random().toString(36).slice(2)}`, { create: true });
  const access = await (handle as FileSystemFileHandle & { createSyncAccessHandle(): Promise<SyncAccessHandle> }).createSyncAccessHandle();
  const writable = new WritableStream<{ type: 'write'; data: Uint8Array; position: number }>({
    write(chunk) {
      access.write(chunk.data, { at: chunk.position });
    },
  });
  return {
    target: new StreamTarget(writable, { chunked: true }),
    finish: async () => {
      access.flush();
      access.close();
      return handle.getFile(); // disk-backed: no 2 GB limit
    },
  };
}

/** Old outputs are copies already saved into the project storage (IndexedDB): drop them after a day. */
async function cleanupOldOutputs(dir: FileSystemDirectoryHandle): Promise<void> {
  const cutoff = Date.now() - 24 * 3600 * 1000;
  try {
    for await (const [name, entry] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
      if (entry.kind !== 'file') continue;
      const f = await (entry as FileSystemFileHandle).getFile();
      if (f.lastModified < cutoff) await dir.removeEntry(name).catch(() => undefined);
    }
  } catch {
    /* best effort */
  }
}

function concat(parts: Float32Array[], total: number): Float32Array {
  const out = new Float32Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Reads cleaned PCM at an arbitrary time/rate (linear interpolation when rates differ). */
function makeReader(channels: Float32Array[], sampleRate: number, t0: number) {
  return (sample: AudioSample): AudioSample => {
    const frames = sample.numberOfFrames;
    const outCh = sample.numberOfChannels;
    const data = new Float32Array(frames * outCh);
    const sameRate = sample.sampleRate === sampleRate;
    const start = (sample.timestamp - t0) * sampleRate;
    for (let c = 0; c < outCh; c++) {
      const src = channels[Math.min(c, channels.length - 1)]!;
      const dst = data.subarray(c * frames, (c + 1) * frames);
      if (sameRate) {
        const i0 = Math.round(start);
        for (let i = 0; i < frames; i++) {
          const k = i0 + i;
          dst[i] = k >= 0 && k < src.length ? src[k]! : 0;
        }
      } else {
        const step = sampleRate / sample.sampleRate;
        for (let i = 0; i < frames; i++) {
          const pos = start + i * step;
          const k = Math.floor(pos);
          const f = pos - k;
          const a = k >= 0 && k < src.length ? src[k]! : 0;
          const b = k + 1 >= 0 && k + 1 < src.length ? src[k + 1]! : 0;
          dst[i] = a + (b - a) * f;
        }
      }
    }
    return new AudioSample({ data, format: 'f32-planar', numberOfChannels: outCh, sampleRate: sample.sampleRate, timestamp: sample.timestamp });
  };
}

async function run(req: DenoiseRequest): Promise<void> {
  const { id, blob, options } = req;
  const post = (m: DenoiseResponse) => scope.postMessage(m);
  const check = () => {
    if (cancelled.has(id)) throw new Aborted();
  };
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error('This file has no audio track.');
    const video = await input.getPrimaryVideoTrack();
    const duration = (await input.computeDuration()) || 1;

    // 1. decode
    post({ type: 'progress', id, fraction: 0, label: 'Decoding audio…' });
    const parts: Float32Array[][] = [];
    let total = 0;
    let sampleRate = track.sampleRate;
    let channelCount = track.numberOfChannels;
    let t0: number | null = null;
    let lastPost = 0;
    for await (const sample of new AudioSampleSink(track).samples()) {
      check();
      if (t0 === null) {
        t0 = sample.timestamp;
        sampleRate = sample.sampleRate;
        channelCount = sample.numberOfChannels;
      }
      for (let c = 0; c < channelCount; c++) {
        const buf = new Float32Array(sample.numberOfFrames);
        sample.copyTo(buf, { planeIndex: Math.min(c, sample.numberOfChannels - 1), format: 'f32-planar' });
        (parts[c] ??= []).push(buf);
      }
      total += sample.numberOfFrames;
      sample.close();
      if (performance.now() - lastPost > 100) {
        lastPost = performance.now();
        post({ type: 'progress', id, fraction: 0.2 * Math.min(1, total / sampleRate / duration), label: 'Decoding audio…' });
      }
    }
    if (t0 === null || total === 0) throw new Error('The audio track could not be decoded.');
    const pcm = parts.map((p) => concat(p, total));

    // 2. denoise
    const cleaned = denoiseChannels(pcm, sampleRate, options, {
      shouldAbort: () => cancelled.has(id),
      onProgress: (f) => {
        if (performance.now() - lastPost > 100) {
          lastPost = performance.now();
          post({ type: 'progress', id, fraction: 0.2 + 0.5 * f, label: 'Reducing noise…' });
        }
      },
    });
    check();

    // 3. re-mux
    post({ type: 'progress', id, fraction: 0.7, label: 'Saving file…' });
    const inFormat = await input.getFormat();
    let format: OutputFormat;
    if (!video) format = new WavOutputFormat();
    else if (inFormat === WEBM || inFormat === MATROSKA) format = new WebMOutputFormat();
    else format = new Mp4OutputFormat({ fastStart: 'in-memory' });
    const out = await makeTarget(blob.size);
    const output = new Output({ format, target: out.target });
    const read = makeReader(cleaned, sampleRate, t0);
    const conversion = await Conversion.init({
      input,
      output,
      video: video ? {} : { discard: true },
      audio: (t) => (t === track ? { forceTranscode: true, process: read, ...(video ? {} : { codec: 'pcm-s16' as const }) } : { discard: true }),
    });
    // Never hand back a "video" without its picture: if the video track cannot be carried over, stop.
    const lostVideo = video ? conversion.discardedTracks.find((d) => d.track === video) : undefined;
    if (lostVideo) throw new Error(`The video track could not be copied (${lostVideo.reason.replace(/_/g, ' ')}); the original file is unchanged.`);
    if (!conversion.isValid) {
      throw new Error(`Cannot write the cleaned file: ${conversion.discardedTracks.map((d) => d.reason).join(', ') || 'unsupported format'}`);
    }
    conversion.onProgress = (p) => {
      if (cancelled.has(id)) void conversion.cancel();
      post({ type: 'progress', id, fraction: 0.7 + 0.3 * p, label: 'Saving file…' });
    };
    await conversion.execute();
    check();
    const written = await out.finish();
    if (!written) throw new Error('Writing the cleaned file failed.');
    post({ type: 'result', id, blob: new Blob([written], { type: format.mimeType }), extension: format.fileExtension, hasVideo: !!video });
  } catch (err) {
    const aborted = err instanceof Aborted || cancelled.has(id) || (err instanceof Error && (err.name === 'AbortError' || err.name === 'ConversionCanceledError'));
    post({ type: 'error', id, message: aborted ? 'aborted' : err instanceof Error ? err.message : String(err), aborted });
  } finally {
    cancelled.delete(id);
    input.dispose();
  }
}

scope.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'cancel') cancelled.add(msg.id);
  else queue = queue.then(() => run(msg));
};
