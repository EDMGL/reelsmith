import { resolveSubtitleStyle, type ClipRenderer, type Project, type SubtitleClip, type SubtitleStyle } from '../../core';
import { contextMeasure, drawTextLayout, layoutText, type MeasureFn, type TextLayout } from '../text/textLayout';

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

/** Canvas renderer for `subtitle` clips. */
export const renderSubtitle: ClipRenderer<'subtitle'> = (ctx, clip, _localTime, env) => {
  if (!clip.text.trim()) return;
  const { layout, style, cx, cy } = placeSubtitle(env.project, clip, env.canvasWidth, env.canvasHeight, contextMeasure(ctx));
  ctx.save();
  ctx.translate(cx, cy);
  drawTextLayout(ctx, layout, style);
  ctx.restore();
};
