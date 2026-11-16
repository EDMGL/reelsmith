import { containSize, drawWithTransform, type ClipRenderer } from '../../core';

/**
 * Canvas renderer for `image` clips: contain-fit baseline (scale 1) inside the
 * logical canvas, then the clip transform. Draws nothing until the engine has
 * the decoded frame (`getAssetFrame` returns null).
 */
export const renderImage: ClipRenderer<'image'> = (ctx, clip, _localTime, env) => {
  const frame = env.getAssetFrame(clip.assetId, 0);
  if (!frame || frame.width <= 0 || frame.height <= 0) return;
  const { width, height } = containSize(frame.width, frame.height, env.canvasWidth, env.canvasHeight);
  drawWithTransform(ctx, clip.transform, env.canvasWidth, env.canvasHeight, (c) => {
    c.drawImage(frame.source, -width / 2, -height / 2, width, height);
  });
};
