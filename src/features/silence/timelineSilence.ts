/**
 * Source-time -> timeline-time mapping and the whole-timeline silence rule.
 * Pure (takes a Project, returns ranges); no DOM.
 *
 * WHOLE-TIMELINE RULE
 * - An "audible clip" is a video or audio clip on an UNMUTED track whose asset
 *   is ready and has audio, with volume > 0. Hidden tracks still count (hidden
 *   only affects pictures). Video clips carry their own audio.
 * - At a time covered by at least one audible clip, the timeline is silent iff
 *   EVERY audible clip covering that time is quiet there (below threshold).
 * - Times covered by NO audible clip (empty gaps, or only images/text/muted
 *   clips) are NOT silence, unless `includeNoAudio` is set, in which case they
 *   are treated as silence (and subject to the same min-duration rule).
 * - min duration / padding / min-keep are applied in TIMELINE time to the
 *   combined result; padding is only applied to edges that touch audible
 *   content, so a silence ending at a clip boundary next to a gap is cut flush.
 * - Final ranges are snapped to the project frame grid.
 */
import {
  clipEnd,
  getProjectDuration,
  normalizeRanges,
  snapToFrame,
  type Id,
  type MediaClip,
  type Project,
  type TimeRange,
  type Track,
} from '../../core';
import { complementRanges, intersectRanges, mergeRanges, refineSilences, type SilenceParams } from './analysis';

/** Maps SOURCE-time ranges of a clip's asset to timeline ranges, clipped to the clip's visible span. */
export function mapSourceRangesToTimeline(
  clip: Pick<MediaClip, 'start' | 'duration' | 'sourceIn' | 'sourceOut' | 'speed'>,
  sourceRanges: readonly TimeRange[],
): TimeRange[] {
  const speed = clip.speed > 0 ? clip.speed : 1;
  const visStart = clip.start;
  const visEnd = clip.start + clip.duration;
  const out: TimeRange[] = [];
  for (const r of sourceRanges) {
    const a = Math.max(r.start, clip.sourceIn);
    const b = Math.min(r.end, clip.sourceOut);
    if (b <= a) continue;
    const s = Math.max(visStart, clip.start + (a - clip.sourceIn) / speed);
    const e = Math.min(visEnd, clip.start + (b - clip.sourceIn) / speed);
    if (e > s) out.push({ start: s, end: e });
  }
  return out;
}

export function isAudibleClip(project: Project, clip: Project['clips'][string], track?: Track): clip is MediaClip {
  if (clip.type !== 'video' && clip.type !== 'audio') return false;
  const t = track ?? project.tracks.find((x) => x.id === clip.trackId);
  if (!t || t.muted) return false;
  if (!(clip.volume > 0)) return false;
  const asset = project.assets[clip.assetId];
  return !!asset && asset.status === 'ready' && asset.hasAudio;
}

/** Audible clips of the project (or only those in `onlyIds`). */
export function getAudibleClips(project: Project, onlyIds?: readonly Id[]): MediaClip[] {
  const out: MediaClip[] = [];
  for (const clip of Object.values(project.clips)) {
    if (onlyIds && !onlyIds.includes(clip.id)) continue;
    if (isAudibleClip(project, clip)) out.push(clip);
  }
  return out.sort((a, b) => a.start - b.start);
}

export interface ClipActivity {
  clip: Pick<MediaClip, 'start' | 'duration' | 'sourceIn' | 'sourceOut' | 'speed'>;
  /** Loud ranges in the asset's SOURCE time. */
  activeSource: readonly TimeRange[];
}

export interface TimelineSilenceOptions {
  params: Pick<SilenceParams, 'minSilenceMs' | 'paddingMs' | 'minKeepMs'>;
  /** Timeline length (end of the last clip). Only used with `includeNoAudio`. */
  duration: number;
  /** Treat stretches without any audible clip as silence. */
  includeNoAudio: boolean;
  /** Project fps for snapping the result to frames (omit to skip snapping). */
  fps?: number;
}

/** Combines per-clip activity into removable timeline silences (see file header for the rule). */
export function computeTimelineSilence(activities: readonly ClipActivity[], opts: TimelineSilenceOptions): TimeRange[] {
  const covered = mergeRanges(activities.map((a) => ({ start: a.clip.start, end: clipEnd(a.clip) })));
  const loud = mergeRanges(activities.flatMap((a) => mapSourceRangesToTimeline(a.clip, a.activeSource)));
  const scope = opts.includeNoAudio ? [{ start: 0, end: Math.max(opts.duration, covered.at(-1)?.end ?? 0) }] : covered;
  const candidates = scope.flatMap((s) => complementRanges(intersectRanges(loud, [s]), s));
  let out = refineSilences(candidates, {
    minSilenceSec: opts.params.minSilenceMs / 1000,
    paddingSec: opts.params.paddingMs / 1000,
    minKeepSec: opts.params.minKeepMs / 1000,
    loud,
    mergeable: opts.includeNoAudio ? undefined : covered,
  });
  if (opts.fps && opts.fps > 0) {
    const fps = opts.fps;
    out = out.map((r) => ({ start: snapToFrame(r.start, fps), end: snapToFrame(r.end, fps) })).filter((r) => r.end - r.start > 1e-6);
  }
  return normalizeRanges(out);
}

/** Total length of (normalized) ranges. */
export function totalLength(ranges: readonly TimeRange[]): number {
  return normalizeRanges(ranges).reduce((s, r) => s + (r.end - r.start), 0);
}

/** Where a timeline time ends up after the ranges are ripple-deleted. */
export function shiftTimeAfterRemoval(t: number, ranges: readonly TimeRange[]): number {
  let removed = 0;
  for (const r of normalizeRanges(ranges)) {
    if (r.end <= t) removed += r.end - r.start;
    else if (r.start < t) removed += t - r.start;
  }
  return t - removed;
}

/**
 * Locked tracks are skipped by `rippleDeleteRanges`, so their clips that end
 * after the first removed range will drift out of sync. Returns those tracks' names.
 */
export function lockedTracksAtRisk(project: Project, ranges: readonly TimeRange[]): string[] {
  const rs = normalizeRanges(ranges);
  if (rs.length === 0) return [];
  const first = rs[0]!.start;
  return project.tracks
    .filter((t) => t.locked && Object.values(project.clips).some((c) => c.trackId === t.id && clipEnd(c) > first + 1e-6))
    .map((t) => t.name);
}

/** Duration of the project after removing `ranges` (assumes no locked tracks). */
export function durationAfterRemoval(project: Project, ranges: readonly TimeRange[]): number {
  return shiftTimeAfterRemoval(getProjectDuration(project), ranges);
}
