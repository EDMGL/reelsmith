import { resolveSubtitleStyle, type Canvas2D, type ClipRenderer, type Project, type SubtitleClip, type SubtitleStyle, type WordHighlight } from '../../core';
import {
  applyShadow,
  clearShadow,
  contextMeasure,
  drawTextLayout,
  layoutText,
  lineAnchorX,
  lineCenterY,
  roundedRectPath,
  type MeasureFn,
  type TextLayout,
} from '../text/textLayout';
import { activeWordIndex, mapLinePieces, resolveWordTimes, tokenize, wordProgress } from './wordTiming';

/** Minimum distance of the subtitle block from every canvas edge, as a fraction of the smaller side. */
export const SUBTITLE_SAFE_MARGIN = 0.03;

export interface SubtitlePlacement {
  layout: TextLayout;
  style: SubtitleStyle;
  /** Block center, canvas px. */
  cx: number;
  cy: number;
}

/**
 * Layout + position of a subtitle: horizontally centered, block bottom at
 * `bottomMargin` above the canvas bottom, wrapped at `maxWidth`, and clamped
 * inside the safe area.
 */
export function placeSubtitle(project: Project, clip: SubtitleClip, canvasW: number, canvasH: number, measure: MeasureFn): SubtitlePlacement {
  const style = resolveSubtitleStyle(project, clip);
  const safe = Math.min(canvasW, canvasH) * SUBTITLE_SAFE_MARGIN;
  const maxBlock = Math.max(1, canvasW - safe * 2);
  const pad = style.background ? Math.max(0, style.background.padding) : 0;
  const frac = Number.isFinite(style.maxWidth) && style.maxWidth > 0 ? style.maxWidth : 0.85;
  const wrapAt = Math.max(1, Math.min(frac * canvasW, maxBlock) - pad * 2);
  const layout = layoutText(clip.text, style, wrapAt, measure);
  const bottom = canvasH * (1 - (Number.isFinite(style.bottomMargin) ? style.bottomMargin : 0.08));
  let cy = bottom - layout.boxHeight / 2;
  const minCy = safe + layout.boxHeight / 2;
  const maxCy = canvasH - safe - layout.boxHeight / 2;
  cy = maxCy < minCy ? canvasH / 2 : Math.min(maxCy, Math.max(minCy, cy));
  return { layout, style, cx: canvasW / 2, cy };
}

interface Piece {
  text: string;
  word: number;
  /** Left edge x and width (block coordinates, origin = block center). */
  x: number;
  w: number;
  y: number;
}

/** Positions every word piece of a laid-out block (textAlign is handled here, pieces are drawn left-aligned). */
export function layoutPieces(ctx: Pick<Canvas2D, 'measureText'>, layout: TextLayout, style: SubtitleStyle, tokens: readonly string[]): Piece[] {
  const map = mapLinePieces(
    layout.lines.map((l) => l.text),
    tokens,
  );
  const anchor = lineAnchorX(layout, style.align);
  const out: Piece[] = [];
  layout.lines.forEach((line, li) => {
    if (!line.text) return;
    const left = style.align === 'left' ? anchor : style.align === 'right' ? anchor - line.width : anchor - line.width / 2;
    const parts = line.text.split(' ');
    const y = lineCenterY(layout, li);
    let prefix = '';
    parts.forEach((p, j) => {
      const x = left + (prefix ? ctx.measureText(prefix + ' ').width : 0);
      out.push({ text: p, word: map[li]![j]!, x, w: ctx.measureText(p).width, y });
      prefix = prefix ? `${prefix} ${p}` : p;
    });
  });
  return out;
}

/**
 * Makes room for the active word: when it grows ("pop") or gets a box, the
 * other words on its line move apart by the extra width so nothing overlaps.
 */
