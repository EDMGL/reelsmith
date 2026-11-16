import { describe, expect, it } from 'vitest';
import { createClipFromAsset, createProject, type MediaAsset, type Project, type VideoClip } from '../../../core';
import {
  computeTimelineSilence,
  getAudibleClips,
  lockedTracksAtRisk,
  mapSourceRangesToTimeline,
  shiftTimeAfterRemoval,
} from '../timelineSilence';

const P = { minSilenceMs: 500, paddingMs: 0, minKeepMs: 0 };
const clip = (start: number, sourceIn: number, sourceOut: number, speed = 1) => ({
  start,
  sourceIn,
  sourceOut,
  speed,
  duration: (sourceOut - sourceIn) / speed,
});
const close = (a: { start: number; end: number }[], b: [number, number][]) => {
  expect(a).toHaveLength(b.length);
  a.forEach((r, i) => {
    expect(r.start).toBeCloseTo(b[i]![0], 6);
    expect(r.end).toBeCloseTo(b[i]![1], 6);
  });
};

describe('mapSourceRangesToTimeline', () => {
  it('maps through start, trim and speed, clipped to the visible range', () => {
    const c = clip(10, 2, 8, 2); // visible 10..13
    close(mapSourceRangesToTimeline(c, [{ start: 3, end: 5 }]), [[10.5, 11.5]]);
    close(mapSourceRangesToTimeline(c, [{ start: 0, end: 3 }]), [[10, 10.5]]);
    close(mapSourceRangesToTimeline(c, [{ start: 7, end: 20 }]), [[12.5, 13]]);
    expect(mapSourceRangesToTimeline(c, [{ start: 0, end: 1.5 }])).toEqual([]);
  });

  it('handles slow motion', () => {
    const c = clip(0, 0, 2, 0.5); // 4 s on the timeline
    close(mapSourceRangesToTimeline(c, [{ start: 1, end: 2 }]), [[2, 4]]);
  });
});

describe('computeTimelineSilence', () => {
  it('silence only where EVERY overlapping audible clip is quiet', () => {
    const a = { clip: clip(0, 0, 6), activeSource: [{ start: 0, end: 2 }, { start: 4, end: 6 }] };
    const b = { clip: clip(0, 0, 6), activeSource: [{ start: 3, end: 5 }] };
    close(computeTimelineSilence([a, b], { params: P, duration: 6, includeNoAudio: false }), [[2, 3]]);
  });

  it('maps trimmed + sped-up clips before intersecting', () => {
    const a = { clip: clip(2, 4, 10, 2), activeSource: [{ start: 4, end: 6 }, { start: 8, end: 10 }] };
    // timeline: loud 2..3 and 4..5 -> silence 3..4
    close(computeTimelineSilence([a], { params: P, duration: 5, includeNoAudio: false }), [[3, 4]]);
  });

  it('does not treat gaps without audio as silence unless asked', () => {
    const a = { clip: clip(0, 0, 3), activeSource: [{ start: 0, end: 1 }] };
    const b = { clip: clip(5, 0, 3), activeSource: [{ start: 1, end: 3 }] }; // loud 6..8
    close(computeTimelineSilence([a, b], { params: P, duration: 8, includeNoAudio: false }), [
      [1, 3],
      [5, 6],
    ]);
    close(computeTimelineSilence([a, b], { params: P, duration: 8, includeNoAudio: true }), [[1, 6]]);
  });

  it('pads only edges that touch audible content', () => {
    const a = { clip: clip(0, 0, 3), activeSource: [{ start: 0, end: 1 }] };
    const b = { clip: clip(5, 0, 3), activeSource: [{ start: 1, end: 3 }] };
    close(computeTimelineSilence([a, b], { params: { ...P, paddingMs: 100 }, duration: 8, includeNoAudio: false }), [
      [1.1, 3],
      [5, 5.9],
    ]);
  });

  it('min-keep does not merge across a gap that has no audio', () => {
    const a = { clip: clip(0, 0, 3), activeSource: [{ start: 0, end: 1 }] };
    const b = { clip: clip(3.1, 0, 3), activeSource: [{ start: 1, end: 3 }] };
    const r = computeTimelineSilence([a, b], { params: { ...P, minKeepMs: 500 }, duration: 6.1, includeNoAudio: false });
    expect(r).toHaveLength(2);
  });

  it('snaps to the frame grid', () => {
    const a = { clip: clip(0, 0, 4), activeSource: [{ start: 0, end: 1.01 }, { start: 2.02, end: 4 }] };
    const r = computeTimelineSilence([a], { params: P, duration: 4, includeNoAudio: false, fps: 10 });
    close(r, [[1, 2]]);
  });
});

function asset(id: string, extra: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id,
    kind: 'video',
    name: `${id}.webm`,
    mimeType: 'video/webm',
    size: 1,
    duration: 10,
    width: 640,
    height: 360,
    hasAudio: true,
    status: 'ready',
    objectURL: `blob:${id}`,
    ...extra,
  };
}

function project(): { p: Project; v: string; a: string } {
  const base = createProject();
  const v = base.tracks.find((t) => t.kind === 'video')!.id;
  const a = base.tracks.find((t) => t.kind === 'audio')!.id;
  return { p: { ...base, assets: { x: asset('x'), mute: asset('mute', { hasAudio: false }) } }, v, a };
}

describe('audible clips and helpers', () => {
  it('excludes muted tracks, zero volume and assets without audio', () => {
    const { p, v } = project();
    const c1 = { ...(createClipFromAsset(p.assets.x!, { trackId: v, start: 0 }) as VideoClip), id: 'c1' };
    const c2 = { ...(createClipFromAsset(p.assets.mute!, { trackId: v, start: 10 }) as VideoClip), id: 'c2' };
    const c3 = { ...c1, id: 'c3', start: 20, volume: 0 };
    const proj: Project = { ...p, clips: { c1, c2, c3 } };
    expect(getAudibleClips(proj).map((c) => c.id)).toEqual(['c1']);
    const muted: Project = { ...proj, tracks: proj.tracks.map((t) => (t.id === v ? { ...t, muted: true } : t)) };
    expect(getAudibleClips(muted)).toEqual([]);
    expect(getAudibleClips(proj, ['c2', 'c3'])).toEqual([]);
  });

  it('shiftTimeAfterRemoval and lockedTracksAtRisk', () => {
    const rs = [
      { start: 1, end: 2 },
      { start: 4, end: 5 },
    ];
    expect(shiftTimeAfterRemoval(0.5, rs)).toBe(0.5);
    expect(shiftTimeAfterRemoval(1.5, rs)).toBe(1);
    expect(shiftTimeAfterRemoval(6, rs)).toBe(4);
    const { p, v } = project();
    const c1 = { ...(createClipFromAsset(p.assets.x!, { trackId: v, start: 0 }) as VideoClip), id: 'c1' };
    const locked: Project = { ...p, clips: { c1 }, tracks: p.tracks.map((t) => (t.id === v ? { ...t, locked: true } : t)) };
    expect(lockedTracksAtRisk(locked, rs)).toEqual(['Main']);
    expect(lockedTracksAtRisk({ ...p, clips: { c1 } }, rs)).toEqual([]);
  });
});
