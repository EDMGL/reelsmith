import { afterEach, describe, expect, it } from 'vitest';
import {
  createClipFromAsset,
  createProject,
  createTextClip,
  registerClipRenderer,
  type Clip,
  type Project,
  type Unregister,
  type VideoClip,
} from '../../core';
import { makeAsset } from '../../core/__tests__/fixtures';
import { createEffectInstance } from '../../features/effects/definitions';
import { compositeFrame, type CompositorDeps } from '../compositor';
import { renderVideoClip } from '../videoRenderer';
import { FakeCtx } from './fakes';

const offs: Unregister[] = [];
afterEach(() => offs.splice(0).forEach((f) => f()));

/** Renderers that just draw a marker naming the clip. */
function markerRenderers() {
  offs.push(registerClipRenderer('text', (ctx, clip) => ctx.drawImage(`text:${clip.id}` as never, 0, 0)));
  offs.push(registerClipRenderer('image', (ctx, clip) => ctx.drawImage(`image:${clip.id}` as never, 0, 0)));
  offs.push(registerClipRenderer('video', (ctx, clip) => ctx.drawImage(`video:${clip.id}` as never, 0, 0)));
}

function baseProject(): { project: Project; v: string } {
  const p = createProject({ width: 1000, height: 500 });
  const v = p.tracks.find((t) => t.kind === 'video')!.id;
  const tracks = [
    ...p.tracks,
    { id: 'ov1', kind: 'overlay' as const, name: 'O1', order: 2, muted: false, locked: false, hidden: false },
    { id: 'tx', kind: 'text' as const, name: 'T', order: 3, muted: false, locked: false, hidden: false },
  ];
  return { project: { ...p, tracks, backgroundColor: '#123456', assets: { vid: makeAsset('vid', 10), img: makeAsset('img', 0, 'image') } }, v };
}

function add(p: Project, ...clips: Clip[]): Project {
  return { ...p, clips: { ...p.clips, ...Object.fromEntries(clips.map((c) => [c.id, c])) } };
}

const deps = (over: Partial<CompositorDeps> = {}): CompositorDeps => ({ frameFor: () => null, getLayer: () => null, ...over });

