/**
 * Pure drop/move placement logic (unit-tested). Given where the pointer is,
 * decides exactly where clips land:
 *  1. the hovered slot if it is free;
 *  2. else the nearest free slot on the same track(s) within `NEAR_SLOT_PX`;
 *  3. else a NEW track next to the hovered one (single target track);
 *  4. else (multi-track moves) the nearest free slot at any distance.
 * A drop is only rejected when none of this is possible (e.g. locked clips).
 */
import {
  DEFAULT_TRACK_KIND,
  getTrack,
  ops,
  trackAccepts,
  type Clip,
  type ClipType,
  type Id,
  type Project,
  type Track,
  type TrackKind,
} from '../../core';
import { displayTracks } from './geometry';
import { NEAR_SLOT_PX, type DragPreview, type GhostItem } from './timelineUi';
import type { Hit } from './timelineView';

export type Plan = Omit<DragPreview, 'marker'>;

function acceptsAll(track: Pick<Track, 'kind'>, types: Iterable<ClipType>): boolean {
  for (const t of types) if (!trackAccepts(track, t)) return false;
  return true;
}

/**
 * Compositing order for a new track of `kind`:
 * - zone 'top': visual -> top of everything; audio -> top of the audio block.
 * - zone 'bottom': visual -> bottom of the visual block (above audio); audio -> bottom.
 * - next to a track: visual -> right above it (or bottom of the visual block if it is
 *   an audio track); audio -> right below it (or top of the audio block).
 * Audio tracks stay at the low end, as everywhere else in the editor.
 */
export function newTrackOrder(project: Project, kind: TrackKind, where: 'top' | 'bottom' | Track): number {
  const audioCount = project.tracks.filter((t) => t.kind === 'audio').length;
  const audio = kind === 'audio';
  if (where === 'top') return audio ? audioCount : project.tracks.length;
  if (where === 'bottom') return audio ? 0 : audioCount;
  if (audio) return where.kind === 'audio' ? where.order : audioCount;
  return where.kind === 'audio' ? audioCount : where.order + 1;
}

function ghosts(clips: Clip[], delta: number, trackOf: (c: Clip) => Id | null): GhostItem[] {
  return clips.map((clip) => ({ clip, start: clip.start + delta, trackId: trackOf(clip) }));
}

/**
 * Plans moving clips `ids` (dragged by `anchorId`) by `delta` seconds with the
 * pointer at `hit`. Clips on locked tracks are not moved.
 */
export function planMove(project: Project, opts: { ids: readonly Id[]; anchorId: Id; delta: number; hit: Hit; zoom: number }): Plan {
  const moving = opts.ids.map((id) => project.clips[id]).filter((c): c is Clip => !!c && ops.isClipEditable(project, c.id));
  const anchor = project.clips[opts.anchorId];
  const rejected: Plan = { ghosts: [], newTrack: null, valid: false, outcome: 'rejected' };
  if (!anchor || moving.length === 0) return rejected;
  const minStart = Math.min(...moving.map((c) => c.start));
  const d0 = Math.max(opts.delta, -minStart);
  const ignore = new Set(moving.map((c) => c.id));
  const srcTracks = [...new Set(moving.map((c) => c.trackId))];
  const typesOn = (trackId: Id) => new Set(moving.filter((c) => c.trackId === trackId).map((c) => c.type));

  // Above / below all tracks: a new track (only when the clips come from one track).
  if (opts.hit.zone && srcTracks.length === 1) {
    const src = getTrack(project, srcTracks[0]!)!;
    const types = typesOn(src.id);
    const kind = acceptsAll(src, types) ? src.kind : DEFAULT_TRACK_KIND[anchor.type];
    return {
      ghosts: ghosts(moving, d0, () => null),
      newTrack: { kind, order: newTrackOrder(project, kind, opts.hit.zone) },
      valid: true,
      outcome: 'new-track',
    };
  }

  // Track mapping: every clip shifts by the same number of rows as the anchor.
  let mapping = new Map(srcTracks.map((t) => [t, t]));
  if (opts.hit.trackId && opts.hit.trackId !== anchor.trackId) {
    const display = displayTracks(project);
    const idx = new Map(display.map((t, i) => [t.id, i]));
    const shift = (idx.get(opts.hit.trackId) ?? 0) - (idx.get(anchor.trackId) ?? 0);
    const m = new Map<Id, Id>();
    let ok = true;
    for (const src of srcTracks) {
      const t = display[(idx.get(src) ?? 0) + shift];
      if (!t || t.locked || !acceptsAll(t, typesOn(src))) ok = false;
      else m.set(src, t.id);
    }
    if (ok) mapping = m;
  }
  const trackOf = (c: Clip) => mapping.get(c.trackId)!;
  const items = moving.map((c) => ({ start: c.start, duration: c.duration, trackId: trackOf(c) }));

  if (ops.nearestFreeDelta(project, items, d0, ignore, 0) !== null) {
    return { ghosts: ghosts(moving, d0, trackOf), newTrack: null, valid: true, outcome: 'exact' };
  }
  const near = ops.nearestFreeDelta(project, items, d0, ignore, NEAR_SLOT_PX / opts.zoom);
  if (near !== null) return { ghosts: ghosts(moving, near, trackOf), newTrack: null, valid: true, outcome: 'shifted' };
  const targets = new Set(items.map((i) => i.trackId));
  if (targets.size === 1) {
    const t = getTrack(project, [...targets][0]!)!;
    const types = new Set(moving.map((c) => c.type));
    const kind = acceptsAll(t, types) ? t.kind : DEFAULT_TRACK_KIND[anchor.type];
    return {
      ghosts: ghosts(moving, d0, () => null),
      newTrack: { kind, order: newTrackOrder(project, kind, t) },
      valid: true,
      outcome: 'new-track',
    };
  }
  const far = ops.nearestFreeDelta(project, items, d0, ignore);
  if (far !== null) return { ghosts: ghosts(moving, far, trackOf), newTrack: null, valid: true, outcome: 'shifted' };
  return { ...rejected, ghosts: ghosts(moving, d0, trackOf) };
}

