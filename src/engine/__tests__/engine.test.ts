import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createClipFromAsset,
  createProject,
  registerClipRenderer,
  useEditorStore,
  type Project,
  type Unregister,
  type VideoClip,
} from '../../core';
import { makeAsset } from '../../core/__tests__/fixtures';
import { ErdemcutEngine, type EngineDeps } from '../engine';
import { renderVideoClip } from '../videoRenderer';
import { FakeCtx, FakeVideo, fakeElementFactory } from './fakes';

const S = () => useEditorStore.getState();
let offs: Unregister[] = [];
let engine: ErdemcutEngine | null = null;

function project(): Project {
  const p = createProject({ width: 160, height: 90 });
  const v = p.tracks.find((t) => t.kind === 'video')!.id;
  const asset = makeAsset('vid', 10);
  const base = { ...(createClipFromAsset(asset, { trackId: v, start: 0 }) as VideoClip) };
  const left: VideoClip = { ...base, id: 'left', start: 0, sourceIn: 0, sourceOut: 2, duration: 2 };
  const right: VideoClip = { ...base, id: 'right', start: 3, sourceIn: 4, sourceOut: 8, speed: 2, duration: 2 };
  return { ...p, assets: { vid: asset }, clips: { left, right } };
}

interface Frames {
  run(): void;
  pending: number;
}

function makeEngine(over: Partial<EngineDeps> = {}): { engine: ErdemcutEngine; now: { t: number }; frames: Frames } {
  const now = { t: 0 };
  const queue: (() => void)[] = [];
  const frames: Frames = {
    run: () => queue.splice(0).forEach((cb) => cb()),
    get pending() {
      return queue.length;
    },
  };
  engine = new ErdemcutEngine({
    now: () => now.t,
    requestFrame: (cb) => queue.push(cb),
    cancelFrame: () => undefined,
    createElement: fakeElementFactory,
    createLayer: () => null,
    createAudioContext: () => null,
    ...over,
  });
  return { engine, now, frames };
}

beforeEach(() => {
  FakeVideo.created = [];
  S().loadProject(project());
  offs.push(registerClipRenderer('video', renderVideoClip));
});
afterEach(() => {
  engine?.dispose();
  engine = null;
  offs.forEach((f) => f());
  offs = [];
  S().pause();
});

describe('renderFrame (export)', () => {
  it('seeks every needed video to the exact source time and awaits the frame before drawing', async () => {
    const { engine } = makeEngine();
    const ctx = new FakeCtx(160, 90);
    let resolved = false;
    const p = engine.renderFrame(3.5, ctx.asCtx, { isExport: true, width: 160, height: 90 }).then(() => (resolved = true));
    await Promise.resolve();
    expect(resolved).toBe(false);
    expect(ctx.draws()).toHaveLength(0);
    await p;
    const el = FakeVideo.created.at(-1)!;
    expect(el.currentTime).toBe(5); // right clip: sourceIn 4 + 0.5s * 2x
    expect(el.presentedTime).toBe(5);
    const draws = ctx.draws();
    expect(draws).toHaveLength(1);
    expect(draws[0]!.args[0]).toBe(el);
  });

  it('is deterministic when stepping frame by frame and re-rendering the same time', async () => {
    const { engine } = makeEngine();
    const ctx = new FakeCtx(160, 90);
    const seen: number[] = [];
    for (const t of [0, 1 / 30, 2 / 30, 2 / 30]) {
      await engine.renderFrame(t, ctx.asCtx, { isExport: true });
      const d = ctx.draws().at(-1)!;
      seen.push((d.args[0] as FakeVideo).presentedTime);
    }
    expect(seen.map((s) => Math.round(s * 300) / 300)).toEqual([0, 1 / 30, 2 / 30, 2 / 30].map((s) => Math.round(s * 300) / 300));
    // Rendering the same time again does not seek again.
    expect(FakeVideo.created[0]!.seekCount).toBe(2);
  });

  it('renders the background only in a gap and works without playback / preview', async () => {
    const { engine } = makeEngine();
    const ctx = new FakeCtx(160, 90);
    await engine.renderFrame(2.5, ctx.asCtx, { isExport: true });
    expect(ctx.draws()).toHaveLength(0);
    expect(ctx.ops.some((o) => o.op === 'fillRect')).toBe(true);
  });

  it('does not disturb preview elements (separate pool)', async () => {
    const { engine } = makeEngine();
    await engine.renderFrame(1, new FakeCtx().asCtx);
    await engine.renderFrame(3.5, new FakeCtx().asCtx, { isExport: true });
    expect(engine.previewPool.get('left')).toBeDefined();
    expect(engine.exportPool.get('right')).toBeDefined();
    expect(engine.previewPool.get('left')!.el).not.toBe(engine.exportPool.get('right')!.el);
  });
});

describe('renderFrame (preview)', () => {
  it('drops a stale render when a newer one for the same target started', async () => {
    const { engine } = makeEngine();
    const ctx = new FakeCtx();
    const a = engine.renderFrame(0.5, ctx.asCtx);
    const b = engine.renderFrame(1.0, ctx.asCtx);
    await Promise.all([a, b]);
    const draws = ctx.ops.filter((o) => o.op === 'fillRect');
    expect(draws).toHaveLength(1);
  });
});

describe('playback', () => {
  it('advances the store time from the clock and pauses at the project end', () => {
    const { now, frames } = makeEngine();
    S().setCurrentTime(4);
    S().play();
    expect(FakeVideo.created.length).toBeGreaterThan(0);
    now.t = 0.5;
    frames.run();
    expect(S().currentTime).toBeCloseTo(4.5);
    expect(S().isPlaying).toBe(true);
    now.t = 2;
    frames.run();
    expect(S().currentTime).toBe(5);
    expect(S().isPlaying).toBe(false);
    expect(frames.pending).toBe(0);
  });

  it('plays the active clip element at the clip speed from the mapped source time and pauses it on pause', () => {
    const { now, frames } = makeEngine();
    S().setCurrentTime(3.25);
    S().play();
    const el = engine!.previewPool.get('right')!.el as unknown as FakeVideo;
    expect(el.currentTime).toBeCloseTo(4.5);
    expect(el.playbackRate).toBe(2);
    expect(el.paused).toBe(false);
    now.t = 0.1;
    frames.run();
    S().pause();
    expect(el.paused).toBe(true);
  });

  it('preloads the next clip across a gap at its source in-point', () => {
    const { frames } = makeEngine();
    S().setCurrentTime(1);
    S().play();
    frames.run();
    const next = engine!.previewPool.get('right')!.el as unknown as FakeVideo;
    expect(next.paused).toBe(true);
    expect(next.currentTime).toBe(4);
  });

  it('re-syncs the clock on a user seek while playing', () => {
    const { now, frames } = makeEngine();
    S().play();
    now.t = 0.5;
    frames.run();
    S().setCurrentTime(3);
    now.t = 0.75;
    frames.run();
    expect(S().currentTime).toBeCloseTo(3.25);
  });

  it('imperative play/pause/seek mirror to the store', () => {
    const { engine } = makeEngine();
    engine.seek(1.5);
    expect(S().currentTime).toBe(1.5);
    engine.play();
    expect(S().isPlaying).toBe(true);
    expect(engine.isPlaying).toBe(true);
    engine.pause();
    expect(S().isPlaying).toBe(false);
    expect(engine.isPlaying).toBe(false);
  });
});
