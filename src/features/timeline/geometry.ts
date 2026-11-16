/** Pure timeline geometry helpers (unit-tested). */
import { clipEnd, type Id, type Project, type Track } from '../../core';

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
