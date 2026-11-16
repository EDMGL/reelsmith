import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClipFromAsset, createProject, createTextClip, useEditorStore, type EffectInstance, type VideoClip } from '../../../core';
import { makeAsset } from '../../../core/__tests__/fixtures';
import { addEffectToClips, applyPresetToClips, removeEffect, resetEffect, setEffectEnabled, setEffectParam } from '../actions';
import { applyEffectPlan, buildEffectPlan, effectsToFilterString, planFilterString, setCanvasFilterOverride } from '../apply';
import {
  applyMatrixToRgb,
  boxesForGauss,
  contrastMatrix,
  gaussianBlurPixels,
  grayscaleMatrix,
  hueRotateMatrix,
  invertMatrix,
  saturateMatrix,
  sepiaMatrix,
  temperatureMatrix,
} from '../colorMatrix';
import {
  BUILTIN_EFFECTS,
  FILTER_PRESETS,
  applyPresetToEffects,
  createEffectInstance,
  getEffectDefinition,
  matchPreset,
  resolveParams,
} from '../definitions';

const fx = (effectType: string, params: Record<string, number> = {}, enabled = true): EffectInstance => ({
  ...createEffectInstance(effectType, params),
  enabled,
});

describe('effect definitions', () => {
  it('has the required effects with sane param ranges', () => {
    const ids = BUILTIN_EFFECTS.map((d) => d.id);
    for (const id of ['brightness', 'contrast', 'saturation', 'hue', 'blur', 'grayscale', 'sepia', 'invert', 'vignette', 'temperature']) {
      expect(ids).toContain(id);
    }
    for (const d of BUILTIN_EFFECTS) {
      for (const p of d.params) {
        expect(p.min).toBeLessThan(p.max);
        expect(p.default).toBeGreaterThanOrEqual(p.min);
        expect(p.default).toBeLessThanOrEqual(p.max);
        expect(p.step).toBeGreaterThan(0);
      }
    }
  });

  it('resolves params with defaults and clamping', () => {
    const def = getEffectDefinition('brightness')!;
    expect(resolveParams(def, {})).toEqual({ amount: 0 });
    expect(resolveParams(def, { amount: 500 })).toEqual({ amount: 100 });
    expect(resolveParams(def, { amount: '25' })).toEqual({ amount: 25 });
  });
});

describe('effect -> filter string mapping', () => {
  it('maps effects in order to CSS filter functions', () => {
    const list = [
      fx('brightness', { amount: 20 }),
      fx('contrast', { amount: -50 }),
      fx('saturation', { amount: 100 }),
      fx('hue', { amount: 90 }),
      fx('grayscale', { amount: 50 }),
      fx('sepia', { amount: 100 }),
      fx('invert', { amount: 25 }),
      fx('blur', { amount: 4 }),
    ];
    expect(effectsToFilterString(list)).toBe(
      'brightness(1.2) contrast(0.5) saturate(2) hue-rotate(90deg) grayscale(0.5) sepia(1) invert(0.25) blur(4px)',
    );
    expect(effectsToFilterString([fx('blur', { amount: 10 })], 0.25)).toBe('blur(2.5px)');
  });

  it('skips disabled, unknown and identity effects', () => {
    expect(buildEffectPlan([fx('brightness', { amount: 0 }), fx('blur', { amount: 5 }, false), { id: 'x', effectType: 'nope', params: {}, enabled: true }])).toBeNull();
    expect(buildEffectPlan([])).toBeNull();
    expect(buildEffectPlan(undefined)).toBeNull();
  });

  it('keeps pixel-only and overlay effects out of the filter string', () => {
    const plan = buildEffectPlan([fx('temperature', { amount: 50 }), fx('vignette'), fx('contrast', { amount: 10 })])!;
    expect(plan.pixelMatrices).toHaveLength(1);
    expect(plan.overlays.map((o) => o.def.id)).toEqual(['vignette']);
    expect(planFilterString(plan)).toBe('contrast(1.1)');
  });
});

