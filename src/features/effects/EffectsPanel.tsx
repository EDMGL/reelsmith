import type { CSSProperties } from 'react';
import { useEditorStore, type Clip, type EffectInstance } from '../../core';
import { addEffectToClips, applyPresetToClips, supportsEffects } from './actions';
import { effectsToFilterString } from './apply';
import { FILTER_PRESETS, listEffectDefinitions, matchPreset, type FilterPreset } from './definitions';
import './effects.css';

function thumbStyle(effects: FilterPreset['effects'], thumb: string | undefined): CSSProperties {
  const asInstances = effects.map((e, i) => ({ id: String(i), effectType: e.effectType, params: e.params, enabled: true }) as EffectInstance);
  // Thumbnails are ~1/10 of the canvas: scale blur accordingly.
  const filter = effectsToFilterString(asInstances, 0.1);
  return {
    backgroundImage: thumb ? `url("${thumb}")` : undefined,
    filter: filter === 'none' ? undefined : filter,
  };
}

function overlayStyle(effects: FilterPreset['effects']): CSSProperties | undefined {
  const temp = effects.find((e) => e.effectType === 'temperature')?.params.amount ?? 0;
  const vig = effects.find((e) => e.effectType === 'vignette')?.params.amount ?? 0;
  if (!temp && !vig) return undefined;
  return {
    background: temp
      ? temp > 0
        ? `rgba(255, 150, 40, ${Math.abs(temp) / 400})`
        : `rgba(40, 140, 255, ${Math.abs(temp) / 400})`
      : undefined,
    boxShadow: vig ? `inset 0 0 ${10 + vig / 4}px rgba(0,0,0,${vig / 100})` : undefined,
  };
}

/** Left panel "Effects": one-click filter presets and individual effects for the selected clip(s). */
export default function EffectsPanel() {
  const selectedIds = useEditorStore((s) => s.selectedClipIds);
  const clips = useEditorStore((s) => s.project.clips);
  const assets = useEditorStore((s) => s.project.assets);
  const targets = selectedIds.map((id) => clips[id]).filter(supportsEffects) as Clip[];
  const targetIds = targets.map((c) => c.id);
  const first = targets[0];
  const thumb = first && 'assetId' in first ? assets[first.assetId]?.thumbnail : undefined;
  const active = targets.length === 1 && first ? matchPreset(first.effects) : null;
  const disabled = targets.length === 0;

  return (
    <div className="fx-panel" data-testid="effects-panel">
      <p className="muted small fx-hint">
        {disabled
          ? 'Select a video or image clip on the timeline to apply filters and effects.'
          : `Applying to ${targets.length} clip${targets.length > 1 ? 's' : ''}.`}
      </p>
      <h4 className="fx-heading">Filters</h4>
      <div className="fx-grid fx-presets">
        <button
          type="button"
          className={`fx-card${targets.length === 1 && !active ? ' active' : ''}`}
          disabled={disabled}
          onClick={() => applyPresetToClips(targetIds, null)}
          title="Remove filter (keeps blur)"
        >
          <span className="fx-thumb" style={thumbStyle([], thumb)} />
          <span className="fx-card-label">None</span>
        </button>
        {FILTER_PRESETS.map((p) => (
          <button
            type="button"
            key={p.id}
            className={`fx-card${active?.id === p.id ? ' active' : ''}`}
            disabled={disabled}
            onClick={() => applyPresetToClips(targetIds, p.id)}
            data-preset={p.id}
          >
            <span className="fx-thumb" style={thumbStyle(p.effects, thumb)}>
              <span className="fx-thumb-tint" style={overlayStyle(p.effects)} />
            </span>
            <span className="fx-card-label">{p.label}</span>
          </button>
        ))}
      </div>
      <h4 className="fx-heading">Effects</h4>
      <div className="fx-grid fx-effects">
        {listEffectDefinitions().map((d) => (
          <button
            type="button"
            key={d.id}
            className="fx-chip"
            disabled={disabled}
            onClick={() => addEffectToClips(targetIds, d.id)}
            data-effect={d.id}
            title={`Add ${d.label}`}
          >
            <span className="fx-chip-icon" aria-hidden>
              {d.icon}
            </span>
            {d.label}
          </button>
        ))}
      </div>
      <p className="muted small fx-hint">Adjust or remove effects in the inspector on the right.</p>
    </div>
  );
}
