import { beforeEach, describe, expect, it } from 'vitest';
import { createProject, createSubtitleClip, createTextClip } from '../model';
import * as ops from '../ops';
import { useEditorStore } from '../store';
import type { Clip, Project } from '../types';
import { makeAsset, videoClip, withClips } from './fixtures';

const S = () => useEditorStore.getState();

/** V (video), A (audio), T (text) tracks; clips v1 [0,4) v2 [5,7) on V, t1 [1,3) on T. */
function setup(): { project: Project; v: string; a: string; t: string } {
  const base = createProject();
  const withText = ops.addTrack({ ...base, assets: { asset1: makeAsset('asset1') } }, 'text');
  const p = withText.project;
  const v = p.tracks.find((x) => x.kind === 'video')!.id;
  const a = p.tracks.find((x) => x.kind === 'audio')!.id;
  const t = withText.trackId;
  const project = withClips(
    p,
    videoClip(p, 'v1', v, 0, 0, 4),
    videoClip(p, 'v2', v, 5, 0, 2),
    { ...createTextClip({ trackId: t, start: 1, duration: 2 }), id: 't1' },
  );
  return { project, v, a, t };
}

const clipsOn = (p: Project, trackId: string) => Object.values(p.clips).filter((c) => c.trackId === trackId).sort((x, y) => x.start - y.start);

describe('ops.copyClips / pasteClips', () => {
  it('copies a snapshot with source tracks and earliest start', () => {
    const { project, v, t } = setup();
    const c = ops.copyClips(project, ['t1', 'v2', 'nope'])!;
    expect(c.clips.map((x) => x.id)).toEqual(['t1', 'v2']);
    expect(c.start).toBe(1);
    expect(c.tracks.map((x) => x.id).sort()).toEqual([v, t].sort());
  });

  it('pastes a single clip at a time on its original track with a new id', () => {
    const { project, v } = setup();
    const c = ops.copyClips(project, ['v2'])!;
    const r = ops.pasteClips(project, c, 10)!;
    expect(r.newIds).toHaveLength(1);
    const pasted = r.project.clips[r.newIds[0]!]!;
    expect(pasted.id).not.toBe('v2');
    expect(pasted.trackId).toBe(v);
    expect(pasted.start).toBe(10);
    expect(pasted.duration).toBe(2);
  });

  it('keeps relative offsets and track relationships across tracks (multi)', () => {
    const { project, v, t } = setup();
    const c = ops.copyClips(project, ['v1', 'v2', 't1'])!;
    const r = ops.pasteClips(project, c, 20)!;
    const pasted = r.newIds.map((id) => r.project.clips[id]!);
    const byOrig = (type: string, dur: number) => pasted.find((x) => x.type === type && Math.abs(x.duration - dur) < 1e-9)!;
    expect(byOrig('video', 4).start).toBe(20);
    expect(byOrig('video', 2).start).toBe(25);
    expect(byOrig('text', 2).start).toBe(21);
    expect(byOrig('video', 4).trackId).toBe(v);
    expect(byOrig('video', 2).trackId).toBe(v);
    expect(byOrig('text', 2).trackId).toBe(t);
  });

  it('uses another compatible track or creates one when the original slot is taken', () => {
    const { project, v } = setup();
    const c = ops.copyClips(project, ['v1'])!;
    // At time 0 the V track is occupied -> a new video track is created next to it.
    const r = ops.pasteClips(project, c, 0)!;
    const pasted = r.project.clips[r.newIds[0]!]!;
    expect(pasted.trackId).not.toBe(v);
    const track = r.project.tracks.find((x) => x.id === pasted.trackId)!;
    expect(track.kind).toBe('video');
    expect(r.project.tracks.length).toBe(project.tracks.length + 1);
    // A second paste at the same time uses yet another new track: paste never silently fails.
    const r2 = ops.pasteClips(r.project, c, 0)!;
    expect(r2.newIds).toHaveLength(1);
    expect(r2.project.tracks.length).toBe(project.tracks.length + 2);
  });

  it('prefers an existing free compatible track over creating one', () => {
    const { project } = setup();
    const extra = ops.addTrack(project, 'video');
    const c = ops.copyClips(extra.project, ['v1'])!;
    const r = ops.pasteClips(extra.project, c, 0)!;
    expect(r.project.clips[r.newIds[0]!]!.trackId).toBe(extra.trackId);
    expect(r.project.tracks.length).toBe(extra.project.tracks.length);
  });

  it('recreates the track when the source track was deleted', () => {
    const { project, t } = setup();
    const c = ops.copyClips(project, ['t1'])!;
    const without = ops.removeTrack(project, t)!;
    const r = ops.pasteClips(without, c, 0)!;
    const pasted = r.project.clips[r.newIds[0]!]!;
    expect(r.project.tracks.find((x) => x.id === pasted.trackId)!.kind).toBe('text');
  });

  it('"paste here" targets the given compatible track', () => {
    const { project } = setup();
    const extra = ops.addTrack(project, 'overlay');
    const c = ops.copyClips(extra.project, ['t1'])!;
    const r = ops.pasteClips(extra.project, c, 4, { trackId: extra.trackId })!;
    expect(r.project.clips[r.newIds[0]!]!.trackId).toBe(extra.trackId);
  });

  it('gives pasted clips new effect ids', () => {
    const { project } = setup();
    const p = ops.updateClip(project, 'v2', { effects: [{ id: 'fx1', effectType: 'blur', params: {}, enabled: true }] })!;
    const c = ops.copyClips(p, ['v2'])!;
    const r = ops.pasteClips(p, c, 10)!;
    expect(r.project.clips[r.newIds[0]!]!.effects[0]!.id).not.toBe('fx1');
  });

  it('handles subtitle clips (500 in one paste)', () => {
    const base = createProject();
    const sub = ops.addTrack(base, 'subtitle');
    let p = sub.project;
    const clips: Clip[] = [];
    for (let i = 0; i < 500; i++) clips.push({ ...createSubtitleClip({ trackId: sub.trackId, start: i, duration: 0.9, text: `c${i}` }), id: `s${i}` });
    p = { ...p, clips: Object.fromEntries(clips.map((c) => [c.id, c])) };
    const c = ops.copyClips(p, clips.map((x) => x.id))!;
    const r = ops.pasteClips(p, c, 600)!;
    expect(r.newIds).toHaveLength(500);
    expect(clipsOn(r.project, sub.trackId)).toHaveLength(1000);
  });
});