describe('fallback color matrices match the CSS filter definitions', () => {
  const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 3));
  it('implements the standard primitives', () => {
    close(applyMatrixToRgb(invertMatrix(1), 1, 0, 0.25), [0, 1, 0.75]);
    close(applyMatrixToRgb(contrastMatrix(2), 0.75, 0.5, 0.25), [1, 0.5, 0]);
    close(applyMatrixToRgb(saturateMatrix(0), 1, 0, 0), [0.213, 0.213, 0.213]);
    close(applyMatrixToRgb(grayscaleMatrix(1), 0, 1, 0), [0.7152, 0.7152, 0.7152]);
    close(applyMatrixToRgb(sepiaMatrix(1), 1, 1, 1), [1, 1, 0.937]);
    close(applyMatrixToRgb(hueRotateMatrix(0), 0.2, 0.4, 0.6), [0.2, 0.4, 0.6]);
    close(applyMatrixToRgb(hueRotateMatrix(360), 0.2, 0.4, 0.6), [0.2, 0.4, 0.6]);
    const warm = applyMatrixToRgb(temperatureMatrix(1), 0.5, 0.5, 0.5);
    expect(warm[0]).toBeGreaterThan(0.5);
    expect(warm[2]).toBeLessThan(0.5);
  });

  it('applies the pixel fallback chain to a layer (getImageData/putImageData) and returns no filter', () => {
    const plan = buildEffectPlan([fx('grayscale', { amount: 100 }), fx('brightness', { amount: -50 })])!;
    const pixels = new Uint8ClampedArray([255, 0, 0, 255]);
    const calls: string[] = [];
    const layer = {
      save: () => calls.push('save'),
      restore: () => calls.push('restore'),
      setTransform: () => undefined,
      getImageData: () => (calls.push('get'), { data: pixels }),
      putImageData: () => calls.push('put'),
    };
    const filter = applyEffectPlan(layer as never, 1, 1, plan, false);
    expect(filter).toBe('none');
    expect(calls).toEqual(['save', 'get', 'put', 'restore']);
    // grayscale(1) of pure red = 0.2126 -> x0.5 brightness
    expect(pixels[0]).toBe(Math.round(0.2126 * 0.5 * 255));
    expect(pixels[0]).toBe(pixels[1]);
    expect(pixels[3]).toBe(255);
  });

  it('uses ctx.filter (no pixel reads) when supported, still baking pixel-only effects', () => {
    const calls: string[] = [];
    const layer = {
      save: () => undefined,
      restore: () => undefined,
      setTransform: () => undefined,
      getImageData: () => (calls.push('get'), { data: new Uint8ClampedArray(4) }),
      putImageData: () => calls.push('put'),
    };
    expect(applyEffectPlan(layer as never, 1, 1, buildEffectPlan([fx('sepia', { amount: 100 })])!, true)).toBe('sepia(1)');
    expect(calls).toEqual([]);
    applyEffectPlan(layer as never, 1, 1, buildEffectPlan([fx('temperature', { amount: 30 })])!, true);
    expect(calls).toEqual(['get', 'put']);
  });

  it('blur fallback approximates a gaussian and keeps mass', () => {
    expect(boxesForGauss(3)).toHaveLength(3);
    const w = 21;
    const center = (10 * w + 10) * 4;
    const data = new Uint8ClampedArray(w * w * 4);
    // A 3x3 white square in the middle.
    for (let y = 9; y <= 11; y++) for (let x = 9; x <= 11; x++) data.set([255, 255, 255, 255], (y * w + x) * 4);
    gaussianBlurPixels(data, w, w, 1.5);
    let alpha = 0;
    for (let i = 0; i < w * w; i++) alpha += data[i * 4 + 3]!;
    expect(alpha).toBeGreaterThan(9 * 255 * 0.9);
    expect(alpha).toBeLessThan(9 * 255 * 1.1);
    expect(data[center + 3]!).toBeLessThan(255);
    expect(data[center]!).toBe(255); // color preserved (premultiplied blur)
  });
});

