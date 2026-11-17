import { describe, expect, it } from 'vitest';
import { createClipFromAsset, createTextClip, ops, type Project } from '../../../core';
import { makeAsset, makeProject, videoClip, withClips } from '../../../core/__tests__/fixtures';
import { newTrackOrder, planInsert, planMove } from '../placement';
import { visibleClips } from '../TrackRow';
import { hitTestLayout } from '../timelineView';

const ZOOM = 100; // px/s -> NEAR_SLOT_PX (100px) = 1 s

/** Tracks (display order top->bottom): V2 (video), V (video, "Main"), A (audio). Clips: a [0,4) and b [6,8) on V. */
function setup(): { p: Project; v: string; v2: string; a: string } {
  const { project, v, a } = makeProject();
  const r = ops.addTrack(project, 'video');
  const p = withClips(r.project, videoClip(r.project, 'a', v, 0, 0, 4), videoClip(r.project, 'b', v, 6, 0, 2));
  return { p, v, v2: r.trackId, a };
}

describe('planMove', () => {
  it('lands exactly where the pointer is when the slot is free', () => {
    const { p, v } = setup();
    const plan = planMove(p, { ids: ['b'], anchorId: 'b', delta: 3, hit: { time: 0, trackId: v }, zoom: ZOOM });
    expect(plan).toMatchObject({ valid: true, outcome: 'exact', newTrack: null });
    expect(plan.ghosts[0]).toMatchObject({ start: 9, trackId: v });
  });

  it('moves across compatible tracks', () => {
    const { p, v2 } = setup();
    const plan = planMove(p, { ids: ['a'], anchorId: 'a', delta: 1, hit: { time: 0, trackId: v2 }, zoom: ZOOM });
    expect(plan.ghosts[0]).toMatchObject({ start: 1, trackId: v2 });
  });

  it('ignores an incompatible hovered track (stays on its own)', () => {
    const { p, v, a } = setup();
    const plan = planMove(p, { ids: ['b'], anchorId: 'b', delta: 2, hit: { time: 0, trackId: a }, zoom: ZOOM });
    expect(plan.ghosts[0]).toMatchObject({ start: 8, trackId: v });
  });

  it('snaps to the nearest free slot when slightly overlapping', () => {
    const { p, v } = setup();
    // b at 3.5 would overlap a [0,4): nearest free start is 4 (0.5 s away < 1 s).
    const plan = planMove(p, { ids: ['b'], anchorId: 'b', delta: -2.5, hit: { time: 0, trackId: v }, zoom: ZOOM });
    expect(plan).toMatchObject({ valid: true, outcome: 'shifted' });
    expect(plan.ghosts[0]!.start).toBeCloseTo(4);
  });

  it('pushes to a new track when the nearest free slot is far', () => {
    const { p, v } = setup();
    const plan = planMove(p, { ids: ['b'], anchorId: 'b', delta: -5, hit: { time: 0, trackId: v }, zoom: ZOOM });
    expect(plan).toMatchObject({ valid: true, outcome: 'new-track' });
    expect(plan.newTrack!.kind).toBe('video');
    expect(plan.ghosts[0]).toMatchObject({ start: 1, trackId: null });
  });

  it('dragging above / below the tracks creates a new track', () => {
    const { p } = setup();
    const top = planMove(p, { ids: ['a'], anchorId: 'a', delta: 0, hit: { time: 0, zone: 'top' }, zoom: ZOOM });
    expect(top).toMatchObject({ outcome: 'new-track', newTrack: { kind: 'video', order: p.tracks.length } });
    const bottom = planMove(p, { ids: ['a'], anchorId: 'a', delta: 0, hit: { time: 0, zone: 'bottom' }, zoom: ZOOM });
    expect(bottom.newTrack).toEqual({ kind: 'video', order: 1 }); // above the single audio track
  });

  it('multi-selection keeps relative offsets and shifts tracks together', () => {
    const { p, v, v2, a } = setup();
    const au = { ...createClipFromAsset(makeAsset('m', 10, 'audio'), { trackId: a, start: 0 }), id: 'm', duration: 2, sourceOut: 2 };
    const q = withClips({ ...p, assets: { ...p.assets, m: makeAsset('m', 10, 'audio') } }, au as never);
    // a (on V) + m (on A); hovering V2 shifts V->V2 but A would map to V (incompatible) -> tracks unchanged.
    const plan = planMove(q, { ids: ['a', 'm'], anchorId: 'a', delta: 10, hit: { time: 0, trackId: v2 }, zoom: ZOOM });
    expect(plan.ghosts.map((g) => [g.clip.id, g.start, g.trackId])).toEqual([
      ['a', 10, v],
      ['m', 10, a],
    ]);
    const two = planMove(q, { ids: ['a', 'b'], anchorId: 'a', delta: 20, hit: { time: 0, trackId: v2 }, zoom: ZOOM });
    expect(two.ghosts.map((g) => [g.start, g.trackId])).toEqual([
      [20, v2],
      [26, v2],
    ]);
  });

  it('never moves locked clips', () => {
    const { p, v } = setup();
    const locked = ops.updateTrack(p, v, { locked: true })!;
    expect(planMove(locked, { ids: ['a'], anchorId: 'a', delta: 1, hit: { time: 0, trackId: v }, zoom: ZOOM }).valid).toBe(false);
  });
});

