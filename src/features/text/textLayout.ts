/**
 * Text layout + drawing shared by the text renderer, the subtitle renderer
 * and the transform-handles overlay (hit testing). Keeping ONE layout function
 * guarantees that the selection box matches the drawn pixels.
 *
 * Coordinates: everything is in "local, unscaled" project px with the origin
 * at the CENTER of the text block (the clip transform is applied by the caller
 * via `drawWithTransform`).
 */
import type { Canvas2D, TextStyle } from '../../core';

/** Returns the advance width of `text` drawn with CSS font `font`. */
export type MeasureFn = (text: string, font: string) => number;

/**
 * Text clips wrap at this fraction of the canvas width (in UNSCALED text
 * coordinates, so scaling a clip never reflows it). `TextStyle` has no
 * max-width field, so this is a fixed layout rule.
 */
export const TEXT_WRAP_FRACTION = 0.9;

export interface LaidOutLine {
  text: string;
  width: number;
}

export interface TextLayout {
  lines: LaidOutLine[];
  font: string;
  fontSize: number;
  /** Line advance in px (fontSize * lineHeight). */
  lineAdvance: number;
  /** Width of the widest line. */
  textWidth: number;
  /** lines * lineAdvance. */
  textHeight: number;
  /** Padding of the background box (0 without background). */
  padding: number;
  /** Full block size incl. background padding: what hit-testing and selection use. */
  boxWidth: number;
  boxHeight: number;
}

/** CSS font shorthand for a style. Family is passed through as-is (it may be a stack). */
export function fontString(style: Pick<TextStyle, 'fontFamily' | 'fontSize' | 'fontWeight' | 'italic'>): string {
  const size = Math.max(1, style.fontSize);
  return `${style.italic ? 'italic ' : ''}${Math.round(style.fontWeight)} ${size}px ${style.fontFamily}`;
}

/** Measure function bound to a 2D context (sets `ctx.font` before measuring). */
export function contextMeasure(ctx: Pick<Canvas2D, 'measureText' | 'font'>): MeasureFn {
  return (text, font) => {
    if (ctx.font !== font) ctx.font = font;
    return ctx.measureText(text).width;
  };
}

/** Rough measure for environments without canvas (jsdom): 0.55em per character. */
export function approximateMeasure(text: string, font: string): number {
  const m = /(\d+(?:\.\d+)?)px/.exec(font);
  const size = m ? Number(m[1]) : 16;
  return text.length * size * 0.55;
}

/**
 * Greedy word wrap. Explicit `\n` always breaks. Words longer than `maxWidth`
 * are broken between characters. Whitespace runs inside a line are kept as a
 * single space; trailing spaces at wrap points are dropped.
 */
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const out: string[] = [];
  const limit = maxWidth > 0 ? maxWidth : Infinity;
  for (const para of text.replace(/\r\n?/g, '\n').split('\n')) {
    const words = para.split(/[ \t]+/).filter((w) => w.length > 0);
    if (words.length === 0) {
      out.push('');
      continue;
    }
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate) <= limit) {
        line = candidate;
        continue;
      }
      if (line) out.push(line);
      line = '';
      if (measure(word) <= limit) {
        line = word;
        continue;
      }
      // Break an over-long word character by character.
      let chunk = '';
      for (const ch of Array.from(word)) {
        if (chunk && measure(chunk + ch) > limit) {
          out.push(chunk);
          chunk = ch;
        } else chunk += ch;
      }
      line = chunk;
    }
    out.push(line);
  }
  return out;
}

/** Lays out `text` for `style`, wrapping at `maxWidth` (px, unscaled; <= 0 = no wrap). */
export function layoutText(text: string, style: TextStyle, maxWidth: number, measure: MeasureFn): TextLayout {
  const font = fontString(style);
  const m = (s: string) => measure(s, font);
  const lines = wrapText(text, maxWidth, m).map((t) => ({ text: t, width: t ? m(t) : 0 }));
  const fontSize = Math.max(1, style.fontSize);
  const lineAdvance = fontSize * (style.lineHeight > 0 ? style.lineHeight : 1.2);
  const textWidth = lines.reduce((w, l) => Math.max(w, l.width), 0);
  const textHeight = lines.length * lineAdvance;
  const padding = style.background ? Math.max(0, style.background.padding) : 0;
  // Keep empty text grabbable: at least half an em wide.
  const minW = fontSize * 0.5;
  return {
    lines,
    font,
    fontSize,
    lineAdvance,
    textWidth,
    textHeight,
    padding,
    boxWidth: Math.max(textWidth, minW) + padding * 2,
    boxHeight: textHeight + padding * 2,
  };
}

