import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createClipFromAsset,
  createProject,
  getProjectDuration,
  getTrackClips,
  useEditorStore,
  type AudioClip,
  type MediaAsset,
  type Project,
  type VideoClip,
} from '../../../core';
import { silenceDeps, useSilenceStore } from '../silenceStore';
import { buildSignal, SR } from './signals';

function asset(id: string, kind: 'video' | 'audio'): MediaAsset {
  return {
    id,
    kind,
    name: `${id}`,
    mimeType: kind === 'video' ? 'video/webm' : 'audio/wav',
    size: 1,
    duration: 10,
    width: kind === 'video' ? 640 : 0,
    height: kind === 'video' ? 360 : 0,
    hasAudio: true,
    status: 'ready',
    objectURL: `blob:${id}`,
  };
}

// 10 s: tone 0-2, silence 2-4, tone 4-6, silence 6-7, tone 7-10.
const signal = buildSignal([
  { kind: 'tone', sec: 2 },
  { kind: 'silence', sec: 2 },
  { kind: 'tone', sec: 2 },
  { kind: 'silence', sec: 1 },
  { kind: 'tone', sec: 3 },
]);

function setup(): { project: Project; v: string; a: string } {
  const base = createProject({ fps: 30 });
  const v = base.tracks.find((t) => t.kind === 'video')!.id;
  const a = base.tracks.find((t) => t.kind === 'audio')!.id;
  const assets = { vid: asset('vid', 'video'), mus: asset('mus', 'audio') };
  const vc = { ...(createClipFromAsset(assets.vid, { trackId: v, start: 0 }) as VideoClip), id: 'vc' };
  // Music track is muted so only the video's audio decides; it must still be cut in sync.
  const ac = { ...(createClipFromAsset(assets.mus, { trackId: a, start: 0 }) as AudioClip), id: 'ac' };
  const project: Project = {
    ...base,
    assets,
    clips: { vc, ac },
    tracks: base.tracks.map((t) => (t.id === a ? { ...t, muted: true } : t)),
  };
  return { project, v, a };
}

describe('silence removal (real editor store)', () => {
  beforeEach(() => {
    silenceDeps.decode = vi.fn(async () => ({ samples: signal, sampleRate: SR }));
    useSilenceStore.getState().clear();
    useSilenceStore.setState({ scope: 'timeline', includeNoAudio: false, params: { ...useSilenceStore.getState().params, paddingMs: 0 } });
  });

  it('detects, removes with ONE rippleDeleteRanges call, leaves a gap-free timeline, undoes in one step', async () => {
    const { project, v, a } = setup();
    useEditorStore.getState().loadProject(project);
    useEditorStore.getState().setCurrentTime(8);

    await useSilenceStore.getState().detect();
    const st = useSilenceStore.getState();
    expect(st.error).toBeNull();
    expect(st.status).toBe('done');
    const ranges = st.result!.ranges;
    expect(ranges).toHaveLength(2);
    expect(ranges[0]!.start).toBeCloseTo(2, 1);
    expect(ranges[0]!.end).toBeCloseTo(4, 1);
    expect(ranges[1]!.start).toBeCloseTo(6, 1);
    expect(ranges[1]!.end).toBeCloseTo(7, 1);

    const real = useEditorStore.getState().rippleDeleteRanges;
    const spy = vi.fn(real);
    useEditorStore.setState({ rippleDeleteRanges: spy });
    const pastBefore = useEditorStore.getState().past.length;

    expect(useSilenceStore.getState().removeSelected()).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);

    const after = useEditorStore.getState();
    const removed = ranges.reduce((s, r) => s + r.end - r.start, 0);
    expect(getProjectDuration(after.project)).toBeCloseTo(10 - removed, 6);
    expect(after.past.length).toBe(pastBefore + 1);
    for (const trackId of [v, a]) {
      const clips = getTrackClips(after.project, trackId);
      expect(clips).toHaveLength(3);
      expect(clips[0]!.start).toBeCloseTo(0, 6);
      for (let i = 1; i < clips.length; i++) expect(clips[i]!.start).toBeCloseTo(clips[i - 1]!.start + clips[i - 1]!.duration, 6);
    }
    // Playhead at 8 s moves left by everything removed before it.
    expect(after.currentTime).toBeCloseTo(8 - removed, 6);
    expect(useSilenceStore.getState().result).toBeNull();

    after.undo();
    expect(getProjectDuration(useEditorStore.getState().project)).toBeCloseTo(10, 6);
    expect(Object.keys(useEditorStore.getState().project.clips).sort()).toEqual(['ac', 'vc']);
    useEditorStore.setState({ rippleDeleteRanges: real });
  });

  it('excluded ranges are not removed', async () => {
    useEditorStore.getState().loadProject(setup().project);
    await useSilenceStore.getState().detect();
    useSilenceStore.getState().toggleRange(0);
    const second = useSilenceStore.getState().result!.ranges[1]!;
    useSilenceStore.getState().removeSelected();
    expect(getProjectDuration(useEditorStore.getState().project)).toBeCloseTo(10 - (second.end - second.start), 6);
  });

  it('refuses to remove stale results and reports a missing selection', async () => {
    useEditorStore.getState().loadProject(setup().project);
    await useSilenceStore.getState().detect();
    useEditorStore.getState().moveClip('vc', 0.5);
    expect(useSilenceStore.getState().removeSelected()).toBe(false);

    useSilenceStore.setState({ scope: 'selection' });
    useEditorStore.getState().clearSelection();
    await useSilenceStore.getState().detect();
    expect(useSilenceStore.getState().status).toBe('error');
    expect(useSilenceStore.getState().error).toMatch(/Select a video or audio clip/);
  });
});
