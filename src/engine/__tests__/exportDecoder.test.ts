import { describe, expect, it } from 'vitest';
import { ExportDecoders, ForwardReader, type DecodedSample, type PictureCanvas, type SampleSource } from '../exportDecoder';
import { FakeVideo } from './fakes';
import { seekExact } from '../engine';
import type { MediaAsset } from '../../core';

function fakeSource(fps = 10, frames = 100) {
  const log = { opened: [] as number[], closed: new Set<number>(), made: 0, disposed: false };
  const source: SampleSource = {
    async *samples(start: number) {
      log.opened.push(start);
      for (let i = Math.floor(start * fps + 1e-6); i < frames; i++) {
        log.made++;
        const ts = i / fps;
        const s: DecodedSample = {
          timestamp: ts,
          width: 100,
          height: 50,
          draw: (ctx) => (ctx as unknown as { last: number }).last = ts,
          close: () => void log.closed.add(i),
        };
        yield s;
      }
    },
    dispose: () => void (log.disposed = true),
  };
  return { source, log };
}
const canvas = (w: number, h: number): PictureCanvas => {
  const c = { width: w, height: h, last: -1 };
  return { canvas: c as never, ctx: { clearRect() {}, drawImage() {}, set last(v: number) { c.last = v; } } as never };
};
const lastDrawn = (f: { source: unknown }) => (f.source as { last: number }).last;

describe('ForwardReader', () => {
  it('advances sequentially without reopening and closes superseded samples', async () => {
    const { source, log } = fakeSource();
    const pics: PictureCanvas[] = [];
    const r = new ForwardReader(source, (w, h) => { const c = canvas(w, h); pics.push(c); return c; });
    const seen: number[] = [];
    for (let i = 0; i < 20; i++) {
      const f = await r.frameAt(i / 30);
      seen.push((pics[0]!.canvas as unknown as { last: number }).last);
      expect(f.width).toBe(100);
    }
    expect(r.opens).toBe(1);
    expect(seen[0]).toBe(0);
    expect(seen[19]).toBeCloseTo(0.6, 5); // 19/30 = 0.633 -> frame at 0.6
    expect(pics).toHaveLength(1);
    expect(log.closed.has(0)).toBe(true);
    expect(log.closed.has(5)).toBe(true);
    r.dispose();
    expect(log.closed.size).toBeGreaterThanOrEqual(7); // current + look-ahead closed too
  });

  it('reopens on backwards seeks and large jumps', async () => {
    const { source, log } = fakeSource();
    const r = new ForwardReader(source, canvas);
    await r.frameAt(1);
    await r.frameAt(0.5);
    expect(r.opens).toBe(2);
    const f = await r.frameAt(5);
    expect(r.opens).toBe(3);
    expect(lastDrawn(f)).toBeCloseTo(5, 5);
    expect(log.opened).toEqual([1, 0.5, 5]);
  });

  it('throws instead of repeating a stale frame when the stream ended long ago', async () => {
    const { source } = fakeSource(10, 10); // 1 s of video
    const r = new ForwardReader(source, canvas);
    await r.frameAt(0.5);
    await expect(r.frameAt(1.5)).resolves.toBeDefined(); // held last frame is fine
    await expect(r.frameAt(3.5)).rejects.toThrow(/no decodable|ended/);
  });

  it('rejects after dispose', async () => {
    const { source } = fakeSource();
    const r = new ForwardReader(source, canvas);
    r.dispose();
    await expect(r.frameAt(0)).rejects.toThrow();
  });
});

describe('ExportDecoders', () => {
  const asset = { id: 'a', name: 'a.mp4' } as MediaAsset;
  it('shares the source per asset, disposes it with the last reader, and falls back on unsupported assets', async () => {
    const { source, log } = fakeSource();
    const d = new ExportDecoders(async () => source, canvas);
    const r1 = await d.reader('c1', asset);
    await d.reader('c2', asset);
    d.release('c1');
    expect(log.disposed).toBe(false);
    d.trim(new Set());
    await Promise.resolve();
    await Promise.resolve();
    expect(log.disposed).toBe(true);
    expect(r1).not.toBeNull();

    const bad = new ExportDecoders(async () => null, canvas);
    expect(await bad.reader('c', asset)).toBeNull();
    const err = new ExportDecoders(async () => { throw new Error('x'); }, canvas);
    expect(await err.reader('c', asset)).toBeNull();
  });
});

describe('seekExact', () => {
  it('retries once and throws a readable error when the seek never lands', async () => {
    const v = new FakeVideo();
    v.seekDelay = 1;
    v.readyState = 4;
    v.error = { code: 3 } as never; // seekElement returns false
    await expect(seekExact(v as unknown as HTMLMediaElement, 2, 'clip.mov')).rejects.toThrow(/clip\.mov/);
  });
  it('resolves when the seek lands', async () => {
    const v = new FakeVideo();
    await seekExact(v as unknown as HTMLMediaElement, 2, 'x');
    expect(v.presentedTime).toBe(2);
  });
});
