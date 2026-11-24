import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClipFromAsset, createSubtitleClip, setEngine, useEditorStore, type AudioClip, type MediaAsset, type PlaybackEngine, type Project, type VideoClip } from '../../../core';
import { makeAsset, makeProject, videoClip, withClips } from '../../../core/__tests__/fixtures';
import { makeWorld } from '../../export/__tests__/fakes';
import { mergeDeps, mergeSelection, planMerge, subProject } from '../merge';

const S = () => useEditorStore.getState();

/** Pieces as left by silence removal: video a|b|c on V, each with its detached audio on A. */
function silenceCutProject(): { project: Project; v: string; a: string } {
  const { project, v, a } = makeProject();
  const vids = [videoClip(project, 'v1', v, 0, 0, 2), videoClip(project, 'v2', v, 2, 3, 5), videoClip(project, 'v3', v, 4, 6, 7)].map(
    (c, i): VideoClip => ({ ...c, volume: 0, audioDetached: true, detachedAudioClipId: `a${i + 1}` }),
  );
  const auds = vids.map(
    (c, i): AudioClip => ({ ...(createClipFromAsset({ ...project.assets.asset1!, kind: 'audio' }, { trackId: a, start: c.start }) as AudioClip), id: `a${i + 1}`, sourceIn: c.sourceIn, sourceOut: c.sourceOut, duration: c.duration, detachedFromClipId: c.id }),
  );
  return { project: withClips(project, ...vids, ...(auds as never[])), v, a };
}

describe('planMerge', () => {
  it('takes the selected pieces, their detached audio and every piece on the track inside the span', () => {
    const { project, v } = silenceCutProject();
    const r = planMerge(project, ['v1', 'v3']);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.clipIds.sort()).toEqual(['a1', 'a2', 'a3', 'v1', 'v2', 'v3']);
    expect(r.plan).toMatchObject({ start: 0, end: 5, trackId: v });
  });

  it('refuses without a picture clip, a single clip, or a locked track', () => {
    const { project, a } = silenceCutProject();
    expect(planMerge(project, []).ok).toBe(false);
    const solo = { ...project, clips: { v1: { ...project.clips.v1!, detachedAudioClipId: undefined } as VideoClip } };
    expect(planMerge(solo, ['v1']).ok).toBe(false);
    const audioOnly = { ...project, clips: { a1: { ...project.clips.a1!, detachedFromClipId: undefined } as AudioClip, a2: project.clips.a2! } };
    expect(planMerge(audioOnly, ['a1', 'a2'])).toMatchObject({ ok: false });
    const locked = { ...project, tracks: project.tracks.map((t) => (t.id === a ? { ...t, locked: true } : t)) };
    expect(planMerge(locked, ['v1', 'v2'])).toMatchObject({ ok: false });
  });

  it('subProject keeps only the merged clips, shifted to start at 0', () => {
    const { project } = silenceCutProject();
    const r = planMerge(project, ['v2', 'v3']);
    if (!r.ok) throw new Error(r.error);
    const sub = subProject(project, r.plan);
    expect(Object.keys(sub.clips).sort()).toEqual(['a2', 'a3', 'v2', 'v3']);
    expect(sub.clips.v2!.start).toBe(0);
    expect(sub.clips.v3!.start).toBe(2);
  });
});

describe('mergeSelection', () => {
  let subtitleId = '';
  let rendered: Project | null = null;
  let disposed = 0;

  beforeEach(() => {
    const { project } = silenceCutProject();
    S().loadProject(project);
    const st = S().addTrack('subtitle');
    const sub = createSubtitleClip({ trackId: st, start: 2.5, text: 'hello', duration: 1.5 });
    subtitleId = sub.id;
    expect(S().addClip(sub)).toBe(true);
    S().selectClips(['v1', 'v3']);
    rendered = null;
    disposed = 0;

    const world = makeWorld();
    const engine = {
      forProject(p: Project) {
        rendered = p;
        return { ...world.deps.engine, dispose: () => void disposed++ };
      },
      dispose() {},
    } as unknown as PlaybackEngine;
    setEngine(engine);
    mergeDeps.codecApi = { video: async () => true, audio: async () => true };
    mergeDeps.makeExportDeps = (e) => ({ ...world.deps, engine: e });
    mergeDeps.importFile = async (file) => {
      const asset: MediaAsset = { ...makeAsset('merged', 5), name: file.name };
      S().addAsset(asset);
      return asset.id;
    };
  });

  afterEach(() => setEngine(null));

  it('replaces the pieces with one clip over the same span and leaves subtitles untouched', async () => {
    const before = S().project;
    const subBefore = before.clips[subtitleId];
    const id = await mergeSelection();
    const p = S().project;
    expect(rendered && Object.keys(rendered.clips).sort()).toEqual(['a1', 'a2', 'a3', 'v1', 'v2', 'v3']);
    expect(disposed).toBe(1);
    for (const old of ['v1', 'v2', 'v3', 'a1', 'a2', 'a3']) expect(p.clips[old]).toBeUndefined();
    expect(p.clips[id]).toMatchObject({ type: 'video', assetId: 'merged', start: 0, duration: 5, sourceIn: 0, sourceOut: 5, volume: 1 });
    expect(p.clips[subtitleId]).toBe(subBefore);
    expect(S().selectedClipIds).toEqual([id]);
    S().undo();
    expect(Object.keys(S().project.clips).sort()).toEqual(Object.keys(before.clips).sort());
  });

  it('does not touch the timeline if the clips changed while rendering', async () => {
    mergeDeps.importFile = async () => {
      S().updateClip('v1', { name: 'renamed' });
      S().addAsset(makeAsset('merged', 5));
      return 'merged';
    };
    await expect(mergeSelection()).rejects.toThrow(/changed while merging/);
    expect(S().project.clips.v2).toBeDefined();
  });
});
