/**
 * Shared canvas helpers for clip renderers and compositors. Pure functions,
 * no DOM access beyond the passed context.
 */
import { clipOpacityAt } from './model';
import { getClipRenderer, type Canvas2D, type RenderEnv } from './registry';
import type { Clip, Transform } from './types';

/** Size of content `w x h` scaled to "contain" inside the canvas (scale = 1 baseline for media). */
export function containSize(w: number, h: number, canvasW: number, canvasH: number): { width: number; height: number } {
  if (w <= 0 || h <= 0) return { width: 0, height: 0 };
  const s = Math.min(canvasW / w, canvasH / h);
  return { width: w * s, height: h * s };
}

/**
 * Applies a clip transform and calls `draw` with the context's origin at the
 * clip CENTER (rotation and scale applied). Draw your content centered:
 * `ctx.drawImage(src, -w / 2, -h / 2, w, h)`. Restores the context afterwards.
 */
export function drawWithTransform(
  ctx: Canvas2D,
  transform: Transform,
  canvasWidth: number,
  canvasHeight: number,
  draw: (ctx: Canvas2D) => void,
): void {
  ctx.save();
  ctx.translate(transform.x * canvasWidth, transform.y * canvasHeight);
  if (transform.rotation) ctx.rotate((transform.rotation * Math.PI) / 180);
  if (transform.scale !== 1) ctx.scale(transform.scale, transform.scale);
  draw(ctx);
  ctx.restore();
}

/**
 * Reference implementation of the caller side of the renderer contract:
 * save, opacity (transform x fades), call the registered renderer, restore.
 * Compositors that apply effects can reimplement it. Returns false if no
 * renderer is registered for the clip type or the clip is not active.
 */
export function drawClip(ctx: Canvas2D, clip: Clip, env: RenderEnv): boolean {
  const renderer = getClipRenderer(clip.type);
  const localTime = env.time - clip.start;
  if (!renderer || localTime < 0 || localTime >= clip.duration) return false;
  ctx.save();
  ctx.globalAlpha *= clipOpacityAt(clip, localTime);
  renderer(ctx, clip as never, localTime, env);
  ctx.restore();
  return true;
}
