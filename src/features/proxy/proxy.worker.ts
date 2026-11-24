/// <reference lib="webworker" />
/**
 * Builds a preview proxy of a video file: small (short side PROXY_SHORT_SIDE),
 * H.264 with a key frame every KEY_FRAME_INTERVAL seconds, audio kept.
 * Frequent key frames make every seek (each silence cut is one) cheap; the
 * small size makes decoding cheap. Falls back to VP9/WebM where H.264 cannot be
 * encoded.
 */
import { ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Mp4OutputFormat, Output, QUALITY_MEDIUM, WebMOutputFormat, type InputVideoTrack } from 'mediabunny';
import type { ProxyMessage, ProxyResponse } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

const even = (x: number) => Math.max(2, Math.round(x / 2) * 2);

function post(m: ProxyResponse): void {
  self.postMessage(m);
}

const running = new Map<number, Conversion>();
const cancelled = new Set<number>();

async function convert(id: number, blob: Blob, shortSide: number, keyFrameInterval: number, webm: boolean): Promise<Blob | null> {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const format = webm ? new WebMOutputFormat() : new Mp4OutputFormat({ fastStart: 'in-memory' });
    const target = new BufferTarget();
    const output = new Output({ format, target });
    const conversion = await Conversion.init({
      input,
      output,
      tracks: 'primary',
      showWarnings: false,
      video: (track: InputVideoTrack) => {
        const w = track.displayWidth;
        const h = track.displayHeight;
        const scale = Math.min(1, shortSide / Math.max(1, Math.min(w, h)));
        return { codec: webm ? 'vp9' : 'avc', width: even(w * scale), height: even(h * scale), fit: 'fill', keyFrameInterval, quality: QUALITY_MEDIUM };
      },
      audio: webm ? { codec: 'opus' } : {},
    });
    const video = conversion.utilizedTracks.some((t) => t.isVideoTrack());
    if (!conversion.isValid || !video) return null;
    running.set(id, conversion);
    conversion.onProgress = (p) => post({ type: 'progress', id, fraction: p });
    if (cancelled.has(id)) return null;
    await conversion.execute();
    if (!target.buffer) return null;
    return new Blob([target.buffer], { type: format.mimeType });
  } finally {
    running.delete(id);
    input.dispose();
  }
}

async function run(msg: Extract<ProxyMessage, { type: 'run' }>): Promise<void> {
  const { id, blob, shortSide, keyFrameInterval } = msg;
  try {
    const out = (await convert(id, blob, shortSide, keyFrameInterval, false)) ?? (cancelled.has(id) ? null : await convert(id, blob, shortSide, keyFrameInterval, true));
    if (cancelled.has(id)) post({ type: 'error', id, message: 'aborted', aborted: true });
    else if (!out) post({ type: 'error', id, message: 'This browser cannot make a preview copy of this video.', aborted: false });
    else post({ type: 'result', id, blob: out });
  } catch (e) {
    const aborted = cancelled.has(id) || (e instanceof Error && (e.name === 'ConversionCanceledError' || e.name === 'AbortError'));
    post({ type: 'error', id, message: aborted ? 'aborted' : e instanceof Error ? e.message : String(e), aborted });
  } finally {
    cancelled.delete(id);
  }
}

let queue: Promise<void> = Promise.resolve();

self.onmessage = (e: MessageEvent<ProxyMessage>) => {
  const msg = e.data;
  if (msg.type === 'cancel') {
    cancelled.add(msg.id);
    void running.get(msg.id)?.cancel();
  } else queue = queue.then(() => run(msg));
};