describe('filter presets', () => {
  it('has at least 8 presets referencing known effects', () => {
    expect(FILTER_PRESETS.length).toBeGreaterThanOrEqual(8);
    for (const p of FILTER_PRESETS) for (const e of p.effects) expect(getEffectDefinition(e.effectType)).toBeDefined();
    for (const name of ['Vivid', 'Warm', 'Cool', 'B&W', 'Vintage', 'Fade', 'Noir', 'Dramatic']) {
      expect(FILTER_PRESETS.map((p) => p.label)).toContain(name);
    }
  });

  it('replaces managed effects, keeps blur, and is recognised afterwards', () => {
    const blur = fx('blur', { amount: 3 });
    const start = [fx('brightness', { amount: 40 }), blur];
    const noir = FILTER_PRESETS.find((p) => p.id === 'noir')!;
    const next = applyPresetToEffects(start, noir);
    expect(next[0]).toBe(blur);
    expect(next.slice(1).map((e) => e.effectType)).toEqual(noir.effects.map((e) => e.effectType));
    expect(matchPreset(next)?.id).toBe('noir');
    const vivid = applyPresetToEffects(next, FILTER_PRESETS[0]!);
    expect(matchPreset(vivid)?.id).toBe('vivid');
    expect(applyPresetToEffects(vivid, null)).toEqual([blur]);
    expect(matchPreset([blur])).toBeNull();
  });
});

describe('effect store actions', () => {
  const S = () => useEditorStore.getState();
  let clipId = '';
  beforeEach(() => {
    const p = createProject();
    const v = p.tracks.find((t) => t.kind === 'video')!.id;
    const asset = makeAsset('vid', 10);
    const clip = { ...(createClipFromAsset(asset, { trackId: v, start: 0 }) as VideoClip), id: 'c1' };
    const text = { ...createTextClip({ trackId: v, start: 20 }), id: 'txt' };
    S().loadProject({ ...p, assets: { vid: asset }, clips: { c1: clip, txt: text } });
    clipId = 'c1';
  });
  afterEach(() => setCanvasFilterOverride(null));

  it('adds effects / presets to supported clips as one undo step each', () => {
    expect(addEffectToClips([clipId, 'txt'], 'blur')).toBe(1); // text clips are not targeted from the UI
    expect(S().project.clips[clipId]!.effects.map((e) => e.effectType)).toEqual(['blur']);
    expect(S().past).toHaveLength(1);
    applyPresetToClips([clipId], 'vivid');
    expect(S().past).toHaveLength(2);
    expect(matchPreset(S().project.clips[clipId]!.effects)?.id).toBe('vivid');
    S().undo();
    expect(S().project.clips[clipId]!.effects.map((e) => e.effectType)).toEqual(['blur']);
  });

  it('a slider drag inside a transaction is a single undo step', () => {
    addEffectToClips([clipId], 'brightness');
    const id = S().project.clips[clipId]!.effects[0]!.id;
    const before = S().past.length;
    S().beginTransaction('Adjust');
    for (let v = 1; v <= 30; v++) setEffectParam(clipId, id, 'amount', v);
    S().commitTransaction();
    expect(S().past.length).toBe(before + 1);
    expect(S().project.clips[clipId]!.effects[0]!.params.amount).toBe(30);
    S().undo();
    expect(S().project.clips[clipId]!.effects[0]!.params.amount).toBe(0);
  });

  it('toggles, resets and removes', () => {
    addEffectToClips([clipId], 'vignette');
    const id = S().project.clips[clipId]!.effects[0]!.id;
    setEffectParam(clipId, id, 'amount', 10);
    setEffectEnabled(clipId, id, false);
    expect(S().project.clips[clipId]!.effects[0]).toMatchObject({ enabled: false, params: { amount: 10 } });
    resetEffect(clipId, id);
    expect(S().project.clips[clipId]!.effects[0]).toMatchObject({ enabled: true, params: { amount: 60, size: 50 } });
    removeEffect(clipId, id);
    expect(S().project.clips[clipId]!.effects).toEqual([]);
  });
});
