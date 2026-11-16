/**
 * Effect definitions: a small registry local to the effects package, the
 * built-in effects and the one-click filter presets. Pure (no DOM, no React).
 *
 * An `EffectInstance` on a clip stores only `effectType` + `params`; the
 * definition here says what the params mean and how the effect is applied.
 */
import { clamp, createId, type EffectInstance, type EffectParamValue } from '../../core';
import {
  brightnessMatrix,
  contrastMatrix,
  grayscaleMatrix,
  hueRotateMatrix,
  invertMatrix,
  saturateMatrix,
  sepiaMatrix,
  temperatureMatrix,
  type ColorMatrix,
} from './colorMatrix';

export interface EffectParamDef {
  key: string;
  label: string;
  min: number;
  max: number;
  default: number;
  step: number;
  unit?: string;
}

/** Minimal 2D context surface used by overlay strategies (both canvas kinds satisfy it). */
export type OverlayContext = Pick<
  CanvasRenderingContext2D,
  'save' | 'restore' | 'setTransform' | 'fillRect' | 'createRadialGradient' | 'fillStyle' | 'globalCompositeOperation'
>;

/**
 * How an effect is applied (see `apply.ts` for the pipeline order):
 * - 'color': expressible as a CSS filter function (used with `ctx.filter`) AND
 *   as an equivalent color matrix (pixel fallback).
 * - 'blur': gaussian blur, radius in PROJECT pixels (scaled to the target).
 * - 'pixel': color matrix always applied per pixel (no CSS equivalent).
 * - 'overlay': canvas drawing composited `source-atop` onto the clip layer.
 */
export type EffectStrategy =
  | { kind: 'color'; filter(p: ParamValues): string | null; matrix(p: ParamValues): ColorMatrix | null }
  | { kind: 'blur'; radius(p: ParamValues): number }
  | { kind: 'pixel'; matrix(p: ParamValues): ColorMatrix | null }
  | { kind: 'overlay'; isIdentity(p: ParamValues): boolean; draw(ctx: OverlayContext, width: number, height: number, p: ParamValues): void };

export type ParamValues = Record<string, number>;

export interface EffectDefinition {
  id: string;
  label: string;
  icon?: string;
  params: EffectParamDef[];
  strategy: EffectStrategy;
}

const definitions = new Map<string, EffectDefinition>();

export function registerEffect(def: EffectDefinition): () => void {
  definitions.set(def.id, def);
  return () => {
    if (definitions.get(def.id) === def) definitions.delete(def.id);
  };
}

export function getEffectDefinition(id: string): EffectDefinition | undefined {
  return definitions.get(id);
}

export function listEffectDefinitions(): EffectDefinition[] {
  return [...definitions.values()];
}

/** Numeric param values of an instance, falling back to defaults and clamped to the definition range. */
export function resolveParams(def: EffectDefinition, params: Record<string, EffectParamValue>): ParamValues {
  const out: ParamValues = {};
  for (const p of def.params) {
    const raw = params[p.key];
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
    out[p.key] = Number.isFinite(n) ? clamp(n, p.min, p.max) : p.default;
  }
  return out;
}

export function defaultParams(def: EffectDefinition): Record<string, number> {
  return Object.fromEntries(def.params.map((p) => [p.key, p.default]));
}

export function createEffectInstance(effectType: string, params?: Record<string, number>): EffectInstance {
  const def = getEffectDefinition(effectType);
  return {
    id: createId('fx'),
    effectType,
    params: { ...(def ? defaultParams(def) : {}), ...params },
    enabled: true,
  };
}

// ---------------------------------------------------------------------------
// Built-in effects
// ---------------------------------------------------------------------------

const amount = (label = 'Amount', min = -100, max = 100, def = 0, unit = ''): EffectParamDef => ({
  key: 'amount',
  label,
  min,
  max,
  default: def,
  step: 1,
  unit,
});

const fmt = (n: number) => String(Math.round(n * 10000) / 10000);