/** x of a line's anchor (used with the matching `textAlign`) inside a centered block. */
export function lineAnchorX(layout: TextLayout, align: TextStyle['align']): number {
  if (align === 'left') return -layout.textWidth / 2;
  if (align === 'right') return layout.textWidth / 2;
  return 0;
}

/** Vertical center of line `i` (origin = block center). */
export function lineCenterY(layout: TextLayout, i: number): number {
  return -layout.textHeight / 2 + (i + 0.5) * layout.lineAdvance;
}

/** Adds a rounded-rect path (arcTo based, works on every 2D context). */
export function roundedRectPath(ctx: Canvas2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

/**
 * Canvas shadows are NOT affected by the current transform. To render the same
 * picture at any output resolution (preview vs export), map the shadow offset
 * and blur through the current matrix ourselves.
 */
export function applyShadow(ctx: Canvas2D, shadow: NonNullable<TextStyle['shadow']>): void {
  let ox = shadow.offsetX;
  let oy = shadow.offsetY;
  let blur = shadow.blur;
  const getT = (ctx as { getTransform?: () => DOMMatrix }).getTransform;
  if (typeof getT === 'function') {
    const m = getT.call(ctx);
    ox = m.a * shadow.offsetX + m.c * shadow.offsetY;
    oy = m.b * shadow.offsetX + m.d * shadow.offsetY;
    blur = shadow.blur * Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
  }
  ctx.shadowColor = shadow.color;
  ctx.shadowBlur = Math.max(0, blur);
  ctx.shadowOffsetX = ox;
  ctx.shadowOffsetY = oy;
}

export function clearShadow(ctx: Canvas2D): void {
  ctx.shadowColor = 'rgba(0,0,0,0)';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

/**
 * Draws a laid-out text block centered at the current origin.
 * Order: background box (carries the shadow if present) → stroke (outline,
 * drawn at 2x width so the visible part sits outside the glyphs) → fill.
 */
export function drawTextLayout(ctx: Canvas2D, layout: TextLayout, style: TextStyle): void {
  ctx.save();
  let shadowPending = !!style.shadow;
  if (style.background) {
    if (style.shadow) applyShadow(ctx, style.shadow);
    shadowPending = false;
    ctx.fillStyle = style.background.color;
    roundedRectPath(ctx, -layout.boxWidth / 2, -layout.boxHeight / 2, layout.boxWidth, layout.boxHeight, style.background.radius);
    ctx.fill();
    clearShadow(ctx);
  }
  ctx.font = layout.font;
  ctx.textAlign = style.align;
  ctx.textBaseline = 'middle';
  const x = lineAnchorX(layout, style.align);
  const stroke = style.stroke && style.stroke.width > 0 ? style.stroke : null;
  if (stroke) {
    if (shadowPending && style.shadow) applyShadow(ctx, style.shadow);
    shadowPending = false;
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width * 2;
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    layout.lines.forEach((l, i) => l.text && ctx.strokeText(l.text, x, lineCenterY(layout, i)));
    clearShadow(ctx);
  }
  if (shadowPending && style.shadow) applyShadow(ctx, style.shadow);
  ctx.fillStyle = style.color;
  layout.lines.forEach((l, i) => l.text && ctx.fillText(l.text, x, lineCenterY(layout, i)));
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Measuring outside of a render pass (DOM overlay hit-testing)
// ---------------------------------------------------------------------------

let sharedMeasure: MeasureFn | null = null;

/**
 * A measure function backed by an offscreen 2D context (same font engine as
 * the renderers), or `approximateMeasure` where canvas is unavailable (jsdom).
 */
export function getSharedMeasure(): MeasureFn {
  if (sharedMeasure) return sharedMeasure;
  let ctx: Canvas2D | null = null;
  try {
    const isJsdom = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent);
    if (!isJsdom) {
      if (typeof OffscreenCanvas !== 'undefined') ctx = new OffscreenCanvas(1, 1).getContext('2d');
      else if (typeof document !== 'undefined') ctx = document.createElement('canvas').getContext('2d');
    }
  } catch {
    ctx = null;
  }
  sharedMeasure = ctx ? contextMeasure(ctx) : approximateMeasure;
  return sharedMeasure;
}

/** Overrides the shared measure function (tests). Pass null to reset. */
export function setSharedMeasure(fn: MeasureFn | null): void {
  sharedMeasure = fn;
}
