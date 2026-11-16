/**
 * Frame compositor: draws the project at time `t` into a 2D context. Pure
 * apart from the injected frame/layer providers, so it is unit-testable with
 * fake contexts. Synchronous: the engine decodes every needed frame first.
 */
import {
  clipOpacityAt,
  getClipRenderer,
  type AssetFrame,
  type Canvas2D,
  type Clip,
  type Id,
  type Project,
  type RenderEnv,
} from '../core';
import { applyEffectPlan, buildEffectPlan, type LayerContext } from '../features/effects/apply';
import { visibleClipsAt } from './timeline';

/** An offscreen surface the size of the target, used for clips with effects. */
export interface LayerSurface {
  canvas: CanvasImageSource;
  ctx: Canvas2D;
}

export interface CompositorDeps {
  /** Frame of `assetId` at `sourceTime` for the given clip (or null if not decoded). */
  frameFor(clip: Clip, assetId: Id, sourceTime: number): AssetFrame | null;
  /** A cleared-by-caller layer of exactly `width` x `height` px (null = draw effects-less). */
  getLayer(width: number, height: number): LayerSurface | null;
  /** Force filter (true) / pixel fallback (false); undefined = auto-detect. */
  useFilter?: boolean;
  /** Called when a clip renderer throws (the frame continues). */
  onRendererError?(clip: Clip, error: unknown): void;
}

export interface CompositeOptions {
  /** Target size in px. */
  width: number;
  height: number;
  isExport: boolean;
}

/**
 * Draws background + all visible tracks bottom-up. Each clip: opacity =
 * transform opacity x fades (clipOpacityAt), effects through a layer, the
 * logical project canvas mapped onto `width` x `height`.
 */
export function compositeFrame(ctx: Canvas2D, project: Project, t: number, opts: CompositeOptions, deps: CompositorDeps): void {
  const W = Math.max(1, Math.round(opts.width));
  const H = Math.max(1, Math.round(opts.height));
  const pw = Math.max(1, project.width);
  const ph = Math.max(1, project.height);
  const sx = W / pw;
  const sy = H / ph;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  if ('filter' in ctx) ctx.filter = 'none';
  ctx.clearRect(0, 0, W, H);
  ctx.setTransform(sx, 0, 0, sy, 0, 0);
  ctx.fillStyle = project.backgroundColor || '#000000';
  ctx.fillRect(0, 0, pw, ph);

  for (const { clip, track } of visibleClipsAt(project, t)) {
    const renderer = getClipRenderer(clip.type);
    if (!renderer) continue;
    const localTime = Math.min(Math.max(0, t - clip.start), Math.max(0, clip.duration - 1e-9));
    const opacity = clipOpacityAt(clip, localTime);
    if (!(opacity > 0)) continue;
    const env: RenderEnv = {
      project,
      track,
      canvasWidth: pw,
      canvasHeight: ph,
      time: t,
      isExport: opts.isExport,
      getAsset: (id) => project.assets[id],
      getAssetFrame: (assetId, sourceTime) => deps.frameFor(clip, assetId, sourceTime),
    };
    const run = (c: Canvas2D) => {
      try {
        renderer(c, clip as never, localTime, env);
      } catch (e) {
        deps.onRendererError?.(clip, e);
      }
    };

    const plan = buildEffectPlan(clip.effects, Math.min(sx, sy));
    const layer = plan ? deps.getLayer(W, H) : null;
    if (!plan || !layer) {
      ctx.save();
      ctx.globalAlpha *= opacity;
      run(ctx);
      ctx.restore();
      continue;
    }

    const lc = layer.ctx;
    lc.save();
    lc.setTransform(1, 0, 0, 1, 0, 0);
    lc.globalAlpha = 1;
    lc.globalCompositeOperation = 'source-over';
    if ('filter' in lc) lc.filter = 'none';
    lc.clearRect(0, 0, W, H);
    lc.setTransform(sx, 0, 0, sy, 0, 0);
    run(lc);
    lc.restore();
    const filter = applyEffectPlan(lc as unknown as LayerContext, W, H, plan, deps.useFilter);

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = opacity;
    if (filter !== 'none') ctx.filter = filter;
    ctx.drawImage(layer.canvas, 0, 0, W, H);
    ctx.restore();
  }
  ctx.restore();
}