/**
 * Plans inserting a NEW clip (media / template drop) of `clip.type` and
 * `clip.duration` with the pointer at `hit` (clip.start is ignored).
 * An incompatible or locked hovered track redirects to the nearest compatible
 * track (in display order) where the slot is free, else a new track.
 */
export function planInsert(project: Project, clip: Clip, hit: Hit, zoom: number): Plan {
  const kind = DEFAULT_TRACK_KIND[clip.type];
  const start = Math.max(0, hit.time);
  const item = { ...clip, start } as Clip;
  const onNew = (where: 'top' | 'bottom' | Track): Plan => {
    const k = typeof where === 'object' && trackAccepts(where, clip.type) ? where.kind : kind;
    return {
      ghosts: [{ clip: item, start, trackId: null }],
      newTrack: { kind: k, order: newTrackOrder(project, k, where) },
      valid: true,
      outcome: 'new-track',
    };
  };
  if (hit.zone) return onNew(hit.zone);
  let track = hit.trackId ? getTrack(project, hit.trackId) : undefined;
  if (!track) return onNew('bottom');
  const fitsAt = (t: Track, d: number, max: number) =>
    ops.nearestFreeDelta(project, [{ start, duration: clip.duration, trackId: t.id }], d, new Set(), max);
  if (track.locked || !trackAccepts(track, clip.type)) {
    const display = displayTracks(project);
    const i0 = display.findIndex((t) => t.id === track!.id);
    const compatible = display
      .map((t, i) => ({ t, dist: Math.abs(i - i0) }))
      .filter(({ t }) => !t.locked && trackAccepts(t, clip.type))
      .sort((a, b) => a.dist - b.dist)
      .map(({ t }) => t);
    const free = compatible.find((t) => fitsAt(t, 0, 0) !== null);
    if (free) return { ghosts: [{ clip: item, start, trackId: free.id }], newTrack: null, valid: true, outcome: 'shifted' };
    if (!compatible[0]) return onNew(kind === 'audio' ? 'bottom' : 'top');
    track = compatible[0];
  }
  if (fitsAt(track, 0, 0) !== null) return { ghosts: [{ clip: item, start, trackId: track.id }], newTrack: null, valid: true, outcome: 'exact' };
  const near = fitsAt(track, 0, NEAR_SLOT_PX / zoom);
  if (near !== null) return { ghosts: [{ clip: item, start: start + near, trackId: track.id }], newTrack: null, valid: true, outcome: 'shifted' };
  return onNew(track);
}
