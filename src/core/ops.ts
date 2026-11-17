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
  DEFAULT_TRACK_KIND,
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
import type { AudioClip, Clip, ClipType, ClipboardContent, Id, Project, TimeRange, Track, TrackKind, VideoClip } from './types';

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

/**
 * Adds many clips in ONE step (e.g. importing hundreds of subtitle cues). Each
 * clip is validated exactly like `addClip` (track exists, unlocked, accepts the
 * type, id unused, positive duration after `normalizeClip`, no overlap with
 * existing clips OR with clips added earlier in the same batch). Rejected clips
 * are SKIPPED, the rest are added; `added` lists the ids actually added, in
 * input order. Null if none was added. Cost: O(n log n), one clips-object copy.
 */
export function addClips(project: Project, clips: readonly Clip[]): { project: Project; added: Id[] } | null {
  const tracks = new Map(project.tracks.map((t) => [t.id, t]));
  // Sorted, non-overlapping intervals per touched track (existing clips first).
  const busy = new Map<Id, { start: number; end: number }[]>();
  for (const c of clips) if (!busy.has(c.trackId)) busy.set(c.trackId, []);
  for (const c of Object.values(project.clips)) busy.get(c.trackId)?.push({ start: c.start, end: clipEnd(c) });
  for (const list of busy.values()) list.sort((a, b) => a.start - b.start);
  const next = { ...project.clips };
  const added: Id[] = [];
  for (const clip of clips) {
    const track = tracks.get(clip.trackId);
    if (!track || track.locked || !trackAccepts(track, clip.type) || next[clip.id]) continue;
    const c = normalizeClip(project, clip);
    if (c.duration <= TIME_EPSILON) continue;
    const list = busy.get(c.trackId)!;
    const end = clipEnd(c);
    // First interval ending after c.start; free if it starts at/after c's end.
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid]!.end <= c.start + TIME_EPSILON) lo = mid + 1;
      else hi = mid;
    }
    const n = list[lo];
    if (n && n.start < end - TIME_EPSILON) continue;
    list.splice(lo, 0, { start: c.start, end });
    next[c.id] = c;
    added.push(c.id);
  }
  return added.length ? { project: withClips(project, next), added } : null;
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
  const idMap = new Map(src.map((c) => [c.id, createId('clip')]));
  let p = project;
  const newIds: Id[] = [];
  for (const c of src) {
    const copy = remapLinks(newEffectIds({ ...c, id: idMap.get(c.id)! } as Clip), idMap);
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

// ---------------------------------------------------------------------------
// Detached-audio links (hints only — clips stay independent)
// ---------------------------------------------------------------------------

/**
 * Rewrites the detach-audio link fields of a copied clip through `idMap`
 * (old id -> new id). A link whose counterpart was not copied is dropped, so a
 * copy never points at (and "Restore audio" never deletes) the original's partner.
 */
export function remapLinks(clip: Clip, idMap: ReadonlyMap<Id, Id>): Clip {
  if (clip.type === 'video' && clip.detachedAudioClipId !== undefined) {
    const to = idMap.get(clip.detachedAudioClipId);
    const { detachedAudioClipId: _drop, ...rest } = clip;
    return (to ? { ...rest, detachedAudioClipId: to } : rest) as VideoClip;
  }
  if (clip.type === 'audio' && clip.detachedFromClipId !== undefined) {
    const to = idMap.get(clip.detachedFromClipId);
    const { detachedFromClipId: _drop, ...rest } = clip;
    return (to ? { ...rest, detachedFromClipId: to } : rest) as AudioClip;
  }
  return clip;
}

/** Ids of the clips linked to `ids` by "Detach audio" (both directions), excluding `ids` themselves. */
export function linkedClipIds(project: Project, ids: readonly Id[]): Id[] {
  const want = new Set(ids);
  const out = new Set<Id>();
  for (const id of ids) {
    const c = project.clips[id];
    if (c?.type === 'video' && c.detachedAudioClipId && project.clips[c.detachedAudioClipId]) out.add(c.detachedAudioClipId);
    if (c?.type === 'audio' && c.detachedFromClipId && project.clips[c.detachedFromClipId]) out.add(c.detachedFromClipId);
  }
  // Pieces created by splitting share the link: include every clip pointing at a wanted clip.
  for (const c of Object.values(project.clips)) {
    if (c.type === 'video' && c.detachedAudioClipId && want.has(c.detachedAudioClipId)) out.add(c.id);
    if (c.type === 'audio' && c.detachedFromClipId && want.has(c.detachedFromClipId)) out.add(c.id);
  }
  for (const id of ids) out.delete(id);
  return [...out];
}

// ---------------------------------------------------------------------------
// Multi-track moves and free-slot search (drag & drop)
// ---------------------------------------------------------------------------

/** Target of one clip in a multi-clip move. */
export interface ClipMove {
  id: Id;
  start: number;
  trackId: Id;
}

/**
 * Moves several clips to explicit (start, track) targets, all-or-nothing:
 * rejected (null) if a clip is missing or on a locked track, a target track is
 * missing / locked / does not accept the clip type, a start is negative, or any
 * overlap would result (with other clips or between the moved clips).
 */
export function moveClipsTo(project: Project, moves: readonly ClipMove[]): Project | null {
  if (moves.length === 0) return null;
  const ignore = new Set(moves.map((m) => m.id));
  const placed = new Map<Id, { start: number; end: number }[]>();
  const clips = { ...project.clips };
  let changed = false;
  for (const m of moves) {
    const c = project.clips[m.id];
    if (!c || isTrackLocked(project, c.trackId) || m.start < -TIME_EPSILON) return null;
    const t = getTrack(project, m.trackId);
    if (!t || t.locked || !trackAccepts(t, c.type)) return null;
    const start = Math.max(0, m.start);
    const end = start + c.duration;
    if (hasOverlap(project, t.id, start, end, ignore)) return null;
    const same = placed.get(t.id) ?? [];
    if (same.some((r) => start < r.end - TIME_EPSILON && end > r.start + TIME_EPSILON)) return null;
    same.push({ start, end });
    placed.set(t.id, same);
    if (Math.abs(start - c.start) > TIME_EPSILON || t.id !== c.trackId) {
      clips[c.id] = { ...c, start, trackId: t.id };
      changed = true;
    }
  }
  return changed ? withClips(project, clips) : null;
}

/** An interval to place: current start/duration and the track it would go to. */
export interface PlacementItem {
  start: number;
  duration: number;
  trackId: Id;
}

/**
 * Smallest-distance time shift (relative to `desiredDelta`) at which every item
 * fits on its track without overlapping other clips (ignoring `ignore`) and
 * without going below 0. Candidate shifts butt an item against a neighbour's
 * edge. Returns null if nothing fits within `maxDistance` seconds of `desiredDelta`.
 * Items on new (not yet existing) tracks always fit.
 */
export function nearestFreeDelta(
  project: Project,
  items: readonly PlacementItem[],
  desiredDelta: number,
  ignore: ReadonlySet<Id> = new Set(),
  maxDistance = Infinity,
): number | null {
  if (items.length === 0) return null;
  const byTrack = new Map<Id, { start: number; end: number }[]>();
  for (const it of items) if (!byTrack.has(it.trackId)) byTrack.set(it.trackId, []);
  for (const c of Object.values(project.clips)) {
    const list = byTrack.get(c.trackId);
    if (list && !ignore.has(c.id)) list.push({ start: c.start, end: clipEnd(c) });
  }
  for (const list of byTrack.values()) list.sort((a, b) => a.start - b.start);
  const minStart = Math.min(...items.map((i) => i.start));
  const free = (list: { start: number; end: number }[], s: number, e: number): boolean => {
    // First interval whose end is after s (ends are sorted like starts: no overlaps on a track).
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid]!.end <= s + TIME_EPSILON) lo = mid + 1;
      else hi = mid;
    }
    const n = list[lo];
    return !n || n.start >= e - TIME_EPSILON;
  };
  const fits = (d: number): boolean => {
    if (minStart + d < -TIME_EPSILON) return false;
    return items.every((it) => free(byTrack.get(it.trackId)!, it.start + d, it.start + d + it.duration));
  };
  const cands = new Set<number>([desiredDelta, -minStart]);
  for (const it of items) {
    for (const o of byTrack.get(it.trackId)!) {
      cands.add(o.end - it.start);
      cands.add(o.start - (it.start + it.duration));
    }
  }
  const sorted = [...cands]
    .filter((d) => Math.abs(d - desiredDelta) <= maxDistance + TIME_EPSILON)
    .sort((a, b) => Math.abs(a - desiredDelta) - Math.abs(b - desiredDelta));
  for (const d of sorted) if (fits(d)) return d;
  return null;
}

