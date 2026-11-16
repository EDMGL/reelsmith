import { describe, expect, it } from 'vitest';
import { createTextClip, getTrackClips } from '../model';
import * as ops from '../ops';
import type { MediaClip } from '../types';
import { makeProject, videoClip, withClips } from './fixtures';

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe('splitClip', () => {
  it('splits a media clip into two adjacent parts with correct source ranges', () => {
    const { project, v } = makeProject();
    const p = withClips(project, videoClip(project, 'c1', v, 2, 1, 5)); // timeline 2..6, source 1..5
    const r = ops.splitClip(p, 'c1', 3.5)!;
    expect(r).not.toBeNull();
    const left = r.project.clips.c1 as MediaClip;
    const right = r.project.clips[r.newClipId] as MediaClip;
    close(left.start, 2);
    close(left.duration, 1.5);
    close(left.sourceIn, 1);
    close(left.sourceOut, 2.5);
    close(right.start, 3.5);
    close(right.duration, 2.5);
    close(right.sourceIn, 2.5);
    close(right.sourceOut, 5);
  });

  it('respects speed when computing source ranges', () => {
    const { project, v } = makeProject();
    const c = { ...videoClip(project, 'c1', v, 0, 0, 8), speed: 2, duration: 4 };
    const r = ops.splitClip(withClips(project, c), 'c1', 1)!;
    close((r.project.clips.c1 as MediaClip).sourceOut, 2);
    close((r.project.clips[r.newClipId] as MediaClip).sourceIn, 2);
  });

  it('rejects splits at or outside the edges, and on locked tracks', () => {
    const { project, v } = makeProject();
    const p = withClips(project, videoClip(project, 'c1', v, 2, 0, 4));
    expect(ops.splitClip(p, 'c1', 2)).toBeNull();
    expect(ops.splitClip(p, 'c1', 6)).toBeNull();
    expect(ops.splitClip(p, 'c1', 7)).toBeNull();
    const locked = ops.updateTrack(p, v, { locked: true })!;
    expect(ops.splitClip(locked, 'c1', 3)).toBeNull();
  });

  it('keeps fade-in on the left part and fade-out on the right part', () => {
    const { project, v } = makeProject();
    const p = withClips(project, { ...videoClip(project, 'c1', v, 0, 0, 4), fadeIn: 1, fadeOut: 1 });
    const r = ops.splitClip(p, 'c1', 2)!;
    expect(r.project.clips.c1!.fadeIn).toBe(1);
    expect(r.project.clips.c1!.fadeOut).toBe(0);
    expect(r.project.clips[r.newClipId]!.fadeIn).toBe(0);
    expect(r.project.clips[r.newClipId]!.fadeOut).toBe(1);
  });
});

describe('trimClip', () => {
  it('clamps the start edge to the source beginning', () => {
    const { project, v } = makeProject();
    const p = withClips(project, videoClip(project, 'c1', v, 5, 2, 6)); // can extend left by 2s max
    const r = ops.trimClip(p, 'c1', 'start', 0)!;
    const c = r.clips.c1 as MediaClip;
    close(c.start, 3);
    close(c.sourceIn, 0);
    close(c.duration, 6);
  });

  it('clamps the end edge to the asset duration (10s)', () => {
    const { project, v } = makeProject();
    const p = withClips(project, videoClip(project, 'c1', v, 0, 2, 6));
    const c = ops.trimClip(p, 'c1', 'end', 50)!.clips.c1 as MediaClip;
    close(c.sourceOut, 10);
    close(c.duration, 8);
  });

  it('clamps to neighbouring clips and to a minimum of one frame', () => {
    const { project, v } = makeProject();
    const p = withClips(project, videoClip(project, 'a', v, 0, 0, 2), videoClip(project, 'b', v, 3, 0, 2));
    close(ops.trimClip(p, 'a', 'end', 4)!.clips.a!.duration, 3); // stops at b.start = 3
    expect(ops.trimClip(p, 'b', 'start', 0)).toBeNull(); // b sourceIn = 0 -> can't extend left: no-op
    const tiny = ops.trimClip(p, 'a', 'end', -5)!.clips.a!;
    close(tiny.duration, 1 / p.fps);
  });

  it('trims a text clip without source bounds', () => {
    const { project } = makeProject();
    const { project: p1, trackId } = ops.addTrack(project, 'text');
    const p = withClips(p1, createTextClip({ trackId, start: 1, duration: 2 }));
    const id = Object.keys(p.clips)[0]!;
    close(ops.trimClip(p, id, 'end', 30)!.clips[id]!.duration, 29);
  });
});

