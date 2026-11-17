/**
 * The per-project query index (core/model.ts): indexed queries must equal the
 * naive implementations they replaced, on random projects, including hidden
 * tracks, touching/overlapping clips and boundary times; and the index must be
 * built once per project object.
 */
import { describe, expect, it } from 'vitest';
import {
  TIME_EPSILON,
  createClipFromAsset,
  createProject,
  createTextClip,
  getActiveClipsAt,
  getProjectDuration,
  getProjectIndex,
  getSortedTracks,
  getTrack,
  getTrackClips,
  getTrackClipsAt,
  getTrackClipsStartingIn,
  type Clip,
  type Project,
  type Track,
  type VideoClip,
} from '../../core';
import { makeAsset } from '../../core/__tests__/fixtures';
import { upcomingClips } from '../timeline';

// ---- naive reference implementations (the pre-index code) -------------------
const naiveSorted = (p: Project) => [...p.tracks].sort((a, b) => a.order - b.order);
const naiveTrackClips = (p: Project, id: string) =>
  Object.values(p.clips)
    .filter((c) => c.trackId === id)
    .sort((a, b) => a.start - b.start);
const contains = (c: Clip, t: number) => t >= c.start - TIME_EPSILON && t < c.start + c.duration - TIME_EPSILON;
function naiveActive(p: Project, t: number, includeHidden = false) {
  const out: { clip: Clip; track: Track }[] = [];
  for (const track of naiveSorted(p)) {
    if (track.hidden && !includeHidden) continue;
    for (const clip of naiveTrackClips(p, track.id)) if (contains(clip, t)) out.push({ clip, track });
  }
  return out;
}
function naiveUpcoming(p: Project, t: number, w: number) {
  const out: string[] = [];
  for (const track of naiveSorted(p))
    for (const clip of naiveTrackClips(p, track.id)) {
      if (clip.start <= t || clip.start > t + w) continue;
      // Media clips only; on hidden tracks only if audible (muted tracks are not).
      if (clip.type !== 'video') continue;
      if (track.hidden && track.muted) continue;
      out.push(clip.id);
    }
  return out;
}

/** Deterministic PRNG. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

function randomProject(seed: number, media = false): Project {
  const r = rng(seed);
  const p = { ...createProject(), assets: { vid: makeAsset('vid', 100) } };
  const tracks: Track[] = [];
  const nTracks = 1 + Math.floor(r() * 6);
  for (let i = 0; i < nTracks; i++) {
    // Duplicate orders on purpose: the sort must stay stable like the naive one.
    tracks.push({ id: `t${i}`, kind: media ? 'video' : 'text', name: `T${i}`, order: Math.floor(r() * 4), muted: r() < 0.3, locked: false, hidden: r() < 0.3 });
  }
  const clips: Record<string, Clip> = {};
  const nClips = Math.floor(r() * 120);
  for (let i = 0; i < nClips; i++) {
    const track = tracks[Math.floor(r() * tracks.length)]!;
    // Quantized starts/durations produce touching edges, equal starts and overlaps.
    const start = Math.round(r() * 40) / 4;
    const duration = r() < 0.1 ? 1e-7 : Math.max(0.25, Math.round(r() * 12) / 4);
    if (media) {
      const v = createClipFromAsset(p.assets.vid, { trackId: track.id, start }) as VideoClip;
      clips[`c${i}`] = { ...v, id: `c${i}`, duration, sourceIn: 0, sourceOut: duration };
    } else {
      const c = createTextClip({ trackId: track.id, start, duration });
      clips[`c${i}`] = { ...c, id: `c${i}` };
    }
  }
  return { ...p, tracks, clips };
}

const ids = (xs: { clip: Clip; track: Track }[]) => xs.map((x) => `${x.track.id}/${x.clip.id}`);

describe('project index', () => {
  it('getActiveClipsAt equals the naive scan on random projects (hidden tracks, edges, overlaps)', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const p = randomProject(seed);
      const times = [0, 0.25, 1, 2.5, 5, 9.75, 10, 12.5, 30, -1];
      for (const c of Object.values(p.clips)) times.push(c.start, c.start + c.duration, c.start - TIME_EPSILON / 2, c.start + c.duration - TIME_EPSILON / 2, c.start + c.duration - 2 * TIME_EPSILON);
      for (const t of times) {
        expect(ids(getActiveClipsAt(p, t))).toEqual(ids(naiveActive(p, t)));
        expect(ids(getActiveClipsAt(p, t, true))).toEqual(ids(naiveActive(p, t, true)));
      }
    }
  });

  it('track queries equal the naive ones and return fresh arrays', () => {
    for (let seed = 100; seed < 130; seed++) {
      const p = randomProject(seed);
      expect(getSortedTracks(p).map((t) => t.id)).toEqual(naiveSorted(p).map((t) => t.id));
      expect(getSortedTracks(p)).not.toBe(getSortedTracks(p));
      let dur = 0;
      for (const c of Object.values(p.clips)) dur = Math.max(dur, c.start + c.duration);
      expect(getProjectDuration(p)).toBe(dur);
      for (const t of [...p.tracks, { id: 'nope' } as Track]) {
        expect(getTrackClips(p, t.id).map((c) => c.id)).toEqual(naiveTrackClips(p, t.id).map((c) => c.id));
        expect(getTrack(p, t.id)).toBe(p.tracks.find((x) => x.id === t.id));
        for (const time of [0, 3.3, 7.5]) {
          expect(getTrackClipsAt(p, t.id, time).map((c) => c.id)).toEqual(naiveTrackClips(p, t.id).filter((c) => contains(c, time)).map((c) => c.id));
          expect(getTrackClipsStartingIn(p, t.id, time, time + 2.5).map((c) => c.id)).toEqual(
            naiveTrackClips(p, t.id)
              .filter((c) => c.start > time && c.start <= time + 2.5)
              .map((c) => c.id),
          );
        }
      }
      const a = getTrackClips(p, p.tracks[0]!.id);
      a.push(a[0]!); // mutating a result must not corrupt the index
      expect(getTrackClips(p, p.tracks[0]!.id).length).toBe(naiveTrackClips(p, p.tracks[0]!.id).length);
    }
  });

  it('upcomingClips (engine preload) matches the naive window scan', () => {
    for (let seed = 200; seed < 230; seed++) {
      const p = randomProject(seed, true);
      for (const t of [0, 0.25, 2, 5, 7.5]) expect(upcomingClips(p, t, 2.5).map((x) => x.clip.id)).toEqual(naiveUpcoming(p, t, 2.5));
      // Text projects preload nothing.
      expect(upcomingClips(randomProject(seed), 0, 2.5)).toEqual([]);
    }
  });

  it('is built once per project object and rebuilt for a new one', () => {
    const p = randomProject(7);
    const idx = getProjectIndex(p);
    getActiveClipsAt(p, 1);
    getTrackClips(p, p.tracks[0]!.id);
    getProjectDuration(p);
    expect(getProjectIndex(p)).toBe(idx);
    const next = { ...p, clips: { ...p.clips } };
    expect(getProjectIndex(next)).not.toBe(idx);
  });
});