describe('planInsert (media / template drops)', () => {
  it('drops onto the hovered track at the time when free', () => {
    const { p, v } = setup();
    const clip = createClipFromAsset(p.assets.asset1!, { trackId: '', start: 0 });
    expect(planInsert(p, clip, { time: 10, trackId: v }, ZOOM).ghosts[0]).toMatchObject({ start: 10, trackId: v });
  });

  it('occupied slot: nearest free slot if close, else a new track next to the hovered one', () => {
    const { p, v } = setup();
    const short = { ...createClipFromAsset(p.assets.asset1!, { trackId: '', start: 0 }), duration: 1.5, sourceOut: 1.5 };
    const near = planInsert(p, short, { time: 3.6, trackId: v }, ZOOM); // [3.6,5.1) hits a [0,4)
    expect(near).toMatchObject({ outcome: 'shifted' });
    expect(near.ghosts[0]!.start).toBeCloseTo(4);
    const far = planInsert(p, createClipFromAsset(p.assets.asset1!, { trackId: '', start: 0 }), { time: 1, trackId: v }, ZOOM);
    expect(far).toMatchObject({ outcome: 'new-track', newTrack: { kind: 'video', order: 2 } });
  });

  it('incompatible hovered track: goes to the nearest compatible track', () => {
    const { p, a, v } = setup();
    const text = createTextClip({ trackId: '', start: 0 });
    const plan = planInsert(p, text, { time: 1, trackId: a }, ZOOM);
    expect(plan).toMatchObject({ outcome: 'new-track', newTrack: { kind: 'text' } }); // no text track yet
    const audio = createClipFromAsset(makeAsset('m', 3, 'audio'), { trackId: '', start: 0 });
    expect(planInsert(p, audio, { time: 1, trackId: v }, ZOOM).ghosts[0]).toMatchObject({ trackId: a, start: 1 });
  });

  it('empty area above / below the tracks creates a suitable new track', () => {
    const { p } = setup();
    const clip = createClipFromAsset(p.assets.asset1!, { trackId: '', start: 0 });
    expect(planInsert(p, clip, { time: 2, zone: 'top' }, ZOOM).newTrack).toEqual({ kind: 'video', order: 3 });
    const audio = createClipFromAsset(makeAsset('m', 3, 'audio'), { trackId: '', start: 0 });
    expect(planInsert(p, audio, { time: 2, zone: 'bottom' }, ZOOM).newTrack).toEqual({ kind: 'audio', order: 0 });
  });
});

describe('helpers', () => {
  it('newTrackOrder keeps audio tracks at the low end', () => {
    const { p, v, a } = setup();
    const V = p.tracks.find((t) => t.id === v)!;
    const A = p.tracks.find((t) => t.id === a)!;
    expect(newTrackOrder(p, 'video', V)).toBe(V.order + 1);
    expect(newTrackOrder(p, 'audio', A)).toBe(A.order);
    expect(newTrackOrder(p, 'audio', V)).toBe(1);
    expect(newTrackOrder(p, 'video', A)).toBe(1);
  });

  it('hitTestLayout maps y to a track or the new-track zones', () => {
    const layout = [
      { trackId: 'x', top: 14, height: 64 },
      { trackId: 'y', top: 78, height: 48 },
    ];
    expect(hitTestLayout(layout, 5)).toEqual({ zone: 'top' });
    expect(hitTestLayout(layout, -20)).toEqual({ zone: 'top' });
    expect(hitTestLayout(layout, 20)).toEqual({ trackId: 'x' });
    expect(hitTestLayout(layout, 100)).toEqual({ trackId: 'y' });
    expect(hitTestLayout(layout, 200)).toEqual({ zone: 'bottom' });
  });

  it('visibleClips returns only the clips intersecting the window', () => {
    const list = Array.from({ length: 500 }, (_, i) => ({ ...createTextClip({ trackId: 't', start: i, duration: 0.5 }), id: `c${i}` }));
    expect(visibleClips(list, 100.2, 103).map((c) => c.id)).toEqual(['c100', 'c101', 'c102', 'c103']);
    expect(visibleClips(list, 1000, 2000)).toEqual([]);
  });
});