export function spreadAroundActive(pieces: Piece[], active: number, pop: number, boxPad: number): Piece[] {
  if (active < 0 || (pop <= 1 && boxPad <= 0)) return pieces;
  const out = pieces.map((p) => ({ ...p }));
  const lines = new Set(out.filter((p) => p.word === active).map((p) => p.y));
  for (const y of lines) {
    const row = out.filter((p) => p.y === y);
    const act = row.filter((p) => p.word === active);
    const extra = ((pop - 1) * act.reduce((w, p) => w + p.w, 0)) / 2 + boxPad * pop;
    for (const p of row) {
      if (p.word < active) p.x -= extra;
      else if (p.word > active) p.x += extra;
    }
  }
  return out;
}

/** Draws a block with the active word highlighted. Same layering as `drawTextLayout`: background → highlight box → stroke → fill. */
export function drawHighlightedLayout(ctx: Canvas2D, layout: TextLayout, style: SubtitleStyle, hl: WordHighlight, tokens: readonly string[], active: number, progress: number): void {
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
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const pop = hl.pop > 0 ? hl.pop : 1;
  const padX = layout.fontSize * 0.14;
  const pieces = spreadAroundActive(layoutPieces(ctx, layout, style, tokens), active, pop, hl.mode === 'box' ? padX : 0);
  /** Runs `draw` with the "pop" scale around the piece center for the active word. */
  const withPop = (p: Piece, draw: () => void) => {
    if (p.word !== active || pop === 1) return draw();
    ctx.save();
    ctx.translate(p.x + p.w / 2, p.y);
    ctx.scale(pop, pop);
    ctx.translate(-(p.x + p.w / 2), -p.y);
    draw();
    ctx.restore();
  };

  if (hl.mode === 'box' && active >= 0) {
    const h = layout.fontSize * 1.18;
    for (const p of pieces) {
      if (p.word !== active) continue;
      withPop(p, () => {
        ctx.fillStyle = hl.color;
        roundedRectPath(ctx, p.x - padX, p.y - h / 2, p.w + padX * 2, h, layout.fontSize * 0.22);
        ctx.fill();
      });
    }
  }

  const stroke = style.stroke && style.stroke.width > 0 ? style.stroke : null;
  if (stroke) {
    if (shadowPending && style.shadow) applyShadow(ctx, style.shadow);
    shadowPending = false;
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width * 2;
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    for (const p of pieces) withPop(p, () => ctx.strokeText(p.text, p.x, p.y));
    clearShadow(ctx);
  }
  if (shadowPending && style.shadow) applyShadow(ctx, style.shadow);

  const colorOf = (word: number) => {
    if (hl.mode === 'color') return word === active ? hl.color : style.color;
    if (hl.mode === 'karaoke') return word < active ? hl.color : style.color;
    return style.color;
  };
  for (const p of pieces) {
    withPop(p, () => {
      ctx.fillStyle = colorOf(p.word);
      ctx.fillText(p.text, p.x, p.y);
      if (hl.mode === 'karaoke' && p.word === active && progress > 0) {
        // Fill the active word from left to right as it is spoken.
        ctx.save();
        ctx.beginPath();
        ctx.rect(p.x - 2, p.y - layout.fontSize, (p.w + 4) * progress, layout.fontSize * 2);
        ctx.clip();
        ctx.fillStyle = hl.color;
        ctx.fillText(p.text, p.x, p.y);
        ctx.restore();
      }
    });
  }
  ctx.restore();
}

/** Canvas renderer for `subtitle` clips. */
export const renderSubtitle: ClipRenderer<'subtitle'> = (ctx, clip, localTime, env) => {
  if (!clip.text.trim()) return;
  const { layout, style, cx, cy } = placeSubtitle(env.project, clip, env.canvasWidth, env.canvasHeight, contextMeasure(ctx));
  ctx.save();
  ctx.translate(cx, cy);
  const hl = style.highlight;
  if (hl && hl.mode !== 'none') {
    const times = resolveWordTimes(clip);
    const active = activeWordIndex(times, localTime);
    drawHighlightedLayout(ctx, layout, style, hl, tokenize(clip.text), active, active >= 0 ? wordProgress(times[active]!, localTime) : 0);
  } else {
    drawTextLayout(ctx, layout, style);
  }
  ctx.restore();
};
