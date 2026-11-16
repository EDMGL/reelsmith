/**
 * Pure editing operations on a Project. Each function returns a NEW project
 * (structural sharing) or `null` when the operation is rejected / a no-op.
 * The store wraps these with history; they are also usable directly in tests
 * or in feature packages that need to compute a result before committing.
 *
 * Overlap rule: clips on the same track never overlap. Operations that would
 * create an overlap are REJECTED (return null) — except trims, which are
 * CLAMPED to the neighbouring clips.
 *
 * Locked tracks: operations never modify clips on a locked track (they are
 * rejected, or skipped for multi-clip operations).
 */
import { createId } from './ids';
import {
  MAX_SPEED,
  MAX_VOLUME,
  MIN_SPEED,
  clipEnd,
  createTrack,
  getTrack,
  getTrackClips,
  isMediaClip,
  trackAccepts,
} from './model';
import { TIME_EPSILON, clamp, normalizeRanges } from './time';
import type { Clip, Id, Project, TimeRange, Track, TrackKind } from './types';

/** Distributive Omit that keeps the discriminated union intact. */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** Patch accepted by `updateClip` (id and type are immutable). */
export type ClipPatch = Partial<DistributiveOmit<Clip, 'id' | 'type'>>;

/** Smallest clip duration produced by trims/splits (seconds). */
export function minClipDuration(project: Project): number {
  return 1 / Math.max(1, project.fps);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withClips(project: Project, clips: Record<Id, Clip>): Project {
  return { ...project, clips };
}

export function isTrackLocked(project: Project, trackId: Id): boolean {
  return getTrack(project, trackId)?.locked ?? true;
}

/** True if the clip exists and its track is not locked. */
export function isClipEditable(project: Project, clipId: Id): boolean {
  const clip = project.clips[clipId];
  return !!clip && !isTrackLocked(project, clip.trackId);
}

/** True if [start, end) on the track intersects any clip not in `ignore`. */
export function hasOverlap(project: Project, trackId: Id, start: number, end: number, ignore: ReadonlySet<Id> = new Set()): boolean {
  for (const c of Object.values(project.clips)) {
    if (c.trackId !== trackId || ignore.has(c.id)) continue;
    if (start < clipEnd(c) - TIME_EPSILON && end > c.start + TIME_EPSILON) return true;
  }
  return false;
}

/** End time of the last clip on a track (0 if empty). */
export function trackEnd(project: Project, trackId: Id, ignore: ReadonlySet<Id> = new Set()): number {
  let end = 0;
  for (const c of Object.values(project.clips)) if (c.trackId === trackId && !ignore.has(c.id)) end = Math.max(end, clipEnd(c));
  return end;
}

/** Earliest start >= `from` where an interval of `duration` fits on the track. */
export function findFreeStart(project: Project, trackId: Id, from: number, duration: number, ignore: ReadonlySet<Id> = new Set()): number {
  let start = Math.max(0, from);
  for (const c of getTrackClips(project, trackId)) {
    if (ignore.has(c.id)) continue;
    if (clipEnd(c) <= start + TIME_EPSILON) continue;
    if (c.start >= start + duration - TIME_EPSILON) break;
    start = clipEnd(c);
  }
  return start;
}

function newEffectIds(clip: Clip): Clip {
  return { ...clip, effects: clip.effects.map((e) => ({ ...e, id: createId('fx') })) } as Clip;
}

/** Asset duration bound for a media clip (falls back to current sourceOut). */
function sourceLimit(project: Project, clip: Clip): number {
  if (!isMediaClip(clip)) return Infinity;
  const d = project.assets[clip.assetId]?.duration;
  return d && d > 0 ? Math.max(d, clip.sourceOut) : clip.sourceOut;
}

/**
 * Enforces clip invariants: start >= 0, media duration derived from the
 * source range and speed, fades within duration, ranges for speed/volume.
 */
export function normalizeClip(project: Project, clip: Clip): Clip {
  let c = { ...clip, start: Math.max(0, clip.start) } as Clip;
  if (isMediaClip(c)) {
    const speed = clamp(c.speed, MIN_SPEED, MAX_SPEED);
    const limit = sourceLimit(project, c);
    const sourceIn = clamp(c.sourceIn, 0, limit);
    const sourceOut = clamp(c.sourceOut, sourceIn, limit);
    c = { ...c, speed, sourceIn, sourceOut, volume: clamp(c.volume, 0, MAX_VOLUME), duration: (sourceOut - sourceIn) / speed };
  }
  const fadeIn = clamp(c.fadeIn, 0, c.duration);
  const fadeOut = clamp(c.fadeOut, 0, c.duration);
  return { ...c, fadeIn, fadeOut };
}

/**
 * Returns a copy of `clip` restricted to timeline interval [a, b] (must lie
 * inside the clip). The copy keeps `start = a`; media source range is
 * adjusted; fades are kept only on the original outer edges.
 */
export function sliceClip(clip: Clip, a: number, b: number, id: Id = clip.id): Clip {
  const s = clip.start;
  const e = clipEnd(clip);
  const duration = b - a;
  let out = {
    ...clip,
    id,
    start: a,
    duration,
    fadeIn: Math.abs(a - s) <= TIME_EPSILON ? Math.min(clip.fadeIn, duration) : 0,
    fadeOut: Math.abs(b - e) <= TIME_EPSILON ? Math.min(clip.fadeOut, duration) : 0,
  } as Clip;
  if (isMediaClip(clip) && isMediaClip(out)) {
    const sourceIn = clip.sourceIn + (a - s) * clip.speed;
    out = { ...out, sourceIn, sourceOut: sourceIn + duration * clip.speed };
  }
  return id === clip.id ? out : newEffectIds(out);
}

// ---------------------------------------------------------------------------
// Tracks
// ---------------------------------------------------------------------------

/** Re-assigns dense orders 0..n-1 preserving relative order. */
function densifyOrders(tracks: Track[]): Track[] {
  return [...tracks].sort((a, b) => a.order - b.order).map((t, i) => (t.order === i ? t : { ...t, order: i }));
}

/**
 * Adds a track. Visual tracks go on top (highest order); audio tracks go to
 * the bottom (order 0) so they are listed under the visual tracks.
 * `opts.order` forces a position (existing tracks shift up).
 */
export function addTrack(project: Project, kind: TrackKind, opts: { name?: string; order?: number } = {}): { project: Project; trackId: Id } {
  const max = project.tracks.length;
  const order = clamp(opts.order ?? (kind === 'audio' ? 0 : max), 0, max);
  const track = createTrack(kind, order, opts.name);
  const shifted = project.tracks.map((t) => (t.order >= order ? { ...t, order: t.order + 1 } : t));
  return { project: { ...project, tracks: densifyOrders([...shifted, track]) }, trackId: track.id };
}

/** Removes a track and all its clips (allowed even if locked). */
export function removeTrack(project: Project, trackId: Id): Project | null {
  if (!getTrack(project, trackId)) return null;
  const clips = Object.fromEntries(Object.entries(project.clips).filter(([, c]) => c.trackId !== trackId));
  return { ...project, tracks: densifyOrders(project.tracks.filter((t) => t.id !== trackId)), clips };
}

export function updateTrack(project: Project, trackId: Id, patch: Partial<Pick<Track, 'name' | 'muted' | 'locked' | 'hidden'>>): Project | null {
  const t = getTrack(project, trackId);
  if (!t) return null;
  return { ...project, tracks: project.tracks.map((x) => (x.id === trackId ? { ...x, ...patch } : x)) };
}

/** Moves a track to a new compositing order (others shift). */
export function moveTrack(project: Project, trackId: Id, toOrder: number): Project | null {
  const sorted = [...project.tracks].sort((a, b) => a.order - b.order);
  const idx = sorted.findIndex((t) => t.id === trackId);
  if (idx < 0) return null;
  const to = clamp(Math.round(toOrder), 0, sorted.length - 1);
  if (to === idx) return null;
  const [t] = sorted.splice(idx, 1);
  sorted.splice(to, 0, t!);
  return { ...project, tracks: sorted.map((x, i) => (x.order === i ? x : { ...x, order: i })) };
}

// ---------------------------------------------------------------------------
// Clips
// ---------------------------------------------------------------------------

/** Adds a clip. Rejected if the track is missing/locked/incompatible or the slot is occupied. */
export function addClip(project: Project, clip: Clip): Project | null {
  const track = getTrack(project, clip.trackId);
  if (!track || track.locked || !trackAccepts(track, clip.type) || project.clips[clip.id]) return null;
  const c = normalizeClip(project, clip);
  if (c.duration <= TIME_EPSILON) return null;
  if (hasOverlap(project, c.trackId, c.start, clipEnd(c))) return null;
  return withClips(project, { ...project.clips, [c.id]: c });
}

/** Removes clips (clips on locked tracks are skipped). Returns null if nothing removed. */
export function removeClips(project: Project, ids: readonly Id[]): Project | null {
  const clips = { ...project.clips };
  let changed = false;
  for (const id of ids) {
    if (!isClipEditable(project, id)) continue;
    delete clips[id];
    changed = true;
  }
  return changed ? withClips(project, clips) : null;
}

/**
 * Generic clip update. For media clips: changing `speed` keeps the source
 * range and recomputes `duration`; setting `duration` adjusts `sourceOut`.
 * Rejected if the result overlaps, targets an incompatible/locked track, or
 * the clip is locked.
 */
export function updateClip(project: Project, id: Id, patch: ClipPatch): Project | null {
  const clip = project.clips[id];
  if (!clip || isTrackLocked(project, clip.trackId)) return null;
  let next = { ...clip, ...patch, id: clip.id, type: clip.type } as Clip;
  if (isMediaClip(next) && isMediaClip(clip) && 'duration' in patch && !('sourceOut' in patch)) {
    const speed = clamp(next.speed, MIN_SPEED, MAX_SPEED);
    next = { ...next, sourceOut: next.sourceIn + next.duration * speed };
  }
  next = normalizeClip(project, next);
  if (next.duration <= TIME_EPSILON) return null;
  const track = getTrack(project, next.trackId);
  if (!track || track.locked || !trackAccepts(track, next.type)) return null;
  if (hasOverlap(project, next.trackId, next.start, clipEnd(next), new Set([id]))) return null;
  return withClips(project, { ...project.clips, [id]: next });
}

/** Moves one clip to `start` (and optionally another compatible track). Rejected on overlap. */
export function moveClip(project: Project, id: Id, start: number, trackId?: Id): Project | null {
  const clip = project.clips[id];
  if (!clip) return null;
  const target = trackId ?? clip.trackId;
  if (Math.abs(clip.start - start) <= TIME_EPSILON && target === clip.trackId) return null;
  return updateClip(project, id, { start: Math.max(0, start), trackId: target });
}

/**
 * Moves several clips by the same time delta (tracks unchanged). All-or-nothing:
 * rejected if any clip is locked or any overlap would result. The delta is
 * clamped so no clip goes below 0.
 */
export function moveClips(project: Project, ids: readonly Id[], delta: number): Project | null {
  const moving = ids.map((id) => project.clips[id]).filter((c): c is Clip => !!c);
  if (moving.length === 0) return null;
  if (moving.some((c) => isTrackLocked(project, c.trackId))) return null;
  const minStart = Math.min(...moving.map((c) => c.start));
  const d = Math.max(delta, -minStart);
  if (Math.abs(d) <= TIME_EPSILON) return null;
  const ignore = new Set(moving.map((c) => c.id));
  const clips = { ...project.clips };
  for (const c of moving) {
    const start = c.start + d;
    if (hasOverlap(project, c.trackId, start, start + c.duration, ignore)) return null;
    clips[c.id] = { ...c, start };
  }
  return withClips(project, clips);
}

export type TrimEdge = 'start' | 'end';

/**
 * Moves one edge of a clip to timeline time `time`, keeping the other edge
 * fixed. The result is CLAMPED to: source media bounds (video/audio), the
 * neighbouring clips on the track, time 0, and a minimum duration of one frame.
 */
export function trimClip(project: Project, id: Id, edge: TrimEdge, time: number): Project | null {
  const clip = project.clips[id];
  if (!clip || isTrackLocked(project, clip.trackId)) return null;
  const minDur = minClipDuration(project);
  const end = clipEnd(clip);
  const neighbours = getTrackClips(project, clip.trackId).filter((c) => c.id !== id);
  let next: Clip;
  if (edge === 'start') {
    let lo = 0;
    for (const n of neighbours) if (clipEnd(n) <= clip.start + TIME_EPSILON) lo = Math.max(lo, clipEnd(n));
    if (isMediaClip(clip)) lo = Math.max(lo, clip.start - clip.sourceIn / clip.speed);
    const t = clamp(time, lo, end - minDur);
    if (Math.abs(t - clip.start) <= TIME_EPSILON) return null;
    next = { ...clip, start: t, duration: end - t } as Clip;
    if (isMediaClip(clip) && isMediaClip(next)) next = { ...next, sourceIn: clip.sourceIn + (t - clip.start) * clip.speed };
  } else {
    let hi = Infinity;
    for (const n of neighbours) if (n.start >= end - TIME_EPSILON) hi = Math.min(hi, n.start);
    if (isMediaClip(clip)) hi = Math.min(hi, clip.start + (sourceLimit(project, clip) - clip.sourceIn) / clip.speed);
    const t = clamp(time, clip.start + minDur, hi);
    if (Math.abs(t - end) <= TIME_EPSILON) return null;
    next = { ...clip, duration: t - clip.start } as Clip;
    if (isMediaClip(clip) && isMediaClip(next)) next = { ...next, sourceOut: clip.sourceIn + (t - clip.start) * clip.speed };
  }
  return withClips(project, { ...project.clips, [id]: normalizeClip(project, next) });
}

/**
 * Splits a clip at timeline time `time` into two adjacent clips. The left part
 * keeps the original id. Rejected if `time` is not strictly inside the clip
 * (at least one frame from each edge) or the track is locked.
 */
export function splitClip(project: Project, id: Id, time: number): { project: Project; newClipId: Id } | null {
  const clip = project.clips[id];
  if (!clip || isTrackLocked(project, clip.trackId)) return null;
  const minDur = minClipDuration(project) - TIME_EPSILON;
  const end = clipEnd(clip);
  if (time - clip.start < minDur || end - time < minDur) return null;
  const left = sliceClip(clip, clip.start, time);
  const newClipId = createId('clip');
  const right = sliceClip(clip, time, end, newClipId);
  return { project: withClips(project, { ...project.clips, [id]: left, [newClipId]: right }), newClipId };
}

/**
 * Removes the given time ranges from the timeline and closes the gaps
 * ("ripple"). Clips fully inside a range are deleted; clips that partially
 * overlap a range are cut (media source ranges adjusted) and the remaining
 * pieces shifted left; clips after a range shift left by the removed length.
 * Ranges may be unsorted/overlapping (they are merged).
 *
 * @param trackIds tracks to affect (default: all). Locked tracks are always skipped.
 */
export function rippleDeleteRanges(project: Project, ranges: readonly TimeRange[], trackIds?: readonly Id[]): Project | null {
  const rs = normalizeRanges(ranges);
  if (rs.length === 0) return null;
  const affected = new Set(
    project.tracks.filter((t) => !t.locked && (!trackIds || trackIds.includes(t.id))).map((t) => t.id),
  );
  /** Maps a kept time to its new position. */
  const shift = (t: number) => {
    let removed = 0;
    for (const r of rs) {
      if (r.end <= t + TIME_EPSILON) removed += r.end - r.start;
      else if (r.start < t) removed += t - r.start;
    }
    return t - removed;
  };
  const clips: Record<Id, Clip> = {};
  let changed = false;
  for (const clip of Object.values(project.clips)) {
    if (!affected.has(clip.trackId)) {
      clips[clip.id] = clip;
      continue;
    }
    const s = clip.start;
    const e = clipEnd(clip);
    // Kept segments = [s, e] minus ranges.
    const segments: [number, number][] = [];
    let cursor = s;
    for (const r of rs) {
      if (r.end <= cursor || r.start >= e) continue;
      if (r.start > cursor) segments.push([cursor, Math.min(r.start, e)]);
      cursor = Math.max(cursor, r.end);
    }
    if (cursor < e) segments.push([cursor, e]);
    const kept = segments.filter(([a, b]) => b - a > TIME_EPSILON);
    if (kept.length === 1 && Math.abs(kept[0]![0] - s) <= TIME_EPSILON && Math.abs(kept[0]![1] - e) <= TIME_EPSILON) {
      const ns = shift(s);
      if (Math.abs(ns - s) > TIME_EPSILON) changed = true;
      clips[clip.id] = ns === s ? clip : { ...clip, start: ns };
      continue;
    }
    changed = true;
    kept.forEach(([a, b], i) => {
      const piece = sliceClip(clip, a, b, i === 0 ? clip.id : createId('clip'));
      clips[piece.id] = { ...piece, start: shift(a) };
    });
  }
  return changed ? withClips(project, clips) : null;
}

/**
 * Deletes clips and closes the gap they leave on THEIR OWN track only
 * (later clips on the same track shift left). Locked clips are skipped.
 */
export function rippleDeleteClips(project: Project, ids: readonly Id[]): Project | null {
  const byTrack = new Map<Id, TimeRange[]>();
  for (const id of ids) {
    const c = project.clips[id];
    if (!c || isTrackLocked(project, c.trackId)) continue;
    const list = byTrack.get(c.trackId) ?? [];
    list.push({ start: c.start, end: clipEnd(c) });
    byTrack.set(c.trackId, list);
  }
  let p: Project = project;
  let changed = false;
  for (const [trackId, ranges] of byTrack) {
    const r = rippleDeleteRanges(p, ranges, [trackId]);
    if (r) {
      p = r;
      changed = true;
    }
  }
  return changed ? p : null;
}

/**
 * Duplicates clips. Copies are placed right after the selection's time span
 * on the same track (preserving relative spacing), or at the next free slot.
 */
export function duplicateClips(project: Project, ids: readonly Id[]): { project: Project; newIds: Id[] } | null {
  const src = ids
    .map((id) => project.clips[id])
    .filter((c): c is Clip => !!c && !isTrackLocked(project, c.trackId))
    .sort((a, b) => a.start - b.start);
  if (src.length === 0) return null;
  const span = Math.max(...src.map(clipEnd)) - Math.min(...src.map((c) => c.start));
  let p = project;
  const newIds: Id[] = [];
  for (const c of src) {
    const copy = newEffectIds({ ...c, id: createId('clip') } as Clip);
    const start = findFreeStart(p, c.trackId, c.start + span, c.duration);
    const next = addClip(p, { ...copy, start } as Clip);
    if (next) {
      p = next;
      newIds.push(copy.id);
    }
  }
  return newIds.length ? { project: p, newIds } : null;
}

/**
 * Finds (or creates) a track for a new clip of `clipType` and a start time.
 * - If `trackId` is given, it must accept the type and be unlocked; `start`
 *   defaults to the track end; rejected (null) if the slot is occupied.
 * - Otherwise, the lowest unlocked compatible track of the default kind where
 *   the clip fits is used; if none fits, a new track is created.
 */
export function placeClip(
  project: Project,
  clip: Clip,
  opts: { trackId?: Id; start?: number; preferredKind: TrackKind },
): { project: Project; clip: Clip } | null {
  if (opts.trackId) {
    const t = getTrack(project, opts.trackId);
    if (!t || t.locked || !trackAccepts(t, clip.type)) return null;
    const start = opts.start ?? trackEnd(project, t.id);
    const c = { ...clip, trackId: t.id, start } as Clip;
    const p = addClip(project, c);
    return p ? { project: p, clip: p.clips[c.id]! } : null;
  }
  const candidates = [...project.tracks]
    .filter((t) => t.kind === opts.preferredKind && !t.locked && trackAccepts(t, clip.type))
    .sort((a, b) => a.order - b.order);
  for (const t of candidates) {
    const start = opts.start ?? trackEnd(project, t.id);
    const c = { ...clip, trackId: t.id, start } as Clip;
    const p = addClip(project, c);
    if (p) return { project: p, clip: p.clips[c.id]! };
  }
  const { project: withTrack, trackId } = addTrack(project, opts.preferredKind);
  const c = { ...clip, trackId, start: opts.start ?? 0 } as Clip;
  const p = addClip(withTrack, c);
  return p ? { project: p, clip: p.clips[c.id]! } : null;
}

/** Removes an asset and every clip that references it. */
export function removeAsset(project: Project, assetId: Id): Project | null {
  if (!project.assets[assetId]) return null;
  const assets = { ...project.assets };
  delete assets[assetId];
  const clips = Object.fromEntries(
    Object.entries(project.clips).filter(([, c]) => !('assetId' in c) || c.assetId !== assetId),
  );
  return { ...project, assets, clips };
}
