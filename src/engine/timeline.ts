/**
 * Pure timeline queries used by the engine: which clips are visible/audible at
 * a time, which media elements are needed, and source-time mapping.
 */
import {
  clipContainsTime,
  clipSourceTime,
  getActiveClipsAt,
  getProjectIndex,
  getTrackClipsStartingIn,
  isMediaClip,
  type Clip,
  type MediaClip,
  type Project,
  type Track,
} from '../core';

/** Lowest/highest playbackRate media elements reliably accept. */
export const MIN_ELEMENT_RATE = 0.0625;
export const MAX_ELEMENT_RATE = 16;

export function elementRate(speed: number): number {
  if (!Number.isFinite(speed) || speed <= 0) return 1;
  return Math.min(MAX_ELEMENT_RATE, Math.max(MIN_ELEMENT_RATE, speed));
}

/** Source (file) time of a media clip for project time `t` (clamped into [sourceIn, sourceOut]). */
export function sourceTimeAt(clip: MediaClip, t: number): number {
  return clipSourceTime(clip, t);
}

/**
 * Visible clips at `t` in compositing order (bottom track first), skipping
 * hidden tracks and audio clips (which have no picture).
 */
export function visibleClipsAt(project: Project, t: number): { clip: Clip; track: Track }[] {
  const out = getActiveClipsAt(project, t);
  // Usually nothing to drop: filter in place instead of allocating a second array.
  let n = 0;
  for (const e of out) if (e.clip.type !== 'audio') out[n++] = e;
  out.length = n;
  return out;
}

/** Whether a clip's media is audible on its track (not muted, has volume, has audio). */
export function isAudible(project: Project, clip: MediaClip, track: Track): boolean {
  if (track.muted || !(clip.volume > 0)) return false;
  // A video file without an audio track is silent, whether it is used by a
  // video clip or by an audio clip referencing it (detached audio).
  const asset = project.assets[clip.assetId];
  if (asset && asset.kind === 'video' && !asset.hasAudio) return false;
  return true;
}

export interface MediaNeed {
  clip: MediaClip;
  track: Track;
  /** Picture is drawn (video clip on a visible track). */
  video: boolean;
  /** Sound is heard. */
  audio: boolean;
}

/**
 * Media clips (video/audio) that need an element at time `t`: video clips on
 * visible tracks (picture) and audible clips on any track (a video on a
 * hidden but unmuted track still plays its sound).
 */
export function mediaNeedsAt(project: Project, t: number): MediaNeed[] {
  const out: MediaNeed[] = [];
  for (const { clip, track } of getActiveClipsAt(project, t, true)) {
    if (!isMediaClip(clip)) continue;
    const asset = project.assets[clip.assetId];
    if (!asset || asset.status !== 'ready') continue;
    const video = clip.type === 'video' && !track.hidden;
    const audio = isAudible(project, clip, track);
    if (video || audio) out.push({ clip, track, video, audio });
  }
  return out;
}

/**
 * Clips (any type with an asset) starting within `(t, t + window]`, for
 * preloading. Includes media clips on hidden tracks only if audible.
 */
export function upcomingClips(project: Project, t: number, window: number): { clip: Clip; track: Track }[] {
  const out: { clip: Clip; track: Track }[] = [];
  for (const track of getProjectIndex(project).sortedTracks) {
    for (const clip of getTrackClipsStartingIn(project, track.id, t, t + window)) {
      if (clip.type === 'video' || clip.type === 'image' || clip.type === 'audio') {
        if (track.hidden && !(isMediaClip(clip) && isAudible(project, clip, track))) continue;
        out.push({ clip, track });
      }
    }
  }
  return out;
}

/** True if a clip covers `t` (re-export for convenience in the engine). */
export const covers = clipContainsTime;
