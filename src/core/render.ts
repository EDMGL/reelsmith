/**
 * Shared canvas helpers for clip renderers and compositors. Pure functions,
 * no DOM access beyond the passed context.
 */
import { clipOpacityAt } from './model';
import { getClipRenderer, type Canvas2D, type RenderEnv } from './registry';
import type { Clip, ClipMotion, ClipShape, Transform } from './types';

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

const smoothstep = (t: number) => t * t * (3 - 2 * t);

/** Zoom factor and zoom center (fraction of the picture) of a motion at `localTime`. */
export function motionAt(motion: ClipMotion | undefined, localTime: number, clipDuration: number): { zoom: number; fx: number; fy: number } {
  if (!motion || motion.preset === 'none') return { zoom: 1, fx: 0.5, fy: 0.5 };
  const amount = Math.max(1, Number.isFinite(motion.amount) ? motion.amount : 1);
  const span = motion.duration > 0 ? Math.min(motion.duration, clipDuration) : clipDuration;
  const p = span > 0 ? Math.min(1, Math.max(0, localTime / span)) : 1;
  const e = smoothstep(p);
  const fx = Math.min(1, Math.max(0, motion.focusX));
  const fy = Math.min(1, Math.max(0, motion.focusY));
  switch (motion.preset) {
    case 'zoom-in':
      return { zoom: 1 + (amount - 1) * e, fx, fy };
    case 'zoom-out':
      return { zoom: amount - (amount - 1) * e, fx, fy };
    case 'punch-in':
      return { zoom: amount, fx, fy };
    case 'pan-left':
      return { zoom: amount, fx: 0.8 - 0.6 * e, fy };
    case 'pan-right':
      return { zoom: amount, fx: 0.2 + 0.6 * e, fy };
    default:
      return { zoom: 1, fx: 0.5, fy: 0.5 };
  }
}

function shapePath(ctx: Canvas2D, shape: ClipShape, w: number, h: number): void {
  ctx.beginPath();
  if (shape.kind === 'circle') {
    ctx.arc(0, 0, Math.min(w, h) / 2, 0, Math.PI * 2);
  } else {
    const r = shape.kind === 'rounded' ? Math.max(0, Math.min(0.5, shape.radius)) * Math.min(w, h) : 0;
    const x = -w / 2;
    const y = -h / 2;
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
  }
  ctx.closePath();
}

/**
 * Draws a picture (video frame / image) contain-fit at scale 1, with the clip
 * transform, its shape mask + outline, and its motion (zoom inside the frame,
 * around the motion's focus point so the picture keeps covering its frame).
 */
export function drawPicture(
  ctx: Canvas2D,
  clip: { transform: Transform; motion?: ClipMotion; shape?: ClipShape; duration: number },
  localTime: number,
  source: CanvasImageSource,
  sourceW: number,
  sourceH: number,
  canvasWidth: number,
  canvasHeight: number,
  highQuality = false,
): void {
  const { width: w, height: h } = containSize(sourceW, sourceH, canvasWidth, canvasHeight);
  if (w <= 0 || h <= 0) return;
  const shape = clip.shape && clip.shape.kind !== 'rect' ? clip.shape : clip.shape?.border ? clip.shape : undefined;
  const { zoom, fx, fy } = motionAt(clip.motion, localTime, clip.duration);
  drawWithTransform(ctx, clip.transform, canvasWidth, canvasHeight, (c) => {
    c.imageSmoothingEnabled = true;
    if (highQuality) c.imageSmoothingQuality = 'high';
    c.save();
    if (shape) {
      shapePath(c, shape, w, h);
      c.clip();
    }
    if (zoom !== 1) {
      const ox = (fx - 0.5) * w;
      const oy = (fy - 0.5) * h;
      c.translate(ox, oy);
      c.scale(zoom, zoom);
      c.translate(-ox, -oy);
    }
    c.drawImage(source, -w / 2, -h / 2, w, h);
    c.restore();
    if (shape && shape.border > 0) {
      shapePath(c, shape, w, h);
      c.lineWidth = shape.border / Math.max(0.01, Math.abs(clip.transform.scale));
      c.strokeStyle = shape.borderColor;
      c.stroke();
    }
  });
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
