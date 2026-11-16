import { beforeEach, describe, expect, it } from 'vitest';
import { createClipFromAsset, createProject, drawPicture, motionAt, useEditorStore, type Project, type VideoClip } from '../../../core';
import { makeAsset } from '../../../core/__tests__/fixtures';
import { FakeContext } from '../../text/__tests__/fakeCanvas';
import { alternatePunchIn, motionFor, pictureClipAt, punchInAtPlayhead, setMotionPreset } from '../motion';

const S = () => useEditorStore.getState();

describe('motionAt', () => {
  const m = (preset: Parameters<typeof motionFor>[0], extra = {}) => ({ ...motionFor(preset), amount: 1.5, ...extra });

  it('zoom in eases from 1 to amount over the clip (or `duration`), zoom out the reverse', () => {
    expect(motionAt(m('zoom-in'), 0, 4).zoom).toBe(1);
    expect(motionAt(m('zoom-in'), 2, 4).zoom).toBeCloseTo(1.25);
    expect(motionAt(m('zoom-in'), 4, 4).zoom).toBeCloseTo(1.5);
    expect(motionAt(m('zoom-in', { duration: 1 }), 2, 4).zoom).toBeCloseTo(1.5); // done after 1 s
    expect(motionAt(m('zoom-out'), 0, 4).zoom).toBeCloseTo(1.5);
    expect(motionAt(m('zoom-out'), 4, 4).zoom).toBeCloseTo(1);
  });

  it('punch-in is constant; pans sweep the zoom center', () => {
    expect(motionAt(m('punch-in'), 0, 4).zoom).toBe(1.5);
    expect(motionAt(m('punch-in'), 3, 4).zoom).toBe(1.5);
    expect(motionAt(m('pan-left'), 0, 4).fx).toBeCloseTo(0.8);
    expect(motionAt(m('pan-left'), 4, 4).fx).toBeCloseTo(0.2);
    expect(motionAt(m('pan-right'), 0, 4).fx).toBeCloseTo(0.2);
    expect(motionAt(undefined, 1, 4)).toEqual({ zoom: 1, fx: 0.5, fy: 0.5 });
    expect(motionAt({ ...m('punch-in'), amount: 0.5 }, 0, 4).zoom).toBe(1); // never zooms out of the frame
  });
});

describe('drawPicture', () => {
  const base = { transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 }, duration: 4 };
  const src = {} as CanvasImageSource;

  it('zooms around the focus point: that point stays where it was', () => {
    const ctx = new FakeContext();
    drawPicture(ctx.asCanvas(), { ...base, motion: { ...motionFor('punch-in'), amount: 2, focusX: 0.75, focusY: 0.5 } }, 0, src, 100, 100, 100, 100);
    const d = ctx.ops('drawImage')[0]!;
    const m = d.matrix;
    // focus point in content coords (25, 0) -> canvas (75, 50) both before and after the zoom
    expect(m.a * 25 + m.c * 0 + m.e).toBeCloseTo(75);
    expect(m.b * 25 + m.d * 0 + m.f).toBeCloseTo(50);
    expect(m.a).toBeCloseTo(2);
  });

  it('circle shape clips and draws an outline; plain clips do not', () => {
    const ctx = new FakeContext();
    drawPicture(ctx.asCanvas(), { ...base, shape: { kind: 'circle', radius: 0, border: 6, borderColor: '#fff' } }, 0, src, 160, 90, 100, 100);
    expect(ctx.ops('clip')).toHaveLength(1);
    expect(ctx.ops('stroke')).toHaveLength(1);
    const plain = new FakeContext();
    drawPicture(plain.asCanvas(), base, 0, src, 160, 90, 100, 100);
    expect(plain.ops('clip')).toHaveLength(0);
    expect(plain.ops('drawImage')[0]!.matrix.a).toBeCloseTo(1);
  });
});

describe('motion actions', () => {
  function project(): Project {
    const base = createProject();
    const v = base.tracks.find((t) => t.kind === 'video')!.id;
    const vid = makeAsset('vid', 30);
    const piece = (id: string, start: number): VideoClip => ({ ...(createClipFromAsset(vid, { trackId: v, start }) as VideoClip), id, duration: 2, sourceIn: start, sourceOut: start + 2 });
    return { ...base, assets: { vid }, clips: { a: piece('a', 0), b: piece('b', 2), c: piece('c', 4), d: piece('d', 6) } };
  }
  beforeEach(() => S().loadProject(project()));

  it('alternatePunchIn: wide, close, wide, close in time order, one undo step', () => {
    const past = S().past.length;
    expect(alternatePunchIn(['d', 'b', 'a', 'c'], 1.3)).toBe(4);
    const presets = ['a', 'b', 'c', 'd'].map((id) => (S().project.clips[id] as VideoClip).motion);
    expect(presets.map((x) => x?.preset)).toEqual(['none', 'punch-in', 'none', 'punch-in']);
    expect(presets[1]!.amount).toBe(1.3);
    expect(S().past.length).toBe(past + 1);
  });

  it('setMotionPreset keeps focus, sets a default amount', () => {
    setMotionPreset(['a'], 'zoom-in');
    const m = (S().project.clips.a as VideoClip).motion!;
    expect(m).toMatchObject({ preset: 'zoom-in', amount: 1.15, focusX: 0.5, focusY: 0.42 });
  });

  it('punchInAtPlayhead splits the clip under the playhead and zooms the right part', () => {
    S().setCurrentTime(3);
    expect(pictureClipAt(3)!.id).toBe('b');
    const id = punchInAtPlayhead(1.25)!;
    const right = S().project.clips[id] as VideoClip;
    expect(right.start).toBeCloseTo(3);
    expect(right.motion).toMatchObject({ preset: 'punch-in', amount: 1.25 });
    expect((S().project.clips.b as VideoClip).duration).toBeCloseTo(1);
    expect((S().project.clips.b as VideoClip).motion?.preset ?? 'none').toBe('none');
    expect(S().selectedClipIds).toEqual([id]);
    S().undo();
    expect(Object.keys(S().project.clips)).toHaveLength(4);
  });
});
