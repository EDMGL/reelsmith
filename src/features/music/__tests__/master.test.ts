import { describe, expect, it } from 'vitest';
import { MUSIC_TRACKS } from '../catalogue';
import { PcmCache } from '../library';
import { integratedLoudness, limitInPlace, normalize, peak, seamJump, tileLoop, waveformPeaks, wrapTail, type Pcm } from '../synth/master';
import { duckCurve, tailSeconds } from '../synth/render';
import { encodeWav, wavBytes } from '../wav';

const fs = 8000;
function sine(seconds: number, freq: number, amp: number, channels = 2, rate = fs): Pcm {
  const n = Math.round(seconds * rate);
  return { sampleRate: rate, channels: Array.from({ length: channels }, () => Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / rate))) };
}

describe('loop wrapping and tiling', () => {
  it('folds the tail onto the start', () => {
    const p: Pcm = { sampleRate: fs, channels: [Float32Array.from([1, 2, 3, 4, 5, 6, 7])] };
    expect(Array.from(wrapTail(p, 3).channels[0]!)).toEqual([1 + 4 + 7, 2 + 5, 3 + 6]);
  });

  it('tiles a loop to an exact length', () => {
    const p: Pcm = { sampleRate: fs, channels: [Float32Array.from([1, 2, 3])] };
    expect(Array.from(tileLoop(p, 8).channels[0]!)).toEqual([1, 2, 3, 1, 2, 3, 1, 2]);
  });

  it('a loop of whole periods has no seam jump', () => {
    const p = sine(1, 100, 0.5);
    expect(seamJump(p)).toBeLessThan(0.05);
  });
});

describe('loudness and limiting', () => {
  it('measures BS.1770 loudness of a 1 kHz stereo sine', () => {
    // 997 Hz at -20 dBFS in both channels ≈ -20 LUFS.
    const p = sine(3, 997, 0.1, 2, 48000);
    expect(integratedLoudness(p)).toBeCloseTo(-20, 0);
    expect(integratedLoudness({ sampleRate: 48000, channels: [new Float32Array(48000)] })).toBe(-Infinity);
  });

  it('limits to the ceiling without hard clipping, circularly', () => {
    const p = sine(1, 50, 1.6);
    const g = limitInPlace(p, { ceiling: 0.9, circular: true });
    expect(peak(p)).toBeLessThanOrEqual(0.9 + 1e-6);
    expect(g).toBeLessThan(0.6);
    // Smooth gain: the limited sine has no large sample steps.
    let maxStep = 0;
    const ch = p.channels[0]!;
    for (let i = 1; i < ch.length; i++) maxStep = Math.max(maxStep, Math.abs(ch[i]! - ch[i - 1]!));
    expect(maxStep).toBeLessThan(0.1);
  });

  it('normalises to the loudness target under the ceiling', () => {
    const p = sine(4, 440, 0.02, 2, 44100);
    const r = normalize(p, { targetLufs: -16, ceiling: 0.891, circular: true });
    expect(r.lufs).toBeGreaterThan(-16.6);
    expect(r.lufs).toBeLessThan(-15.4);
    expect(peak(p)).toBeLessThanOrEqual(0.891 + 1e-6);
  });

  it('waveform peaks are normalised', () => {
    const w = waveformPeaks(sine(1, 10, 0.3), 100);
    expect(w.length).toBeGreaterThanOrEqual(100);
    expect(Math.max(...w)).toBe(1);
  });
});

describe('sidechain curve', () => {
  it('ducks on source hits and is periodic over the loop', () => {
    const arr = MUSIC_TRACKS.find((t) => t.id === 'electronic-night-drive-club')!.compose(701);
    const L = arr.loopSeconds;
    const seconds = L + tailSeconds(arr);
    const rate = 400;
    const curve = duckCurve(arr, 0.5, seconds, rate);
    expect(Math.min(...curve)).toBeGreaterThanOrEqual(0.5 - 1e-6);
    expect(Math.min(...curve)).toBeLessThan(0.6);
    const kick = arr.events.find((e) => e.inst === 'kick')!;
    expect(curve[Math.round((kick.t + 0.005) * rate)]!).toBeLessThan(0.7);
    for (const t of [0.1, 0.77, 1.5, 2.3]) {
      expect(curve[Math.round((t + L) * rate)]!).toBeCloseTo(curve[Math.round(t * rate)]!, 1);
    }
  });
});

describe('WAV encoding', () => {
  it('writes a valid 16-bit header and samples (stereo and mono downmix)', async () => {
    const p: Pcm = { sampleRate: 44100, channels: [Float32Array.from([0, 0.5, -1, 1]), Float32Array.from([0, -0.5, -1, 0.5])] };
    const blob = encodeWav(p);
    const v = new DataView(await blob.arrayBuffer());
    const str = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
    expect(blob.type).toBe('audio/wav');
    expect(str(0)).toBe('RIFF');
    expect(str(8)).toBe('WAVE');
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(24, true)).toBe(44100);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(16);
    expect(v.getInt16(44 + 4, true)).toBe(Math.round(0.5 * 0x7fff));
    expect(v.getInt16(44 + 6, true)).toBe(-Math.round(0.5 * 0x8000));
    expect(v.getInt16(44 + 8, true)).toBe(-0x8000);
    const mono = new DataView(await encodeWav(p, { channels: 1 }).arrayBuffer());
    expect(mono.getUint16(22, true)).toBe(1);
    expect(mono.getInt16(44 + 2, true)).toBe(0); // (0.5 + -0.5) / 2
    expect(mono.getInt16(44 + 6, true)).toBe(Math.round(0.75 * 0x7fff));
    expect(wavBytes(60, 44100, 2)).toBe(44 + 44100 * 60 * 4);
  });
});

describe('PCM cache', () => {
  it('evicts least recently used entries beyond the byte budget', () => {
    const mk = (n: number): Pcm => ({ sampleRate: fs, channels: [new Float32Array(n)] });
    const c = new PcmCache(4 * 250);
    c.set('a', mk(100));
    c.set('b', mk(100));
    c.get('a');
    c.set('c', mk(100));
    expect(c.has('a')).toBe(true);
    expect(c.has('b')).toBe(false);
    expect(c.has('c')).toBe(true);
    expect(c.totalBytes).toBe(800);
  });
});