// ---------------------------------------------------------------------------
// Clipboard (internal; never the system clipboard)
// ---------------------------------------------------------------------------

/** Snapshots clips for the clipboard (locked clips can be copied). Null if none exist. */
export function copyClips(project: Project, ids: readonly Id[]): ClipboardContent | null {
  const clips = [...new Set(ids)].map((id) => project.clips[id]).filter((c): c is Clip => !!c);
  if (clips.length === 0) return null;
  clips.sort((a, b) => a.start - b.start);
  const trackIds = new Set(clips.map((c) => c.trackId));
  const tracks = project.tracks.filter((t) => trackIds.has(t.id)).map((t) => ({ id: t.id, kind: t.kind, order: t.order }));
  return { clips, tracks, start: Math.min(...clips.map((c) => c.start)) };
}

function acceptsAll(track: Pick<Track, 'kind'>, types: ReadonlySet<ClipType>): boolean {
  for (const t of types) if (!trackAccepts(track, t)) return false;
  return true;
}

/**
 * Pastes clipboard content so its earliest clip starts at `at`. Relative
 * offsets are kept, and clips that shared a source track stay together on one
 * target track. Per source track the target is: `opts.trackId` (for the first
 * group it accepts), else the original track if it still exists and the clips
 * fit there, else the nearest compatible unlocked track of the same kind where
 * they fit, else a NEW track of that kind next to the original. So paste only
 * fails when the clipboard is empty. Pasted clips get new ids (and effect ids).
 */