describe('compositeFrame', () => {
  it('draws the background first, then tracks bottom-up, mapping project px to target px', () => {
    markerRenderers();
    const { project: p0, v } = baseProject();
    const video = { ...(createClipFromAsset(p0.assets.vid!, { trackId: v, start: 0 }) as VideoClip), id: 'v1' };
    const image = { ...createClipFromAsset(p0.assets.img!, { trackId: 'ov1', start: 0 }), id: 'i1' };
    const text = { ...createTextClip({ trackId: 'tx', start: 0 }), id: 't1' };
    // Insert in scrambled order: compositing must follow track order, not insertion.
    const project = add(p0, text, image, video);
    const ctx = new FakeCtx(500, 250);
    compositeFrame(ctx.asCtx, project, 1, { width: 500, height: 250, isExport: false }, deps());

    expect(ctx.ops[0]!.op).toBe('clearRect');
    const bg = ctx.ops[1]!;
    expect(bg.op).toBe('fillRect');
    expect(bg.args).toEqual(['#123456', 0, 0, 1000, 500]);
    expect(bg.transform).toEqual([0.5, 0, 0, 0.5, 0, 0]);
    expect(ctx.draws().map((d) => d.args[0])).toEqual(['video:v1', 'image:i1', 'text:t1']);
    expect(ctx.draws().every((d) => d.transform[0] === 0.5)).toBe(true);
  });

  it('skips hidden tracks, audio clips and clip types without a renderer', () => {
    offs.push(registerClipRenderer('video', (ctx, clip) => ctx.drawImage(`video:${clip.id}` as never, 0, 0)));
    const { project: p0, v } = baseProject();
    const video = { ...(createClipFromAsset(p0.assets.vid!, { trackId: v, start: 0 }) as VideoClip), id: 'v1' };
    const over = { ...(createClipFromAsset(p0.assets.vid!, { trackId: 'ov1', start: 0 }) as VideoClip), id: 'v2' };
    const text = { ...createTextClip({ trackId: 'tx', start: 0 }), id: 't1' }; // no text renderer registered
    let project = add(p0, video, over, text);
    project = { ...project, tracks: project.tracks.map((t) => (t.id === 'ov1' ? { ...t, hidden: true } : t)) };
    const ctx = new FakeCtx();
    compositeFrame(ctx.asCtx, project, 1, { width: 100, height: 50, isExport: false }, deps());
    expect(ctx.draws().map((d) => d.args[0])).toEqual(['video:v1']);
  });

  it('applies transform opacity x fades as globalAlpha and restores it afterwards', () => {
    markerRenderers();
    const { project: p0 } = baseProject();
    const text = { ...createTextClip({ trackId: 'tx', start: 0, duration: 4 }), id: 't1', fadeIn: 1, fadeOut: 2 };
    const t2 = { ...text, transform: { ...text.transform, opacity: 0.5 } };
    const project = add(p0, t2);
    const at = (time: number) => {
      const ctx = new FakeCtx();
      compositeFrame(ctx.asCtx, project, time, { width: 100, height: 50, isExport: false }, deps());
      return { ctx, alpha: ctx.draws()[0]?.alpha };
    };
    expect(at(0.5).alpha).toBeCloseTo(0.25); // 0.5 opacity x 0.5 fade-in
    expect(at(1.5).alpha).toBeCloseTo(0.5);
    expect(at(3).alpha).toBeCloseTo(0.25); // fade-out half way
    const { ctx } = at(1.5);
    expect(ctx.globalAlpha).toBe(1);
    // Fully faded clip is not drawn at all.
    expect(at(0).alpha).toBeUndefined();
  });

  it('routes clips with effects through a layer and draws it with the filter and opacity', () => {
    markerRenderers();
    const { project: p0 } = baseProject();
    const text = {
      ...createTextClip({ trackId: 'tx', start: 0 }),
      id: 't1',
      effects: [createEffectInstance('brightness', { amount: 50 }), createEffectInstance('blur', { amount: 10 })],
    };
    const project = add(p0, { ...text, transform: { ...text.transform, opacity: 0.8 } });
    const ctx = new FakeCtx(500, 250);
    const layer = new FakeCtx(500, 250);
    compositeFrame(ctx.asCtx, project, 1, { width: 500, height: 250, isExport: true }, deps({
      getLayer: (w, h) => {
        expect([w, h]).toEqual([500, 250]);
        return { canvas: 'LAYER' as unknown as CanvasImageSource, ctx: layer.asCtx };
      },
      useFilter: true,
    }));
    // The renderer drew into the layer with the project->target mapping and full alpha.
    expect(layer.draws().map((d) => [d.args[0], d.alpha, d.transform[0]])).toEqual([['text:t1', 1, 0.5]]);
    const final = ctx.draws();
    expect(final).toHaveLength(1);
    expect(final[0]!.args[0]).toBe('LAYER');
    expect(final[0]!.alpha).toBeCloseTo(0.8);
    // Blur radius is in project px, scaled to the target (0.5).
    expect(final[0]!.filter).toBe('brightness(1.5) blur(5px)');
    expect(final[0]!.transform).toEqual([1, 0, 0, 1, 0, 0]);
    expect(ctx.filter).toBe('none');
  });

  it('bakes effects into the layer pixels on the fallback path (no ctx.filter)', () => {
    markerRenderers();
    const { project: p0 } = baseProject();
    const text = { ...createTextClip({ trackId: 'tx', start: 0 }), id: 't1', effects: [createEffectInstance('invert', { amount: 100 })] };
    const project = add(p0, text);
    const ctx = new FakeCtx(2, 1);
    const layer = new FakeCtx(2, 1);
    layer.pixels.set([255, 0, 0, 255, 10, 20, 30, 0]);
    compositeFrame(ctx.asCtx, project, 1, { width: 2, height: 1, isExport: true }, deps({
      getLayer: () => ({ canvas: 'LAYER' as unknown as CanvasImageSource, ctx: layer.asCtx }),
      useFilter: false,
    }));
    expect(ctx.draws()[0]!.filter).toBe('none');
    expect([...layer.pixels]).toEqual([0, 255, 255, 255, 10, 20, 30, 0]); // transparent pixel untouched
  });

  it('keeps compositing when a renderer throws', () => {
    const errors: string[] = [];
    offs.push(registerClipRenderer('text', () => {
      throw new Error('boom');
    }));
    offs.push(registerClipRenderer('video', (ctx, clip) => ctx.drawImage(`video:${clip.id}` as never, 0, 0)));
    const { project: p0, v } = baseProject();
    const project = add(
      p0,
      { ...(createClipFromAsset(p0.assets.vid!, { trackId: v, start: 0 }) as VideoClip), id: 'v1' },
      { ...createTextClip({ trackId: 'tx', start: 0 }), id: 't1' },
    );
    const ctx = new FakeCtx();
    compositeFrame(ctx.asCtx, project, 1, { width: 10, height: 5, isExport: false }, deps({ onRendererError: (c) => errors.push(c.id) }));
    expect(errors).toEqual(['t1']);
    expect(ctx.draws()).toHaveLength(1);
  });
});

describe('video clip renderer', () => {
  it('contain-fits the frame at the source time and applies the transform around the center', () => {
    const { project: p0, v } = baseProject(); // canvas 1000 x 500
    const clip = { ...(createClipFromAsset(p0.assets.vid!, { trackId: v, start: 2 }) as VideoClip), id: 'v1', sourceIn: 3, sourceOut: 9, speed: 2, duration: 3 };
    const clipT = { ...clip, transform: { x: 0.25, y: 0.5, scale: 2, rotation: 0, opacity: 1 } };
    const requested: number[] = [];
    const ctx = new FakeCtx();
    renderVideoClip(ctx.asCtx, clipT, 1, {
      project: p0,
      track: p0.tracks[1]!,
      canvasWidth: 1000,
      canvasHeight: 500,
      time: 3,
      isExport: false,
      getAsset: () => undefined,
      getAssetFrame: (_id, st) => {
        requested.push(st);
        return { source: 'FRAME' as unknown as CanvasImageSource, width: 400, height: 400 };
      },
    });
    expect(requested).toEqual([5]); // sourceIn 3 + 1s * 2x
    const d = ctx.draws()[0]!;
    // 400x400 contain-fit in 1000x500 = 500x500, centered at origin.
    expect(d.args).toEqual(['FRAME', -250, -250, 500, 500]);
    expect(d.transform).toEqual([2, 0, 0, 2, 250, 250]);
  });

  it('draws nothing when the frame is not decoded', () => {
    const { project: p0, v } = baseProject();
    const clip = { ...(createClipFromAsset(p0.assets.vid!, { trackId: v, start: 0 }) as VideoClip), id: 'v1' };
    const ctx = new FakeCtx();
    renderVideoClip(ctx.asCtx, clip, 0, {
      project: p0, track: p0.tracks[1]!, canvasWidth: 10, canvasHeight: 10, time: 0, isExport: true,
      getAsset: () => undefined, getAssetFrame: () => null,
    });
    expect(ctx.ops).toEqual([]);
  });
});
