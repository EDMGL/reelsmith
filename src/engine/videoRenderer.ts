import { clipSourceTime, drawPicture, type ClipRenderer } from '../core';

/**
 * Clip renderer for 'video': the decoded frame at the clip's source time,
 * contain-fit in the logical canvas (scale 1), then the clip transform, shape
 * mask and motion (see `drawPicture`). Opacity/fades/effects are the
 * compositor's job.
 */
export const renderVideoClip: ClipRenderer<'video'> = (ctx, clip, localTime, env) => {
  const sourceTime = clipSourceTime(clip, clip.start + localTime);
  const frame = env.getAssetFrame(clip.assetId, sourceTime);
  if (!frame || frame.width <= 0 || frame.height <= 0) return;
  drawPicture(ctx, clip, localTime, frame.source, frame.width, frame.height, env.canvasWidth, env.canvasHeight, env.isExport);
};
