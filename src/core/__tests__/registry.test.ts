import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTextClip, createProject } from '../model';
import {
  getClipRenderer,
  getInspectorsFor,
  panelRegistry,
  registerClipRenderer,
  registerInspector,
  registerPanel,
  registerTimelineOverlay,
  registerToolbarAction,
  resetRegistries,
  timelineOverlayRegistry,
  toolbarRegistry,
  type RenderEnv,
} from '../registry';
import { drawClip } from '../render';
import { getEngine, setEngine, type PlaybackEngine } from '../engine';

afterEach(() => resetRegistries());

const Dummy = () => null;

describe('registries', () => {
  it('registers and looks up clip renderers; unregister removes', () => {
    const r = vi.fn();
    const off = registerClipRenderer('text', r);
    expect(getClipRenderer('text')).toBe(r);
    expect(getClipRenderer('image')).toBeUndefined();
    off();
    expect(getClipRenderer('text')).toBeUndefined();
  });

  it('drawClip calls the renderer with local time and fade/opacity applied', () => {
    const calls: [number, number][] = [];
    registerClipRenderer('text', (ctx, _clip, localTime) => calls.push([localTime, ctx.globalAlpha]));
    const project = createProject();
    const clip = { ...createTextClip({ trackId: 't', start: 2, duration: 4 }), fadeIn: 1 };
    const ctx = { globalAlpha: 1, save: vi.fn(), restore: vi.fn() } as unknown as CanvasRenderingContext2D;
    const env: RenderEnv = {
      project,
      track: project.tracks[0]!,
      canvasWidth: 100,
      canvasHeight: 100,
      time: 2.5,
      isExport: false,
      getAsset: () => undefined,
      getAssetFrame: () => null,
    };
    expect(drawClip(ctx, clip, env)).toBe(true);
    expect(calls[0]![0]).toBeCloseTo(0.5);
    expect(calls[0]![1]).toBeCloseTo(0.5);
    expect(drawClip(ctx, clip, { ...env, time: 7 })).toBe(false);
  });

  it('orders panels by order then insertion, replaces same id', () => {
    registerPanel({ id: 'b', title: 'B', component: Dummy, order: 10 });
    registerPanel({ id: 'a', title: 'A', component: Dummy, order: 10 });
    registerPanel({ id: 'm', title: 'Media', component: Dummy, order: 0 });
    expect(panelRegistry.list().map((p) => p.id)).toEqual(['m', 'b', 'a']);
    registerPanel({ id: 'b', title: 'B2', component: Dummy, order: 10 });
    expect(panelRegistry.get('b')!.title).toBe('B2');
    expect(panelRegistry.list()).toHaveLength(3);
  });

  it('notifies subscribers', () => {
    const l = vi.fn();
    const unsub = panelRegistry.subscribe(l);
    registerPanel({ id: 'x', title: 'X', component: Dummy });
    expect(l).toHaveBeenCalledTimes(1);
    unsub();
  });

  it('inspectors match by clip type, array or wildcard', () => {
    registerInspector('text', Dummy, { title: 'Text', order: 10 });
    registerInspector(['video', 'image'], Dummy, { id: 'fx', title: 'Effects', order: 50 });
    registerInspector('*', Dummy, { id: 'all', title: 'All', order: 0 });
    expect(getInspectorsFor('text').map((d) => d.title)).toEqual(['All', 'Text']);
    expect(getInspectorsFor('image').map((d) => d.id)).toEqual(['all', 'fx']);
    expect(getInspectorsFor('audio').map((d) => d.id)).toEqual(['all']);
  });

  it('toolbar actions and timeline overlays', () => {
    registerToolbarAction({ id: 'export', location: 'topbar', label: 'Export', variant: 'primary', run: () => {} });
    registerToolbarAction({ id: 'silence', location: 'timeline', label: 'Remove silence' });
    expect(toolbarRegistry.list().filter((a) => a.location === 'topbar').map((a) => a.id)).toEqual(['export']);
    registerTimelineOverlay(Dummy, { id: 'silence' });
    expect(timelineOverlayRegistry.get('silence')).toBeDefined();
  });

  it('engine provider set/get disposes previous', () => {
    const mk = (): PlaybackEngine => ({
      play: vi.fn(),
      pause: vi.fn(),
      seek: vi.fn(),
      renderFrame: vi.fn(async () => {}),
      mixAudio: vi.fn(),
      dispose: vi.fn(),
    });
    const e1 = mk();
    const e2 = mk();
    setEngine(e1);
    expect(getEngine()).toBe(e1);
    setEngine(e2);
    expect(e1.dispose).toHaveBeenCalled();
    expect(getEngine()).toBe(e2);
    setEngine(null);
    expect(getEngine()).toBeNull();
  });
});
