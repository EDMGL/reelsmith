/** Pure timeline geometry helpers (unit-tested). */
import { clipEnd, type Id, type Project, type Track, type TrackLayout } from '../../core';

/** Display order of tracks: highest compositing order at the top. */
export function displayTracks(project: Project): Track[] {
  return [...project.tracks].sort((a, b) => b.order - a.order);
}

/** Snap candidates: all clip edges (excluding `exclude`), the playhead and 0. */
export function snapCandidates(project: Project, exclude: ReadonlySet<Id>, playhead: number): number[] {
  const out = [0, playhead];
  for (const c of Object.values(project.clips)) {
    if (exclude.has(c.id)) continue;
    out.push(c.start, clipEnd(c));
  }
  return out;
}

/** Width of the scrollable timeline content in px. */
export function contentWidthPx(duration: number, zoom: number, viewportPx: number): number {
  return Math.max(viewportPx, (duration + 30) * zoom);
}

/** Zoom that fits `duration` into `viewportPx` (with a small margin). */
export function fitZoom(duration: number, viewportPx: number): number {
  if (duration <= 0 || viewportPx <= 0) return 60;
  return (viewportPx * 0.92) / duration;
}

/**
 * Clips touched by a selection box: time range [t0, t1] (any order) and
 * vertical range [y0, y1] in rows coordinates, against the track layout.
 */
export function clipsInBox(project: Project, layout: readonly TrackLayout[], t0: number, t1: number, y0: number, y1: number): Id[] {
  const [ta, tb] = t0 <= t1 ? [t0, t1] : [t1, t0];
  const [ya, yb] = y0 <= y1 ? [y0, y1] : [y1, y0];
  const tracks = new Set(layout.filter((l) => l.top < yb && l.top + l.height > ya).map((l) => l.trackId));
  return Object.values(project.clips)
    .filter((c) => tracks.has(c.trackId) && c.start < tb && clipEnd(c) > ta)
    .sort((a, b) => a.start - b.start)
    .map((c) => c.id);
}