export function pasteClips(
  project: Project,
  content: ClipboardContent,
  at: number,
  opts: { trackId?: Id } = {},
): { project: Project; newIds: Id[] } | null {
  if (content.clips.length === 0) return null;
  const offset = Math.max(0, at) - content.start;
  const groups = new Map<Id, Clip[]>();
  for (const c of content.clips) groups.set(c.trackId, [...(groups.get(c.trackId) ?? []), c]);
  const srcInfo = new Map(content.tracks.map((t) => [t.id, t]));
  // Top-most source track first (display order), so "paste here" targets the top group.
  const order = [...groups.keys()].sort((a, b) => (srcInfo.get(b)?.order ?? 0) - (srcInfo.get(a)?.order ?? 0));
  const idMap = new Map(content.clips.map((c) => [c.id, createId('clip')]));
  let p = project;
  const used = new Set<Id>();
  const newIds: Id[] = [];
  let preferredUsed = false;
  for (const srcTrackId of order) {
    const group = groups.get(srcTrackId)!;
    const types = new Set(group.map((c) => c.type));
    const src = srcInfo.get(srcTrackId);
    const kind: TrackKind = src && acceptsAll(src, types) ? src.kind : DEFAULT_TRACK_KIND[group[0]!.type];
    const fitsOn = (t: Track) =>
      !t.locked &&
      !used.has(t.id) &&
      acceptsAll(t, types) &&
      group.every((c) => !hasOverlap(p, t.id, c.start + offset, c.start + offset + c.duration));
    let target: Track | undefined;
    if (opts.trackId && !preferredUsed) {
      const t = getTrack(p, opts.trackId);
      if (t && acceptsAll(t, types)) {
        preferredUsed = true;
        if (fitsOn(t)) target = t;
      }
    }
    const original = getTrack(p, srcTrackId);
    if (!target && original && fitsOn(original)) target = original;
    if (!target) {
      const refOrder = original?.order ?? src?.order ?? 0;
      target = p.tracks
        .filter((t) => fitsOn(t))
        .sort((a, b) => Number(b.kind === kind) - Number(a.kind === kind) || Math.abs(a.order - refOrder) - Math.abs(b.order - refOrder))[0];
    }
    if (!target) {
      const near = original && original.kind === kind ? original : undefined;
      const r = addTrack(p, kind, near ? { order: kind === 'audio' ? near.order : near.order + 1 } : {});
      p = r.project;
      target = getTrack(p, r.trackId)!;
    }
    used.add(target.id);
    const copies = group.map((c) =>
      remapLinks(newEffectIds({ ...c, id: idMap.get(c.id)!, trackId: target!.id, start: c.start + offset } as Clip), idMap),
    );
    const r = addClips(p, copies);
    if (r) {
      p = r.project;
      newIds.push(...r.added);
    }
  }
  return newIds.length ? { project: p, newIds } : null;
}

// ---------------------------------------------------------------------------
// Detach / restore audio
// ---------------------------------------------------------------------------

/** True if "Detach audio" applies: an editable video clip whose asset has audio and is not detached yet. */
export function canDetachAudio(project: Project, clip: Clip | undefined): clip is VideoClip {
  if (!clip || clip.type !== 'video' || clip.audioDetached) return false;
  if (isTrackLocked(project, clip.trackId)) return false;
  return !!project.assets[clip.assetId]?.hasAudio;
}

/** True if "Restore audio" applies to the clip (a detached video clip, or an audio clip detached from one). */
export function canRestoreAudio(project: Project, clip: Clip | undefined): boolean {
  if (!clip) return false;
  if (clip.type === 'video') return !!clip.audioDetached && !isTrackLocked(project, clip.trackId);
  if (clip.type === 'audio' && clip.detachedFromClipId) {
    const v = project.clips[clip.detachedFromClipId];
    return v?.type === 'video' && !!v.audioDetached && !isTrackLocked(project, v.trackId);
  }
  return false;
}

