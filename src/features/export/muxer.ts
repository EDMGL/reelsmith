/**
 * Muxer adapter over `mediabunny` (MPL-2.0). Receives already-encoded
 * WebCodecs chunks; writes MP4 (fast start, moov at front) or WebM into memory.
 * Loaded lazily (dynamic import) so the library stays out of the main bundle.
 */
import {
  BufferTarget,
  EncodedAudioPacketSource,
  EncodedPacket,
  EncodedVideoPacketSource,
  Mp4OutputFormat,
  Output,
  WebMOutputFormat,
} from 'mediabunny';
import type { MuxerLike, MuxerOptions } from './pipeline';

export async function createMediabunnyMuxer(opts: MuxerOptions): Promise<MuxerLike> {
  const target = new BufferTarget();
  const output = new Output({
    format: opts.container === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(),
    target,
  });
  const video = new EncodedVideoPacketSource(opts.videoCodec);
  output.addVideoTrack(video, { frameRate: opts.fps });
  const audio = opts.audioCodec ? new EncodedAudioPacketSource(opts.audioCodec) : null;
  if (audio) output.addAudioTrack(audio);
  await output.start();
  return {
    addVideoChunk: (chunk, meta) => video.add(EncodedPacket.fromEncodedChunk(chunk), meta),
    addAudioChunk: (chunk, meta) => {
      if (!audio) return Promise.resolve();
      return audio.add(EncodedPacket.fromEncodedChunk(chunk), meta);
    },
    async finalize() {
      await output.finalize();
      if (!target.buffer) throw new Error('Muxer produced no data');
      return new Blob([target.buffer], { type: opts.mimeType });
    },
    async cancel() {
      if (output.state !== 'finalized' && output.state !== 'canceled') await output.cancel();
    },
  };
}
