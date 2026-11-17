/**
 * 16-bit PCM WAV encoding (pure). Generated audio is stored as WAV: every
 * browser decodes and seeks it reliably (the engine plays clips through
 * <audio> elements), and no encoder dependency is needed.
 *
 * Size: 44.1 kHz/16-bit stereo ≈ 10.6 MB per minute (mono ≈ 5.3 MB).
 */
import type { Pcm } from './synth/master';

export function encodeWav(p: Pcm, opts: { channels?: 1 | 2 } = {}): Blob {
  const src = p.channels;
  const channels = Math.max(1, Math.min(opts.channels ?? src.length, 2));
  const frames = src[0]?.length ?? 0;
  const dataSize = frames * channels * 2;
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + dataSize, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, p.sampleRate, true);
  v.setUint32(28, p.sampleRate * channels * 2, true);
  v.setUint16(32, channels * 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, dataSize, true);
  // Mono from stereo: average (the mixes are mono-compatible — no phase tricks).
  const mono = channels === 1 && src.length > 1;
  const l = src[0]!;
  const r = src[1] ?? l;
  let o = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const x = mono ? (l[i]! + r[i]!) * 0.5 : src[Math.min(c, src.length - 1)]![i]!;
      const s = Math.max(-1, Math.min(1, x));
      v.setInt16(o, s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), true);
      o += 2;
    }
  }
  return new Blob([buf], { type: 'audio/wav' });
}

/** Bytes of a WAV for this many seconds. */
export function wavBytes(seconds: number, sampleRate: number, channels: number): number {
  return 44 + Math.round(seconds * sampleRate) * channels * 2;
}