/**
 * "Detach audio": for each video clip in `ids` that `canDetachAudio`, creates an
 * `audio` clip for the SAME asset with the same timing (start, duration,
 * sourceIn/Out, speed, fades) and volume, on the top-most unlocked audio track
 * where that range is free (a new audio track if none), and silences the video
 * clip (`volume: 0`, `audioDetached: true`, previous volume kept). Returns the
 * new audio clip ids, or null if nothing applied.
 */
export function detachAudio(project: Project, ids: readonly Id[]): { project: Project; audioIds: Id[] } | null {
  let p = project;
  const pending: AudioClip[] = [];
  const silenced: VideoClip[] = [];
  const targets = ids
    .map((id) => project.clips[id])
    .filter((c): c is VideoClip => canDetachAudio(project, c))
    .sort((a, b) => a.start - b.start);
  for (const v of targets) {
    const audioId = createId('clip');
    const audio: AudioClip = {
      id: audioId,
      type: 'audio',
      trackId: '',
      start: v.start,
      duration: v.duration,
      name: v.name,
      effects: [],
      fadeIn: v.fadeIn,
      fadeOut: v.fadeOut,
      assetId: v.assetId,
      sourceIn: v.sourceIn,
      sourceOut: v.sourceOut,
      speed: v.speed,
      volume: v.volume,
      detachedFromClipId: v.id,
    };
    const end = v.start + v.duration;
    const freeOn = (trackId: Id) =>
      !hasOverlap(p, trackId, v.start, end) &&
      !pending.some((a) => a.trackId === trackId && v.start < clipEnd(a) - TIME_EPSILON && end > a.start + TIME_EPSILON);
    let track = [...p.tracks].filter((t) => t.kind === 'audio' && !t.locked && freeOn(t.id)).sort((a, b) => b.order - a.order)[0];
    if (!track) {
      const r = addTrack(p, 'audio');
      p = r.project;
      track = getTrack(p, r.trackId)!;
    }
    pending.push({ ...audio, trackId: track.id });
    silenced.push({ ...v, volume: 0, audioDetached: true, volumeBeforeDetach: v.volume, detachedAudioClipId: audioId });
  }
  // One batched insert for all audio clips; only videos whose audio was added are silenced.
  const r = addClips(p, pending);
  if (!r) return null;
  const ok = new Set(r.added);
  const clips = { ...r.project.clips };
  for (const v of silenced) if (v.detachedAudioClipId && ok.has(v.detachedAudioClipId)) clips[v.id] = v;
  return { project: withClips(r.project, clips), audioIds: r.added };
}

/**
 * "Restore audio" (undoes a detach later): for each detached video clip in
 * `ids` (audio clips in `ids` stand for the video clip they were detached
 * from) restores its previous volume and clears the flags, and removes the
 * detached audio clip if it still exists, is not locked and is not still used
 * by another detached piece (e.g. the other half of a split video clip) that is
 * not being restored too. Returns null if nothing applied.
 */
export function restoreAudio(project: Project, ids: readonly Id[]): Project | null {
  const videoIds = new Set<Id>();
  for (const id of ids) {
    const c = project.clips[id];
    if (c?.type === 'video' && c.audioDetached) videoIds.add(c.id);
    else if (c?.type === 'audio' && c.detachedFromClipId) {
      const v = project.clips[c.detachedFromClipId];
      if (v?.type === 'video' && v.audioDetached) videoIds.add(v.id);
    }
  }
  const clips = { ...project.clips };
  let changed = false;
  const audioToRemove = new Set<Id>();
  for (const id of videoIds) {
    const v = project.clips[id] as VideoClip;
    if (isTrackLocked(project, v.trackId)) continue;
    const { audioDetached: _a, volumeBeforeDetach, detachedAudioClipId, ...rest } = v;
    clips[id] = { ...rest, volume: clamp(volumeBeforeDetach ?? 1, 0, MAX_VOLUME) } as VideoClip;
    changed = true;
    if (detachedAudioClipId) audioToRemove.add(detachedAudioClipId);
  }
  for (const aid of audioToRemove) {
    const a = project.clips[aid];
    if (!a || isTrackLocked(project, a.trackId)) continue;
    const stillUsed = Object.values(project.clips).some(
      (c) => c.type === 'video' && c.audioDetached && c.detachedAudioClipId === aid && !videoIds.has(c.id),
    );
    if (!stillUsed) delete clips[aid];
  }
  return changed ? withClips(project, clips) : null;
}