describe('store clipboard actions', () => {
  beforeEach(() => {
    const { project } = setup();
    S().loadProject(project);
    useEditorStore.setState({ clipboard: null });
  });

  it('copy + paste at the playhead selects the new clips; one undo step; redo works', () => {
    S().selectClips(['v2', 't1']);
    expect(S().copyClips()).toBe(2);
    S().setCurrentTime(30);
    const past = S().past.length;
    const ids = S().pasteClips();
    expect(ids).toHaveLength(2);
    expect(S().selectedClipIds).toEqual(ids);
    expect(Math.min(...ids.map((id) => S().project.clips[id]!.start))).toBe(30);
    expect(S().past.length).toBe(past + 1);
    S().undo();
    expect(ids.every((id) => !S().project.clips[id])).toBe(true);
    S().redo();
    expect(ids.every((id) => S().project.clips[id])).toBe(true);
  });

  it('repeated paste creates independent copies', () => {
    S().copyClips(['v2']);
    S().setCurrentTime(10);
    const a = S().pasteClips();
    S().setCurrentTime(13);
    const b = S().pasteClips();
    const c = S().pasteClips(); // same spot again -> another track
    expect(new Set([...a, ...b, ...c]).size).toBe(3);
    expect(Object.keys(S().project.clips)).toHaveLength(6);
  });

  it('cut = copy + remove in ONE undo step, then paste', () => {
    const past = S().past.length;
    expect(S().cutClips(['v2'])).toBe(1);
    expect(S().project.clips.v2).toBeUndefined();
    expect(S().past.length).toBe(past + 1);
    S().setCurrentTime(8);
    const [id] = S().pasteClips();
    expect(S().project.clips[id!]!.start).toBe(8);
    S().undo();
    S().undo();
    expect(S().project.clips.v2).toBeDefined();
  });

  it('ripple cut closes the gap on the clip track', () => {
    S().cutClips(['v1'], { ripple: true });
    expect(S().project.clips.v2!.start).toBe(1);
    expect(S().project.clips.t1!.start).toBe(1); // other tracks untouched
    expect(S().clipboard!.clips.map((c) => c.id)).toEqual(['v1']);
  });

  it('cut skips locked clips; paste with an empty clipboard is a no-op', () => {
    const v = S().project.clips.v1!.trackId;
    S().updateTrack(v, { locked: true });
    expect(S().cutClips(['v1'])).toBe(0);
    expect(S().project.clips.v1).toBeDefined();
    useEditorStore.setState({ clipboard: null });
    const past = S().past.length;
    expect(S().pasteClips()).toEqual([]);
    expect(S().past.length).toBe(past);
  });
});

describe('store hot paths', () => {
  it('setPlaybackTime only changes currentTime', () => {
    const before = S();
    S().setPlaybackTime(1.5);
    const after = S();
    expect(after.currentTime).toBe(1.5);
    for (const k of Object.keys(before) as (keyof typeof before)[]) {
      if (k !== 'currentTime') expect(after[k]).toBe(before[k]);
    }
    S().setPlaybackTime(1.5);
    expect(S()).toBe(after); // same value: no update at all
  });

  it('selectClips with an unchanged selection keeps the array identity', () => {
    const { project } = setup();
    S().loadProject(project);
    S().selectClips(['v1', 'v2']);
    const sel = S().selectedClipIds;
    S().selectClips(['v1', 'v2']);
    S().selectClips(['v1'], 'add');
    expect(S().selectedClipIds).toBe(sel);
  });

  it('updateAsset keeps history entries that do not contain the asset', () => {
    const { project } = setup();
    S().loadProject(project);
    S().moveClip('v2', 9);
    const entry = S().past[0]!;
    S().updateAsset('missing-asset', { waveform: [1] });
    expect(S().past[0]).toBe(entry);
    S().updateAsset('asset1', { waveform: [0.5] });
    expect(S().past[0]!.project.assets.asset1!.waveform).toEqual([0.5]);
    expect(S().past[0]!.project.assets.asset1).toBe(S().project.assets.asset1); // patched once, shared
  });
});
