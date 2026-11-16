/**
 * Effect pipeline used by the compositor (engine). Pure planning + a small
 * canvas-applying step; no React.
 *
 * Pipeline for a clip with active effects (identical order in both paths, so
 * preview and export look the same):
 *   1. the clip is rendered into a transparent layer (target resolution);
 *   2. 'pixel' effects (temperature) are applied to the layer pixels;
 *   3. 'overlay' effects (vignette) are drawn `source-atop` on the layer;
 *   4. the 'color' + 'blur' chain is applied, in the clip's effect order:
 *      - filter path: as a CSS filter string set on `ctx.filter` while the
 *        layer is drawn onto the target;
 *      - fallback path: the equivalent color matrices / gaussian blur applied
 *        to the layer pixels (getImageData), then drawn without a filter.
 *
 * The filter path is used only when `ctx.filter` works on BOTH
 * HTMLCanvasElement and OffscreenCanvas 2D contexts (feature-detected
 * functionally), so a preview canvas and an offscreen export canvas always
 * take the same path.
 */
import type { EffectInstance } from '../../core';
import {
  applyMatricesToPixels,
  gaussianBlurPixels,
  type ColorMatrix,
} from './colorMatrix';
import { getEffectDefinition, resolveParams, type EffectDefinition, type OverlayContext, type ParamValues } from './definitions';

export type PostOp = { type: 'matrix'; matrix: ColorMatrix; css: string } | { type: 'blur'; sigma: number; css: string };

export interface EffectPlan {
  /** Stage 2: per-pixel matrices (no CSS equivalent). */
  pixelMatrices: ColorMatrix[];
  /** Stage 3: overlays. */
  overlays: { def: EffectDefinition; params: ParamValues }[];
  /** Stage 4: color/blur chain in clip order. */
  post: PostOp[];
}

const round = (n: number) => String(Math.round(n * 1000) / 1000);

/**
 * Compiles a clip's effects into a plan. `scale` = target px per project px
 * (blur radii are in project px). Returns null when no enabled effect changes
 * anything (the caller can then draw the clip directly).
 */
export function buildEffectPlan(effects: readonly EffectInstance[] | undefined, scale = 1): EffectPlan | null {
  if (!effects || effects.length === 0) return null;
  const plan: EffectPlan = { pixelMatrices: [], overlays: [], post: [] };
  for (const inst of effects) {
    if (inst.enabled === false) continue;
    const def = getEffectDefinition(inst.effectType);
    if (!def) continue;
    const p = resolveParams(def, inst.params);
    const s = def.strategy;
    switch (s.kind) {
      case 'color': {
        const css = s.filter(p);
        const matrix = s.matrix(p);
        if (css && matrix) plan.post.push({ type: 'matrix', matrix, css });
        break;
      }
      case 'blur': {
        const sigma = s.radius(p) * scale;
        if (sigma > 0.05) plan.post.push({ type: 'blur', sigma, css: `blur(${round(sigma)}px)` });
        break;
      }
      case 'pixel': {
        const m = s.matrix(p);
        if (m) plan.pixelMatrices.push(m);
        break;
      }
      case 'overlay':
        if (!s.isIdentity(p)) plan.overlays.push({ def, params: p });
        break;
    }
  }
  if (plan.pixelMatrices.length === 0 && plan.overlays.length === 0 && plan.post.length === 0) return null;
  return plan;
}

/** CSS filter string of the plan's color/blur chain ('none' if empty). */
export function planFilterString(plan: EffectPlan): string {
  return plan.post.length ? plan.post.map((o) => o.css).join(' ') : 'none';
}

/** Convenience: CSS filter string for a list of effects (used for UI thumbnails). */
export function effectsToFilterString(effects: readonly EffectInstance[], scale = 1): string {
  const plan = buildEffectPlan(effects, scale);
  return plan ? planFilterString(plan) : 'none';
}

// ---------------------------------------------------------------------------
// Feature detection
// ---------------------------------------------------------------------------

let filterSupport: boolean | null = null;
let override: boolean | null = null;

type AnyCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function filterWorks(ctx: AnyCtx | null): boolean {
  if (!ctx || !('filter' in ctx)) return false;
  try {
    ctx.filter = 'invert(1)';
    if (ctx.filter !== 'invert(1)') return false;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 1, 1);
    const px = ctx.getImageData(0, 0, 1, 1).data;
    return px[0]! < 128;
  } catch {
    return false;
  }
}

/**
 * True when `ctx.filter` functionally works on HTMLCanvasElement AND (if the
 * browser has it) OffscreenCanvas. Cached after the first call.
 */
export function canvasFilterSupported(): boolean {
  if (override !== null) return override;
  if (filterSupport !== null) return filterSupport;
  let ok = false;
  try {
    if (typeof document !== 'undefined') {
      const c = document.createElement('canvas');
      c.width = c.height = 1;
      ok = filterWorks(c.getContext('2d', { willReadFrequently: true }));
    } else if (typeof OffscreenCanvas !== 'undefined') {
      ok = true;
    }
    if (ok && typeof OffscreenCanvas !== 'undefined') {
      ok = filterWorks(new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true }));
    }
  } catch {
    ok = false;
  }
  filterSupport = ok;
  return ok;
}

/** Forces the filter (true) or pixel fallback (false) path; null = auto-detect. Tests/debug. */
export function setCanvasFilterOverride(value: boolean | null): void {
  override = value;
}

// ---------------------------------------------------------------------------
// Applying a plan to a layer
// ---------------------------------------------------------------------------

/** The part of a 2D context the effect stage needs. */
export type LayerContext = OverlayContext & Pick<CanvasRenderingContext2D, 'getImageData' | 'putImageData'>;

/**
 * Runs stages 2–4 on a layer of `width` x `height` pixels that already holds
 * the rendered clip. Returns the CSS filter to set on the target context while
 * drawing the layer ('none' when the chain was baked into the pixels).
 */
export function applyEffectPlan(
  layer: LayerContext,
  width: number,
  height: number,
  plan: EffectPlan,
  useFilter: boolean = canvasFilterSupported(),
): string {
  if (width <= 0 || height <= 0) return 'none';
  layer.save();
  layer.setTransform(1, 0, 0, 1, 0, 0);
  if (plan.pixelMatrices.length) {
    const img = layer.getImageData(0, 0, width, height);
    applyMatricesToPixels(img.data, plan.pixelMatrices);
    layer.putImageData(img, 0, 0);
  }
  for (const o of plan.overlays) {
    if (o.def.strategy.kind === 'overlay') o.def.strategy.draw(layer, width, height, o.params);
  }
  let filter = 'none';
  if (plan.post.length) {
    if (useFilter) filter = planFilterString(plan);
    else {
      const img = layer.getImageData(0, 0, width, height);
      applyPostOpsToPixels(img.data, width, height, plan.post);
      layer.putImageData(img, 0, 0);
    }
  }
  layer.restore();
  return filter;
}

/** Fallback for stage 4: color matrices and blurs in order, on RGBA bytes in place. */
export function applyPostOpsToPixels(data: Uint8ClampedArray, width: number, height: number, ops: readonly PostOp[]): void {
  let batch: ColorMatrix[] = [];
  const flush = () => {
    if (batch.length) applyMatricesToPixels(data, batch);
    batch = [];
  };
  for (const op of ops) {
    if (op.type === 'matrix') batch.push(op.matrix);
    else {
      flush();
      gaussianBlurPixels(data, width, height, op.sigma);
    }
  }
  flush();
}
