import { describe, expect, it } from 'vitest';
import { createClipFromAsset, createProject, createTextClip, type AudioClip, type Project, type VideoClip } from '../../core';
import { makeAsset } from '../../core/__tests__/fixtures';
import { PlaybackClock, playbackTick } from '../clock';
import { elementRate, mediaNeedsAt, sourceTimeAt, upcomingClips, visibleClipsAt } from '../timeline';

function setup() {
  const p0 = createProject();
  const v = p0.tracks.find((t) => t.kind === 'video')!.id;
  const a = p0.tracks.find((t) => t.kind === 'audio')!.id;
  const asset = makeAsset('vid', 20);
  const audioAsset = { ...makeAsset('aud', 20, 'audio'), width: 0, height: 0 };
  const project: Project = { ...p0, assets: { vid: asset, aud: audioAsset } };
  return { project, v, a };
}

function vclip(p: Project, id: string, trackId: string, start: number, sourceIn: number, sourceOut: number, speed = 1): VideoClip {
  const c = createClipFromAsset(p.assets.vid!, { trackId, start }) as VideoClip;
  return { ...c, id, sourceIn, sourceOut, speed, duration: (sourceOut - sourceIn) / speed };
}

function with_(p: Project, ...clips: object[]): Project {
  return { ...p, clips: { ...p.clips, ...Object.fromEntries(clips.map((c) => [(c as { id: string }).id, c])) } } as Project;
}

describe('source time mapping', () => {
  it('maps project time through trim and speed, clamped to the source range', () => {
    const { project, v } = setup();
    const c = vclip(project, 'c', v, 2, 5, 9, 2); // 4s of source at 2x = 2s on the timeline
    expect(c.duration).toBe(2);
    expect(sourceTimeAt(c, 2)).toBe(5);
    expect(sourceTimeAt(c, 3)).toBe(7);
    expect(sourceTimeAt(c, 3.5)).toBe(8);
    expect(sourceTimeAt(c, 10)).toBe(9);
    expect(sourceTimeAt(c, 0)).toBe(5);
    const slow = vclip(project, 's', v, 0, 1, 2, 0.5);
    expect(slow.duration).toBe(2);
    expect(sourceTimeAt(slow, 1)).toBeCloseTo(1.5);
  });

  it('clamps element rates to what media elements accept', () => {
    expect(elementRate(1)).toBe(1);
    expect(elementRate(0.01)).toBe(0.0625);
    expect(elementRate(40)).toBe(16);
    expect(elementRate(NaN)).toBe(1);
  });
});

describe('active clip resolution', () => {
  it('resolves split clips with a gap and stacks tracks bottom-up', () => {
    const { project: p0, v } = setup();
    // Split pieces: [0,2) source 0..2, gap [2,3), [3,5) source 2..4.
    let project = with_(p0, vclip(p0, 'left', v, 0, 0, 2), vclip(p0, 'right', v, 3, 2, 4));
    const ov = { id: 'ov', kind: 'overlay' as const, name: 'Overlay', order: 5, muted: false, locked: false, hidden: false };
    project = { ...project, tracks: [...project.tracks, ov] };
    project = with_(project, { ...createTextClip({ trackId: 'ov', start: 0, duration: 10 }), id: 'title' });

    expect(visibleClipsAt(project, 1).map((x) => x.clip.id)).toEqual(['left', 'title']);
    expect(visibleClipsAt(project, 2.5).map((x) => x.clip.id)).toEqual(['title']);
    expect(visibleClipsAt(project, 3).map((x) => x.clip.id)).toEqual(['right', 'title']);
    expect(sourceTimeAt(project.clips.right as VideoClip, 3.5)).toBeCloseTo(2.5);
    // End is exclusive.
    expect(visibleClipsAt(project, 5).map((x) => x.clip.id)).toEqual(['title']);
  });

  it('skips hidden tracks for pictures but keeps their audio unless muted', () => {
    const { project: p0, v, a } = setup();
    const ac = { ...(createClipFromAsset(p0.assets.aud!, { trackId: a, start: 0 }) as AudioClip), id: 'music' };
    let project = with_(p0, vclip(p0, 'cam', v, 0, 0, 5), ac);
    expect(visibleClipsAt(project, 1).map((x) => x.clip.id)).toEqual(['cam']); // audio clips have no picture
    expect(mediaNeedsAt(project, 1).map((n) => [n.clip.id, n.video, n.audio])).toEqual([
      ['music', false, true],
      ['cam', true, true],
    ]);

    project = { ...project, tracks: project.tracks.map((t) => (t.id === v ? { ...t, hidden: true } : t)) };
    expect(visibleClipsAt(project, 1)).toEqual([]);
    expect(mediaNeedsAt(project, 1).map((n) => [n.clip.id, n.video, n.audio])).toEqual([
      ['music', false, true],
      ['cam', false, true],
    ]);

    project = { ...project, tracks: project.tracks.map((t) => ({ ...t, muted: true })) };
    expect(mediaNeedsAt(project, 1)).toEqual([]);
  });

  it('treats video without an audio stream / zero volume as silent', () => {
    const { project: p0, v } = setup();
    let project = with_(p0, { ...vclip(p0, 'cam', v, 0, 0, 5), volume: 0 });
    expect(mediaNeedsAt(project, 1)[0]).toMatchObject({ video: true, audio: false });
    project = { ...with_(p0, vclip(p0, 'cam', v, 0, 0, 5)), assets: { ...p0.assets, vid: { ...p0.assets.vid!, hasAudio: false } } };
    expect(mediaNeedsAt(project, 1)[0]).toMatchObject({ video: true, audio: false });
  });

  it('lists upcoming clips inside the preload window', () => {
    const { project: p0, v } = setup();
    const project = with_(p0, vclip(p0, 'a', v, 0, 0, 2), vclip(p0, 'b', v, 3, 2, 4), vclip(p0, 'c', v, 9, 0, 1));
    expect(upcomingClips(project, 1, 2.5).map((x) => x.clip.id)).toEqual(['b']);
    expect(upcomingClips(project, 3, 2.5).map((x) => x.clip.id)).toEqual([]);
  });
});

describe('playback clock', () => {
  it('advances with the wall clock, stops and seeks', () => {
    let now = 100;
    const clock = new PlaybackClock(() => now);
    expect(clock.time()).toBe(0);
    clock.start(2);
    now += 1.5;
    expect(clock.time()).toBeCloseTo(3.5);
    clock.seek(10);
    now += 0.5;
    expect(clock.time()).toBeCloseTo(10.5);
    clock.stop();
    now += 5;
    expect(clock.time()).toBeCloseTo(10.5);
    expect(clock.isRunning).toBe(false);
  });

  it('clamps to the project end and reports the end', () => {
    expect(playbackTick(3, 10)).toEqual({ time: 3, ended: false });
    expect(playbackTick(10.02, 10)).toEqual({ time: 10, ended: true });
    expect(playbackTick(0, 0)).toEqual({ time: 0, ended: true });
  });
});
