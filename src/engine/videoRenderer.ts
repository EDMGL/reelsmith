import { clipSourceTime, containSize, drawWithTransform, type ClipRenderer } from '../core';

/**
 * Clip renderer for 'video': the decoded frame at the clip's source time,
 * contain-fit in the logical canvas (scale 1), then the clip transform
 * (x/y = center as canvas fraction, scale, rotation). Opacity/fades/effects
 * are the compositor's job.
 */
export const renderVideoClip: ClipRenderer<'video'> = (ctx, clip, localTime, env) => {
  const sourceTime = clipSourceTime(clip, clip.start + localTime);
  const frame = env.getAssetFrame(clip.assetId, sourceTime);
  if (!frame || frame.width <= 0 || frame.height <= 0) return;
  const { width, height } = containSize(frame.width, frame.height, env.canvasWidth, env.canvasHeight);
  if (width <= 0 || height <= 0) return;
  drawWithTransform(ctx, clip.transform, env.canvasWidth, env.canvasHeight, (c) => {
    c.imageSmoothingEnabled = true;
    if (env.isExport) c.imageSmoothingQuality = 'high';
    c.drawImage(frame.source, -width / 2, -height / 2, width, height);
  });
};
