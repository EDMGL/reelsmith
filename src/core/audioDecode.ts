/**
 * Decodes the audio of a media file (audio or video) to an AudioBuffer at a
 * chosen sample rate / channel count.
 *
 * - Small files: Web Audio `decodeAudioData` (reads the whole file at once).
 * - Large files, or when that fails: mediabunny reads the file in slices and
 *   decodes only the primary audio track (WebCodecs). Phone videos are often
 *   several GB, and Chrome cannot read a Blob larger than ~2 GB in one go
 *   ("NotReadableError: The requested file could not be read…"); slices work.
 *
 * Returns null when the file has no (decodable) audio track.
 */

/** Above this size the whole-file path is skipped. */
export const STREAMING_DECODE_BYTES = 256 * 1024 * 1024;

export interface DecodeMediaAudioOptions {
  sampleRate: number;
  /** Output channels (default: the source's, at most 2). Web Audio up/down-mixes. */
  channels?: number;
  /** 0..1 while decoding (streaming path only). */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

function abortIf(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Decoding aborted', 'AbortError');
}

/** Resamples/remixes `src` (at `srcRate`) with an OfflineAudioContext. */
async function render(channels: Float32Array[], frames: number, srcRate: number, opts: DecodeMediaAudioOptions): Promise<AudioBuffer> {
  const outCh = Math.max(1, Math.min(32, opts.channels ?? Math.min(2, channels.length)));
  const outLen = Math.max(1, Math.ceil((frames * opts.sampleRate) / srcRate));
  const ctx = new OfflineAudioContext(outCh, outLen, opts.sampleRate);
  if (srcRate === opts.sampleRate && channels.length === outCh) {
    const b = ctx.createBuffer(outCh, outLen, opts.sampleRate);
    channels.forEach((d, c) => b.copyToChannel(d.subarray(0, outLen) as Float32Array<ArrayBuffer>, c));
    return b;
  }
  const src = ctx.createBuffer(channels.length, Math.max(1, frames), srcRate);
  channels.forEach((d, c) => src.copyToChannel(d.subarray(0, frames) as Float32Array<ArrayBuffer>, c));
  const node = ctx.createBufferSource();
  node.buffer = src;
  node.connect(ctx.destination);
  node.start(0);
  return ctx.startRendering();
}

async function decodeWhole(blob: Blob, opts: DecodeMediaAudioOptions): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(1, 1, opts.sampleRate);
  const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
  if (opts.channels === undefined || opts.channels === buf.numberOfChannels) return buf;
  const ch = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
  return render(ch, buf.length, buf.sampleRate, opts);
}

async function decodeStreaming(blob: Blob, opts: DecodeMediaAudioOptions): Promise<AudioBuffer | null> {
  const mb = await import('mediabunny');
  const input = new mb.Input({ source: new mb.BlobSource(blob), formats: mb.ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) return null;
    if (!(await track.canDecode())) throw new Error(`Unsupported audio codec (${track.codec ?? 'unknown'})`);
    const duration = Math.max(0, await input.computeDuration());
    const srcRate = track.sampleRate;
    const nCh = Math.max(1, Math.min(2, track.numberOfChannels));
    let capacity = Math.ceil(duration * srcRate) + srcRate;
    let data = Array.from({ length: nCh }, () => new Float32Array(capacity));
    let frames = 0;
    let lastReport = 0;
    for await (const sample of new mb.AudioSampleSink(track).samples()) {
      try {
        abortIf(opts.signal);
        const n = sample.numberOfFrames;
        // Media time 0 = timestamp 0; encoder priming (negative timestamps) is dropped.
        const at = Math.round(sample.timestamp * srcRate);
        const skip = Math.max(0, -at);
        if (skip >= n) continue;
        const dst = Math.max(0, at);
        if (dst + n > capacity) {
          capacity = Math.max(capacity * 2, dst + n);
          data = data.map((d) => {
            const g = new Float32Array(capacity);
            g.set(d);
            return g;
          });
        }
        const tmp = new Float32Array(n);
        for (let c = 0; c < nCh; c++) {
          sample.copyTo(tmp, { planeIndex: Math.min(c, sample.numberOfChannels - 1), format: 'f32-planar' });
          data[c]!.set(skip ? tmp.subarray(skip) : tmp, dst);
        }
        frames = Math.max(frames, dst + n - skip);
        if (opts.onProgress && duration > 0 && sample.timestamp - lastReport > 1) {
          lastReport = sample.timestamp;
          opts.onProgress(Math.min(1, sample.timestamp / duration));
        }
      } finally {
        sample.close();
      }
    }
    if (frames === 0) return null;
    abortIf(opts.signal);
    opts.onProgress?.(1);
    return render(data, frames, srcRate, opts);
  } finally {
    input.dispose();
  }
}

export async function decodeMediaAudio(blob: Blob, opts: DecodeMediaAudioOptions): Promise<AudioBuffer | null> {
  abortIf(opts.signal);
  if (blob.size <= STREAMING_DECODE_BYTES) {
    try {
      return await decodeWhole(blob, opts);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      // fall through: some containers/codecs decode only via WebCodecs
    }
  }
  return decodeStreaming(blob, opts);
}
