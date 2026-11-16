import { drawPicture, type ClipRenderer } from '../../core';

/**
 * Canvas renderer for `image` clips: contain-fit baseline (scale 1) inside the
 * logical canvas, then the clip transform, shape and motion (`drawPicture`).
 * Draws nothing until the engine has the decoded frame (`getAssetFrame` returns null).
 */
export const renderImage: ClipRenderer<'image'> = (ctx, clip, localTime, env) => {
  const frame = env.getAssetFrame(clip.assetId, 0);
  if (!frame || frame.width <= 0 || frame.height <= 0) return;
  drawPicture(ctx, clip, localTime, frame.source, frame.width, frame.height, env.canvasWidth, env.canvasHeight, env.isExport);
};
