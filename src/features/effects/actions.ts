/**
 * Store actions for clip effects. Each exported action is ONE undo step
 * (multi-clip actions run inside a transaction). Slider drags wrap many
 * `setEffectParam` calls in `beginTransaction`/`commitTransaction` (see UI).
 */
import { useEditorStore, type Clip, type ClipPatch, type EffectInstance, type Id } from '../../core';
import {
  applyPresetToEffects,
  createEffectInstance,
  defaultParams,
  getEffectDefinition,
  getFilterPreset,
} from './definitions';

/** Clip types effects can be applied to from the UI. */
export const EFFECT_CLIP_TYPES = ['video', 'image'] as const;

export function supportsEffects(clip: Clip | undefined): clip is Clip {
  return !!clip && (EFFECT_CLIP_TYPES as readonly string[]).includes(clip.type);
}

const S = () => useEditorStore.getState();

function setEffects(clipId: Id, effects: EffectInstance[]): boolean {
  return S().updateClip(clipId, { effects } as ClipPatch);
}

function editClips(label: string, ids: readonly Id[], fn: (clip: Clip) => EffectInstance[] | null): number {
  let changed = 0;
  S().transact(label, () => {
    for (const id of ids) {
      const clip = S().project.clips[id];
      if (!supportsEffects(clip)) continue;
      const next = fn(clip);
      if (next && setEffects(id, next)) changed++;
    }
  });
  return changed;
}

/** Appends a new effect (default params) to every supported clip in `ids`. Returns the number changed. */
export function addEffectToClips(ids: readonly Id[], effectType: string): number {
  if (!getEffectDefinition(effectType)) return 0;
  return editClips('Add effect', ids, (c) => [...c.effects, createEffectInstance(effectType)]);
}

/** Applies a filter preset (null = "None": clears preset-managed effects). */
export function applyPresetToClips(ids: readonly Id[], presetId: string | null): number {
  const preset = presetId ? getFilterPreset(presetId) ?? null : null;
  if (presetId && !preset) return 0;
  return editClips(preset ? `Filter: ${preset.label}` : 'Remove filter', ids, (c) => applyPresetToEffects(c.effects, preset));
}

function updateEffect(clipId: Id, effectId: Id, fn: (e: EffectInstance) => EffectInstance | null): boolean {
  const clip = S().project.clips[clipId];
  if (!clip) return false;
  let found = false;
  const next: EffectInstance[] = [];
  for (const e of clip.effects) {
    if (e.id !== effectId) {
      next.push(e);
      continue;
    }
    found = true;
    const r = fn(e);
    if (r) next.push(r);
  }
  return found && setEffects(clipId, next);
}

/** Sets one param (use inside a transaction for slider drags). */
export function setEffectParam(clipId: Id, effectId: Id, key: string, value: number): boolean {
  return updateEffect(clipId, effectId, (e) => (e.params[key] === value ? e : { ...e, params: { ...e.params, [key]: value } }));
}

export function setEffectEnabled(clipId: Id, effectId: Id, enabled: boolean): boolean {
  return updateEffect(clipId, effectId, (e) => ({ ...e, enabled }));
}

export function removeEffect(clipId: Id, effectId: Id): boolean {
  return updateEffect(clipId, effectId, () => null);
}

/** Resets an effect's params to the definition defaults. */
export function resetEffect(clipId: Id, effectId: Id): boolean {
  return updateEffect(clipId, effectId, (e) => {
    const def = getEffectDefinition(e.effectType);
    return def ? { ...e, params: defaultParams(def), enabled: true } : e;
  });
}

/** Moves an effect up (-1) or down (+1) in the processing order. */
export function moveEffect(clipId: Id, effectId: Id, dir: -1 | 1): boolean {
  const clip = S().project.clips[clipId];
  if (!clip) return false;
  const i = clip.effects.findIndex((e) => e.id === effectId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= clip.effects.length) return false;
  const next = [...clip.effects];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return setEffects(clipId, next);
}

export function clearEffects(clipId: Id): boolean {
  return setEffects(clipId, []);
}
