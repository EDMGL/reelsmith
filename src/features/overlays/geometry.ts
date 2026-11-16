/**
 * Geometry of visual clips on the canvas — the SAME rules the renderers use:
 * - video/image: contain-fit of the asset's pixel size, times transform.scale
 * - text: `layoutTextClip` box (incl. background padding), times transform.scale
 * All values are project px.
 */
import {
  containSize,
  getActiveClipsAt,
  isVisualClip,
  type Clip,
  type Id,
  type Project,
  type Track,
  type VisualClip,
} from '../../core';
import { layoutTextClip } from '../text/renderText';
import type { MeasureFn } from '../text/textLayout';

export interface Point {
  x: number;
  y: number;
}

export interface ClipBox {
  /** Center in project px. */
  cx: number;
  cy: number;
  /** UNSCALED content size (local coordinates). */
  width: number;
  height: number;
  scale: number;
  /** Degrees clockwise. */
  rotation: number;
}

/** Unscaled content size of a visual clip, or null if unknown (missing asset). */
export function contentSize(clip: VisualClip, project: Project, measure: MeasureFn): { width: number; height: number } | null {
  if (clip.type === 'text') {
    const l = layoutTextClip(clip, project.width, measure);
    return { width: l.boxWidth, height: l.boxHeight };
  }
  const asset = project.assets[clip.assetId];
  if (!asset || asset.width <= 0 || asset.height <= 0) return null;
  return containSize(asset.width, asset.height, project.width, project.height);
}

export function clipBox(clip: VisualClip, project: Project, measure: MeasureFn): ClipBox | null {
  const size = contentSize(clip, project, measure);
  if (!size) return null;
  const t = clip.transform;
  return { cx: t.x * project.width, cy: t.y * project.height, width: size.width, height: size.height, scale: t.scale, rotation: t.rotation };
}

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Maps a canvas point into the box's local, unscaled frame (origin at the center). */
export function toLocal(box: ClipBox, p: Point): Point {
  const dx = p.x - box.cx;
  const dy = p.y - box.cy;
  const r = -rad(box.rotation);
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const s = box.scale || 1e-9;
  return { x: (dx * cos - dy * sin) / s, y: (dx * sin + dy * cos) / s };
}

/** Maps a local (unscaled, centered) point to canvas px. */
export function toCanvas(box: ClipBox, p: Point): Point {
  const r = rad(box.rotation);
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const x = p.x * box.scale;
  const y = p.y * box.scale;
  return { x: box.cx + x * cos - y * sin, y: box.cy + x * sin + y * cos };
}

/** Corners in canvas px: top-left, top-right, bottom-right, bottom-left. */
export function boxCorners(box: ClipBox): [Point, Point, Point, Point] {
  const w = box.width / 2;
  const h = box.height / 2;
  return [toCanvas(box, { x: -w, y: -h }), toCanvas(box, { x: w, y: -h }), toCanvas(box, { x: w, y: h }), toCanvas(box, { x: -w, y: h })];
}

/** Axis-aligned bounds of the (rotated, scaled) box in canvas px. */
export function boxAabb(box: ClipBox): { left: number; top: number; right: number; bottom: number } {
  const c = boxCorners(box);
  const xs = c.map((p) => p.x);
  const ys = c.map((p) => p.y);
  return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
}

/** True if canvas point `p` lies inside the box (tolerance in canvas px). */
export function hitTestBox(box: ClipBox, p: Point, tolerance = 0): boolean {
  const l = toLocal(box, p);
  const tol = tolerance / Math.max(1e-9, Math.abs(box.scale));
  return Math.abs(l.x) <= box.width / 2 + tol && Math.abs(l.y) <= box.height / 2 + tol;
}

export interface VisualHit {
  clip: VisualClip;
  track: Track;
  box: ClipBox;
}

/**
 * Visual clips drawn at time `t`, topmost first. Hidden tracks are skipped
 * (not rendered); locked tracks are skipped unless `includeLocked`.
 */
export function visualClipsAt(project: Project, t: number, measure: MeasureFn, includeLocked = false): VisualHit[] {
  const out: VisualHit[] = [];
  for (const { clip, track } of getActiveClipsAt(project, t)) {
    if (!isVisualClip(clip) || (track.locked && !includeLocked)) continue;
    const box = clipBox(clip, project, measure);
    if (box) out.push({ clip, track, box });
  }
  return out.reverse();
}

/** Topmost selectable visual clip under canvas point `p`, or null. `prefer` wins if it is under the point. */
export function hitTestClips(project: Project, t: number, p: Point, measure: MeasureFn, prefer?: Id | null, tolerance = 0): VisualHit | null {
  const hits = visualClipsAt(project, t, measure).filter((h) => hitTestBox(h.box, p, tolerance));
  if (prefer) {
    const pref = hits.find((h) => h.clip.id === prefer);
    if (pref) return pref;
  }
  return hits[0] ?? null;
}

/** True if a clip is a visual clip (narrowing helper for callers holding a generic Clip). */
export function asVisual(clip: Clip | undefined | null): VisualClip | null {
  return clip && isVisualClip(clip) ? clip : null;
}