export const BUILTIN_EFFECTS: EffectDefinition[] = [
  {
    id: 'brightness',
    label: 'Brightness',
    icon: '☀',
    params: [amount()],
    strategy: {
      kind: 'color',
      filter: (p) => (p.amount ? `brightness(${fmt(1 + p.amount! / 100)})` : null),
      matrix: (p) => (p.amount ? brightnessMatrix(1 + p.amount! / 100) : null),
    },
  },
  {
    id: 'contrast',
    label: 'Contrast',
    icon: '◐',
    params: [amount()],
    strategy: {
      kind: 'color',
      filter: (p) => (p.amount ? `contrast(${fmt(1 + p.amount! / 100)})` : null),
      matrix: (p) => (p.amount ? contrastMatrix(1 + p.amount! / 100) : null),
    },
  },
  {
    id: 'saturation',
    label: 'Saturation',
    icon: '◍',
    params: [amount()],
    strategy: {
      kind: 'color',
      filter: (p) => (p.amount ? `saturate(${fmt(1 + p.amount! / 100)})` : null),
      matrix: (p) => (p.amount ? saturateMatrix(1 + p.amount! / 100) : null),
    },
  },
  {
    id: 'hue',
    label: 'Hue rotate',
    icon: '◑',
    params: [{ key: 'amount', label: 'Angle', min: -180, max: 180, default: 0, step: 1, unit: '°' }],
    strategy: {
      kind: 'color',
      filter: (p) => (p.amount ? `hue-rotate(${fmt(p.amount!)}deg)` : null),
      matrix: (p) => (p.amount ? hueRotateMatrix(p.amount!) : null),
    },
  },
  {
    id: 'blur',
    label: 'Blur',
    icon: '◌',
    params: [{ key: 'amount', label: 'Radius', min: 0, max: 60, default: 8, step: 0.5, unit: 'px' }],
    strategy: { kind: 'blur', radius: (p) => p.amount! },
  },
  {
    id: 'grayscale',
    label: 'Grayscale',
    icon: '▨',
    params: [amount('Amount', 0, 100, 100, '%')],
    strategy: {
      kind: 'color',
      filter: (p) => (p.amount ? `grayscale(${fmt(p.amount! / 100)})` : null),
      matrix: (p) => (p.amount ? grayscaleMatrix(p.amount! / 100) : null),
    },
  },
  {
    id: 'sepia',
    label: 'Sepia',
    icon: '▤',
    params: [amount('Amount', 0, 100, 100, '%')],
    strategy: {
      kind: 'color',
      filter: (p) => (p.amount ? `sepia(${fmt(p.amount! / 100)})` : null),
      matrix: (p) => (p.amount ? sepiaMatrix(p.amount! / 100) : null),
    },
  },
  {
    id: 'invert',
    label: 'Invert',
    icon: '◧',
    params: [amount('Amount', 0, 100, 100, '%')],
    strategy: {
      kind: 'color',
      filter: (p) => (p.amount ? `invert(${fmt(p.amount! / 100)})` : null),
      matrix: (p) => (p.amount ? invertMatrix(p.amount! / 100) : null),
    },
  },
  {
    id: 'temperature',
    label: 'Temperature',
    icon: '🌡',
    params: [amount('Warmth')],
    strategy: { kind: 'pixel', matrix: (p) => (p.amount ? temperatureMatrix(p.amount! / 100) : null) },
  },
  {
    id: 'vignette',
    label: 'Vignette',
    icon: '◉',
    params: [
      { key: 'amount', label: 'Strength', min: 0, max: 100, default: 60, step: 1, unit: '%' },
      { key: 'size', label: 'Size', min: 0, max: 100, default: 50, step: 1, unit: '%' },
    ],
    strategy: {
      kind: 'overlay',
      isIdentity: (p) => !p.amount,
      draw: drawVignette,
    },
  },
];

/**
 * Elliptical vignette over the whole frame (`width` x `height`, layer pixels).
 * Drawn `source-atop` so only the clip's own pixels darken.
 */