describe('move with overlap rule (reject)', () => {
  it('moves a clip into free space', () => {
    const { project, v } = makeProject();
    const p = withClips(project, videoClip(project, 'a', v, 0), videoClip(project, 'b', v, 10));
    close(ops.moveClip(p, 'a', 5)!.clips.a!.start, 5);
  });

  it('rejects a move that would overlap another clip', () => {
    const { project, v } = makeProject();
    const p = withClips(project, videoClip(project, 'a', v, 0), videoClip(project, 'b', v, 10));
    expect(ops.moveClip(p, 'a', 8)).toBeNull(); // 8..12 overlaps 10..14
    expect(ops.moveClip(p, 'a', 6)).not.toBeNull(); // 6..10 touches, allowed
  });

  it('moves across compatible tracks and rejects incompatible ones', () => {
    const { project, v, a } = makeProject();
    const { project: p1, trackId: v2 } = ops.addTrack(project, 'video');
    const p = withClips(p1, videoClip(p1, 'a', v, 0));
    expect(ops.moveClip(p, 'a', 1, v2)!.clips.a!.trackId).toBe(v2);
    expect(ops.moveClip(p, 'a', 1, a)).toBeNull();
  });

  it('moveClips is all-or-nothing and clamps at 0', () => {
    const { project, v } = makeProject();
    const p = withClips(project, videoClip(project, 'a', v, 1), videoClip(project, 'b', v, 5), videoClip(project, 'c', v, 12));
    expect(ops.moveClips(p, ['a', 'b'], 4)).toBeNull(); // b -> 9..13 overlaps c
    const r = ops.moveClips(p, ['a', 'b'], -10)!;
    close(r.clips.a!.start, 0);
    close(r.clips.b!.start, 4);
  });

  it('rejects addClip into an occupied slot', () => {
    const { project, v } = makeProject();
    const p = withClips(project, videoClip(project, 'a', v, 0));
    expect(ops.addClip(p, videoClip(p, 'b', v, 2))).toBeNull();
    expect(ops.addClip(p, videoClip(p, 'b', v, 4))).not.toBeNull();
  });
});

