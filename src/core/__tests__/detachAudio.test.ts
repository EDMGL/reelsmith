import { beforeEach, describe, expect, it } from 'vitest';
import { createClipFromAsset } from '../model';
import * as ops from '../ops';
import { useEditorStore } from '../store';
import type { AudioClip, Project, VideoClip } from '../types';
import { makeAsset, makeProject, videoClip, withClips } from './fixtures';

const S = () => useEditorStore.getState();

function setup(): { project: Project; v: string; a: string } {
  const { project, v, a } = makeProject();
  const silent = { ...makeAsset('mute', 10), hasAudio: false };
  const c1 = { ...videoClip(project, 'c1', v, 0, 1, 5), speed: 2, duration: 2, fadeIn: 0.5, fadeOut: 0.25, volume: 0.7 };
  const c2 = videoClip(project, 'c2', v, 3, 0, 2);
  const c3 = { ...videoClip(project, 'c3', v, 6, 0, 2), assetId: 'mute' };
  return { project: withClips({ ...project, assets: { ...project.assets, mute: silent } }, c1, c2, c3), v, a };
}

describe('ops.detachAudio / restoreAudio', () => {
  it('creates a matching audio clip on an audio track and silences the video', () => {
    const { project, a } = setup();
    const r = ops.detachAudio(project, ['c1'])!;
    expect(r.audioIds).toHaveLength(1);
    const audio = r.project.clips[r.audioIds[0]!] as AudioClip;
    const video = r.project.clips.c1 as VideoClip;
    expect(audio).toMatchObject({
      type: 'audio',
      trackId: a,
      assetId: 'asset1',
      start: 0,
      duration: 2,
      sourceIn: 1,
      sourceOut: 5,
      speed: 2,
      fadeIn: 0.5,
      fadeOut: 0.25,
      volume: 0.7,
      detachedFromClipId: 'c1',
    });
    expect(video).toMatchObject({ volume: 0, audioDetached: true, volumeBeforeDetach: 0.7, detachedAudioClipId: audio.id });
    // Serializable.
    expect(JSON.parse(JSON.stringify(r.project.clips))).toEqual(r.project.clips);
  });

  it('is a no-op for an asset without audio, an already detached clip and non-video clips', () => {
    const { project } = setup();
    expect(ops.detachAudio(project, ['c3'])).toBeNull();
    const once = ops.detachAudio(project, ['c1'])!;
    expect(ops.detachAudio(once.project, ['c1'])).toBeNull();
    expect(ops.detachAudio(once.project, once.audioIds)).toBeNull();
  });

  it('multi-select: a busy audio range goes to a new audio track', () => {
    const { project, a } = setup();
    const p = ops.updateClip(project, 'c2', { start: 2 })!; // c1 [0,2) c2 [2,4)
    const blocker = { ...(createClipFromAsset(makeAsset('mus', 10, 'audio'), { trackId: a, start: 0 }) as AudioClip), id: 'x', duration: 1, sourceOut: 1 };
    const busy = { ...p, assets: { ...p.assets, mus: makeAsset('mus', 10, 'audio') }, clips: { ...p.clips, x: blocker } };
    const r = ops.detachAudio(busy, ['c1', 'c2', 'c3'])!;
    expect(r.audioIds).toHaveLength(2);
    const [t1, t2] = r.audioIds.map((id) => r.project.clips[id]!.trackId);
    expect(r.project.tracks.filter((t) => t.kind === 'audio')).toHaveLength(2);
    expect(t1).not.toBe(a); // c1's audio [0,2) collides with x on A -> new track
    expect([a, t1]).toContain(t2); // c2's audio [2,4) fits on an existing audio track
    expect(r.project.clips.c3).toEqual(project.clips.c3);
  });

  it('restore removes the audio clip and brings back the volume (from video or audio id)', () => {
    const { project } = setup();
    const d = ops.detachAudio(project, ['c1'])!;
    const r1 = ops.restoreAudio(d.project, ['c1'])!;
    expect(r1.clips[d.audioIds[0]!]).toBeUndefined();
    expect(r1.clips.c1).toEqual(project.clips.c1);
    const r2 = ops.restoreAudio(d.project, d.audioIds)!;
    expect(r2.clips.c1).toEqual(project.clips.c1);
  });

  it('restore keeps the audio clip while another split piece still uses it', () => {
    const { project } = setup();
    const d = ops.detachAudio(project, ['c1'])!;
    const sp = ops.splitClip(d.project, 'c1', 1)!;
    const r = ops.restoreAudio(sp.project, ['c1'])!;
    expect(r.clips[d.audioIds[0]!]).toBeDefined();
    expect((r.clips.c1 as VideoClip).volume).toBe(0.7);
    expect((r.clips[sp.newClipId] as VideoClip).audioDetached).toBe(true);
    const both = ops.restoreAudio(sp.project, ['c1', sp.newClipId])!;
    expect(both.clips[d.audioIds[0]!]).toBeUndefined();
  });

  it('copies without the partner drop the link; copies with it are remapped', () => {
    const { project } = setup();
    const d = ops.detachAudio(project, ['c1'])!;
    const alone = ops.pasteClips(d.project, ops.copyClips(d.project, ['c1'])!, 50)!;
    const copy = alone.project.clips[alone.newIds[0]!] as VideoClip;
    expect(copy.audioDetached).toBe(true);
    expect(copy.detachedAudioClipId).toBeUndefined();
    const pair = ops.pasteClips(d.project, ops.copyClips(d.project, ['c1', d.audioIds[0]!])!, 50)!;
    const v = pair.newIds.map((id) => pair.project.clips[id]!).find((c) => c.type === 'video') as VideoClip;
    const au = pair.newIds.map((id) => pair.project.clips[id]!).find((c) => c.type === 'audio') as AudioClip;
    expect(v.detachedAudioClipId).toBe(au.id);
    expect(au.detachedFromClipId).toBe(v.id);
  });
});

describe('store detach / restore', () => {
  beforeEach(() => S().loadProject(setup().project));

  it('detach and restore are single undo steps; select linked', () => {
    S().selectClips(['c1', 'c2']);
    const past = S().past.length;
    const ids = S().detachAudio();
    expect(ids).toHaveLength(2);
    expect(S().past.length).toBe(past + 1);
    S().selectClips(['c1']);
    S().selectLinkedClips();
    expect(S().selectedClipIds).toEqual(['c1', ids[0]]);
    expect(S().restoreAudio(['c1', 'c2'])).toBe(true);
    expect(S().past.length).toBe(past + 2);
    expect(ids.every((id) => !S().project.clips[id])).toBe(true);
    S().undo();
    expect(ids.every((id) => S().project.clips[id])).toBe(true);
    S().undo();
    expect(Object.keys(S().project.clips).sort()).toEqual(['c1', 'c2', 'c3']);
    expect((S().project.clips.c1 as VideoClip).volume).toBe(0.7);
  });

  it('does nothing (no history) for clips whose asset has no audio', () => {
    const past = S().past.length;
    expect(S().detachAudio(['c3'])).toEqual([]);
    expect(S().past.length).toBe(past);
  });
});
