/**
 * Pure math for the transform handles. Inputs/outputs in project px unless
 * noted; transforms use the core convention (x/y = center as canvas fraction).
 */
import type { Transform } from '../../core';
import { boxAabb, type ClipBox, type Point } from './geometry';

export const MIN_SCALE = 0.02;
export const MAX_SCALE = 50;
export const ROTATE_STEP = 15;

export interface Guide {
  axis: 'x' | 'y';
  /** Canvas px position of the guide line (x for vertical lines, y for horizontal). */
  pos: number;
}

export interface SnapResult {
  /** Snapped center, project px. */
  cx: number;
  cy: number;
  guides: Guide[];
}

/**
 * Snaps a box center so that its center or its axis-aligned edges align with
 * the canvas center / edges, independently per axis, within `threshold` px.
 */
export function snapMove(box: ClipBox, canvasW: number, canvasH: number, threshold: number): SnapResult {
  const bb = boxAabb(box);
  const hx = (bb.right - bb.left) / 2;
  const hy = (bb.bottom - bb.top) / 2;
  const axis = (c: number, h: number, size: number, ax: 'x' | 'y') => {
    // [line position, center value that aligns with it]
    const options: [number, number][] = [
      [size / 2, size / 2],
      [0, h],
      [size, size - h],
    ];
    let best: { center: number; line: number; d: number } | null = null;
    for (const [line, center] of options) {
      const d = Math.abs(center - c);
      if (d <= threshold && (!best || d < best.d)) best = { center, line, d };
    }
    return best ? { value: best.center, guide: { axis: ax, pos: best.line } as Guide } : { value: c, guide: null };
  };
  const sx = axis(box.cx, hx, canvasW, 'x');
  const sy = axis(box.cy, hy, canvasH, 'y');
  return { cx: sx.value, cy: sy.value, guides: [sx.guide, sy.guide].filter((g): g is Guide => !!g) };
}

/** New transform after dragging by (dx, dy) project px from `start`, with optional snapping. */
export function moveTransform(
  start: Transform,
  box: Pick<ClipBox, 'width' | 'height'>,
  dx: number,
  dy: number,
  canvasW: number,
  canvasH: number,
  snapThreshold: number,
): { transform: Transform; guides: Guide[] } {
  let cx = start.x * canvasW + dx;
  let cy = start.y * canvasH + dy;
  let guides: Guide[] = [];
  if (snapThreshold > 0) {
    const r = snapMove({ cx, cy, width: box.width, height: box.height, scale: start.scale, rotation: start.rotation }, canvasW, canvasH, snapThreshold);
    cx = r.cx;
    cy = r.cy;
    guides = r.guides;
  }
  return { transform: { ...start, x: cx / canvasW, y: cy / canvasH }, guides };
}

/**
 * Uniform scale about the center: the factor is the ratio of the pointer's
 * distance from the center now vs. at drag start.
 */
export function scaleFromDrag(startScale: number, center: Point, startPointer: Point, pointer: Point): number {
  const d0 = Math.hypot(startPointer.x - center.x, startPointer.y - center.y);
  const d1 = Math.hypot(pointer.x - center.x, pointer.y - center.y);
  if (d0 < 1e-6) return startScale;
  const s = startScale * (d1 / d0);
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

/** Normalizes degrees into (-180, 180]. */
export function normalizeAngle(deg: number): number {
  let a = deg % 360;
  if (a <= -180) a += 360;
  if (a > 180) a -= 360;
  return Object.is(a, -0) ? 0 : a;
}

/**
 * Rotation after dragging the rotate handle: start rotation plus the angle the
 * pointer swept around the center. `step` > 0 quantizes (Shift = 15°);
 * otherwise it magnetically snaps to multiples of 90° within `magnet` degrees.
 */
export function rotationFromDrag(startRotation: number, center: Point, startPointer: Point, pointer: Point, step = 0, magnet = 3): number {
  const a0 = Math.atan2(startPointer.y - center.y, startPointer.x - center.x);
  const a1 = Math.atan2(pointer.y - center.y, pointer.x - center.x);
  let deg = startRotation + ((a1 - a0) * 180) / Math.PI;
  if (step > 0) deg = Math.round(deg / step) * step;
  else if (magnet > 0) {
    const n = Math.round(deg / 90) * 90;
    if (Math.abs(deg - n) <= magnet) deg = n;
  }
  return normalizeAngle(Math.round(deg * 100) / 100);
}

/** Arrow-key nudge: `px` project pixels in a direction. */
export function nudgeTransform(t: Transform, dirX: number, dirY: number, px: number, canvasW: number, canvasH: number): Transform {
  return { ...t, x: t.x + (dirX * px) / canvasW, y: t.y + (dirY * px) / canvasH };
}