describe('rippleDeleteRanges', () => {
  it('removes multiple ranges, cutting spanning clips and closing gaps', () => {
    const { project, v, a } = makeProject();
    // V: clip x 0..8 (source 0..8). A: audio y 0..10
    const x = videoClip(project, 'x', v, 0, 0, 8);
    const y = { ...videoClip(project, 'y', a, 0, 0, 10), type: 'audio' as const };
    const { transform: _t, ...audio } = y;
    const p = withClips(project, x, audio as never);
    const r = ops.rippleDeleteRanges(p, [
      { start: 6, end: 7 },
      { start: 1, end: 2 },
    ])!;
    // V: x 0..8 minus [1,2],[6,7] -> pieces [0,1],[2,6],[7,8] at 0..1, 1..5, 5..6
    const vClips = getTrackClips(r, v) as MediaClip[];
    expect(vClips.map((c) => [c.start, c.duration, c.sourceIn, c.sourceOut])).toEqual([
      [0, 1, 0, 1],
      [1, 4, 2, 6],
      [5, 1, 7, 8],
    ]);
    expect(vClips[0]!.id).toBe('x');
    const aClips = getTrackClips(r, a);
    expect(aClips).toHaveLength(3);
    close(aClips[2]!.start + aClips[2]!.duration, 8);
  });

  it('deletes clips fully inside a range and shifts later clips', () => {
    const { project, v } = makeProject();
    const p = withClips(project, videoClip(project, 'a', v, 0, 0, 2), videoClip(project, 'b', v, 3, 0, 1), videoClip(project, 'c', v, 5, 0, 2));
    const r = ops.rippleDeleteRanges(p, [{ start: 2.5, end: 4.5 }])!;
    expect(r.clips.b).toBeUndefined();
    close(r.clips.a!.start, 0);
    close(r.clips.c!.start, 3);
  });

  it('merges overlapping ranges and only touches requested tracks; skips locked', () => {
    const { project, v, a } = makeProject();
    const p0 = withClips(project, videoClip(project, 'a', v, 4, 0, 2));
    const aud = { ...videoClip(project, 'b', a, 4, 0, 2), type: 'audio' as const };
    const p = withClips(p0, aud as never);
    const r = ops.rippleDeleteRanges(p, [{ start: 0, end: 2 }, { start: 1, end: 3 }], [v])!;
    close(r.clips.a!.start, 1);
    close(r.clips.b!.start, 4);
    const locked = ops.updateTrack(p, v, { locked: true })!;
    const r2 = ops.rippleDeleteRanges(locked, [{ start: 0, end: 3 }])!;
    close(r2.clips.a!.start, 4);
    close(r2.clips.b!.start, 1);
  });

  it('returns null when nothing changes', () => {
    const { project, v } = makeProject();
    const p = withClips(project, videoClip(project, 'a', v, 0, 0, 2));
    expect(ops.rippleDeleteRanges(p, [{ start: 5, end: 6 }])).toBeNull();
    expect(ops.rippleDeleteRanges(p, [])).toBeNull();
  });
});

describe('rippleDeleteClips / duplicate / remove', () => {
  it('ripple deletes a clip on its own track only', () => {
    const { project, v } = makeProject();
    const p = withClips(project, videoClip(project, 'a', v, 0, 0, 2), videoClip(project, 'b', v, 2, 0, 3));
    const r = ops.rippleDeleteClips(p, ['a'])!;
    expect(r.clips.a).toBeUndefined();
    close(r.clips.b!.start, 0);
  });

  it('duplicates after the selection span', () => {
    const { project, v } = makeProject();
    const p = withClips(project, videoClip(project, 'a', v, 0, 0, 2));
    const r = ops.duplicateClips(p, ['a'])!;
    expect(r.newIds).toHaveLength(1);
    close(r.project.clips[r.newIds[0]!]!.start, 2);
  });

  it('removeAsset removes referencing clips', () => {
    const { project, v } = makeProject();
    const p = withClips(project, videoClip(project, 'a', v, 0));
    const r = ops.removeAsset(p, 'asset1')!;
    expect(r.assets.asset1).toBeUndefined();
    expect(r.clips.a).toBeUndefined();
  });

  it('updateClip recomputes duration when speed changes', () => {
    const { project, v } = makeProject();
    const p = withClips(project, videoClip(project, 'a', v, 0, 0, 4));
    close(ops.updateClip(p, 'a', { speed: 2 })!.clips.a!.duration, 2);
  });

  it('placeClip creates a new track when the default ones are occupied at start', () => {
    const { project, v } = makeProject();
    const p = withClips(project, videoClip(project, 'a', v, 0, 0, 4));
    const r = ops.placeClip(p, videoClip(p, 'b', '', 0), { start: 1, preferredKind: 'video' })!;
    expect(r.clip.trackId).not.toBe(v);
    expect(r.project.tracks).toHaveLength(3);
  });
});