export function drawVignette(ctx: OverlayContext, width: number, height: number, p: ParamValues): void {
  const strength = clamp((p.amount ?? 0) / 100, 0, 1);
  if (strength <= 0 || width <= 0 || height <= 0) return;
  const size = clamp((p.size ?? 50) / 100, 0, 1);
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  // Unit circle scaled to an ellipse touching the frame corners.
  const rx = (width / 2) * Math.SQRT2;
  const ry = (height / 2) * Math.SQRT2;
  ctx.setTransform(rx, 0, 0, ry, width / 2, height / 2);
  const inner = 0.25 + size * 0.6;
  const g = ctx.createRadialGradient(0, 0, inner * 0.5, 0, 0, 1);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(Math.min(0.999, inner), 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${fmt(strength)})`);
  ctx.fillStyle = g;
  ctx.fillRect(-1, -1, 2, 2);
  ctx.restore();
}

for (const def of BUILTIN_EFFECTS) registerEffect(def);

// ---------------------------------------------------------------------------
// Filter presets
// ---------------------------------------------------------------------------

export interface FilterPreset {
  id: string;
  label: string;
  /** Effects (type + params) the preset sets, in pipeline order. */
  effects: { effectType: string; params: Record<string, number> }[];
}

export const FILTER_PRESETS: FilterPreset[] = [
  {
    id: 'vivid',
    label: 'Vivid',
    effects: [
      { effectType: 'saturation', params: { amount: 45 } },
      { effectType: 'contrast', params: { amount: 15 } },
      { effectType: 'brightness', params: { amount: 4 } },
    ],
  },
  {
    id: 'warm',
    label: 'Warm',
    effects: [
      { effectType: 'temperature', params: { amount: 55 } },
      { effectType: 'saturation', params: { amount: 10 } },
    ],
  },
  {
    id: 'cool',
    label: 'Cool',
    effects: [
      { effectType: 'temperature', params: { amount: -55 } },
      { effectType: 'contrast', params: { amount: 5 } },
    ],
  },
  {
    id: 'bw',
    label: 'B&W',
    effects: [
      { effectType: 'grayscale', params: { amount: 100 } },
      { effectType: 'contrast', params: { amount: 10 } },
    ],
  },
  {
    id: 'vintage',
    label: 'Vintage',
    effects: [
      { effectType: 'sepia', params: { amount: 45 } },
      { effectType: 'contrast', params: { amount: -10 } },
      { effectType: 'saturation', params: { amount: -15 } },
      { effectType: 'vignette', params: { amount: 45, size: 55 } },
    ],
  },
  {
    id: 'fade',
    label: 'Fade',
    effects: [
      { effectType: 'contrast', params: { amount: -30 } },
      { effectType: 'brightness', params: { amount: 8 } },
      { effectType: 'saturation', params: { amount: -25 } },
    ],
  },
  {
    id: 'noir',
    label: 'Noir',
    effects: [
      { effectType: 'grayscale', params: { amount: 100 } },
      { effectType: 'contrast', params: { amount: 45 } },
      { effectType: 'brightness', params: { amount: -10 } },
      { effectType: 'vignette', params: { amount: 70, size: 40 } },
    ],
  },
  {
    id: 'dramatic',
    label: 'Dramatic',
    effects: [
      { effectType: 'contrast', params: { amount: 35 } },
      { effectType: 'saturation', params: { amount: -20 } },
      { effectType: 'temperature', params: { amount: -15 } },
      { effectType: 'vignette', params: { amount: 55, size: 50 } },
    ],
  },
  {
    id: 'sunset',
    label: 'Sunset',
    effects: [
      { effectType: 'temperature', params: { amount: 80 } },
      { effectType: 'hue', params: { amount: -8 } },
      { effectType: 'saturation', params: { amount: 20 } },
    ],
  },
  {
    id: 'dream',
    label: 'Dream',
    effects: [
      { effectType: 'brightness', params: { amount: 10 } },
      { effectType: 'contrast', params: { amount: -15 } },
      { effectType: 'blur', params: { amount: 1.5 } },
      { effectType: 'vignette', params: { amount: 30, size: 70 } },
    ],
  },
];

/** Effect types a preset manages: applying a preset replaces these (blur and others are kept). */
export const PRESET_MANAGED_TYPES: ReadonlySet<string> = new Set([
  'brightness',
  'contrast',
  'saturation',
  'hue',
  'grayscale',
  'sepia',
  'invert',
  'temperature',
  'vignette',
]);

export function getFilterPreset(id: string): FilterPreset | undefined {
  return FILTER_PRESETS.find((p) => p.id === id);
}

/**
 * Returns a new effects list with the preset applied: every preset-managed
 * effect is removed and the preset's effects are appended (fresh ids).
 * Unmanaged effects (e.g. blur) are kept in place. `preset = null` clears the
 * managed effects ("None").
 */
export function applyPresetToEffects(effects: readonly EffectInstance[], preset: FilterPreset | null): EffectInstance[] {
  const kept = effects.filter((e) => !PRESET_MANAGED_TYPES.has(e.effectType));
  if (!preset) return kept;
  return [...kept, ...preset.effects.map((e) => createEffectInstance(e.effectType, e.params))];
}

/** The preset whose managed effects exactly match the clip's (enabled ones), or null. */
export function matchPreset(effects: readonly EffectInstance[]): FilterPreset | null {
  const managed = effects.filter((e) => PRESET_MANAGED_TYPES.has(e.effectType));
  if (managed.length === 0) return null;
  outer: for (const preset of FILTER_PRESETS) {
    if (preset.effects.length !== managed.length) continue;
    for (let i = 0; i < managed.length; i++) {
      const a = managed[i]!;
      const b = preset.effects[i]!;
      if (!a.enabled || a.effectType !== b.effectType) continue outer;
      for (const [k, v] of Object.entries(b.params)) if (a.params[k] !== v) continue outer;
    }
    return preset;
  }
  return null;
}
