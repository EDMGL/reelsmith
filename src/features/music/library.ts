/**
 * Render service: renders tracks/effects on demand, de-duplicates concurrent
 * requests and keeps results in a byte-bounded LRU cache keyed by
 * (item id, variation seed[, length]).
 */
import type { MusicTrackDef, SfxDef } from './catalogue';
import { pcmLength, tileLoop, type Pcm } from './synth/master';
import { renderArrangement, renderSfx, type RenderResult } from './synth/render';

/** Cache budget for rendered PCM (Float32), bytes. */
export const CACHE_BUDGET_BYTES = 192 * 1024 * 1024;

export const libraryDeps = {
  renderMusic: (def: MusicTrackDef, seed: number, onProgress?: (f: number) => void): Promise<RenderResult> => renderArrangement(def.compose(seed), { onProgress }),
  renderSfx: (def: SfxDef, seed: number, onProgress?: (f: number) => void): Promise<RenderResult> => renderSfx(def.make(seed), seed, { onProgress }),
};

const pcmBytes = (p: Pcm) => p.channels.length * pcmLength(p) * 4;

export class PcmCache {
  private map = new Map<string, Pcm>();
  private bytes = 0;
  constructor(readonly budget: number) {}
  get(key: string): Pcm | undefined {
    const v = this.map.get(key);
    if (v) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }
  set(key: string, p: Pcm): void {
    const old = this.map.get(key);
    if (old) {
      this.bytes -= pcmBytes(old);
      this.map.delete(key);
    }
    this.map.set(key, p);
    this.bytes += pcmBytes(p);
    while (this.bytes > this.budget && this.map.size > 1) {
      const k = this.map.keys().next().value!;
      this.bytes -= pcmBytes(this.map.get(k)!);
      this.map.delete(k);
    }
  }
  has(key: string): boolean {
    return this.map.has(key);
  }
  get size(): number {
    return this.map.size;
  }
  get totalBytes(): number {
    return this.bytes;
  }
  clear(): void {
    this.map.clear();
    this.bytes = 0;
  }
}

export const pcmCache = new PcmCache(CACHE_BUDGET_BYTES);
const inflight = new Map<string, Promise<Pcm>>();
/** Last render stats per key (diagnostics / browser check). */
export const renderStats = new Map<string, { ms: number; lufs: number; peak: number }>();

export const loopKey = (id: string, seed: number) => `loop:${id}:${seed}`;
export const sfxKey = (id: string, seed: number) => `sfx:${id}:${seed}`;
export const lengthKey = (id: string, seed: number, seconds: number) => `len:${id}:${seed}:${seconds.toFixed(3)}`;

async function once(key: string, make: () => Promise<Pcm>): Promise<Pcm> {
  const hit = pcmCache.get(key);
  if (hit) return hit;
  let p = inflight.get(key);
  if (!p) {
    p = make().finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}

/** One seamless, mastered loop of a track variation. */
export function getLoop(def: MusicTrackDef, seed: number, onProgress?: (f: number) => void): Promise<Pcm> {
  const key = loopKey(def.id, seed);
  return once(key, async () => {
    const r = await libraryDeps.renderMusic(def, seed, onProgress);
    renderStats.set(key, { ms: r.ms, lufs: r.lufs, peak: r.peak });
    pcmCache.set(key, r.pcm);
    return r.pcm;
  });
}

/** The track at an exact length: the loop repeated (and cut) to `seconds`. */
export function getMusic(def: MusicTrackDef, seed: number, seconds: number, onProgress?: (f: number) => void): Promise<Pcm> {
  const key = lengthKey(def.id, seed, seconds);
  return once(key, async () => {
    const loop = await getLoop(def, seed, onProgress);
    const out = tileLoop(loop, Math.max(1, Math.round(seconds * loop.sampleRate)));
    pcmCache.set(key, out);
    return out;
  });
}

export function getSfx(def: SfxDef, seed: number, onProgress?: (f: number) => void): Promise<Pcm> {
  const key = sfxKey(def.id, seed);
  return once(key, async () => {
    const r = await libraryDeps.renderSfx(def, seed, onProgress);
    renderStats.set(key, { ms: r.ms, lufs: r.lufs, peak: r.peak });
    pcmCache.set(key, r.pcm);
    return r.pcm;
  });
}

/** Synchronous cache peek (drag & drop needs data without awaiting). */
export function peekCached(key: string): Pcm | undefined {
  return pcmCache.get(key);
}
