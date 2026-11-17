/// <reference lib="webworker" />
/** Runs the (CPU-heavy) loudness normalisation + limiter off the main thread. */
import { normalize, type NormalizeOptions } from './master';

interface Req {
  id: number;
  sampleRate: number;
  channels: Float32Array[];
  opts: NormalizeOptions;
}

self.onmessage = (e: MessageEvent<Req>) => {
  const { id, sampleRate, channels, opts } = e.data;
  const pcm = { sampleRate, channels };
  const r = normalize(pcm, opts);
  (self as unknown as Worker).postMessage({ id, channels: pcm.channels, ...r }, pcm.channels.map((c) => c.buffer as ArrayBuffer));
};
