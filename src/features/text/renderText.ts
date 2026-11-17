import { drawWithTransform, type ClipRenderer, type TextClip } from '../../core';
import { TEXT_WRAP_FRACTION, contextMeasure, drawTextLayout, layoutTextCached, type MeasureFn, type TextLayout } from './textLayout';

/** Layout of a text clip (unscaled; the transform scale is applied around it). Cached: read-only result. */
export function layoutTextClip(clip: Pick<TextClip, 'text' | 'style'>, canvasWidth: number, measure: MeasureFn): TextLayout {
  return layoutTextCached(clip.text, clip.style, canvasWidth * TEXT_WRAP_FRACTION, measure);
}

/** Canvas renderer for `text` clips (registered with `registerClipRenderer('text', …)`). */
export const renderText: ClipRenderer<'text'> = (ctx, clip, _localTime, env) => {
  if (!clip.text) return;
  const layout = layoutTextClip(clip, env.canvasWidth, contextMeasure(ctx));
  drawWithTransform(ctx, clip.transform, env.canvasWidth, env.canvasHeight, (c) => drawTextLayout(c, layout, clip.style));
};
