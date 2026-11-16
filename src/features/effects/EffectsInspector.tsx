import { useEditorStore, type InspectorProps } from '../../core';
import {
  addEffectToClips,
  applyPresetToClips,
  moveEffect,
  removeEffect,
  resetEffect,
  setEffectEnabled,
  setEffectParam,
} from './actions';
import { FILTER_PRESETS, getEffectDefinition, listEffectDefinitions, matchPreset, resolveParams } from './definitions';
import { EffectSlider } from './ui';
import './effects.css';

/** Inspector section "Effects" for video/image clips: the clip's effect stack. */
export default function EffectsInspector({ clip, track }: InspectorProps<'video' | 'image'>) {
  const locked = track.locked;
  const preset = matchPreset(clip.effects);
  return (
    <fieldset className="inspector-fields fx-inspector" disabled={locked} data-testid="effects-inspector">
      <div className="fx-quick">
        <select
          aria-label="Filter preset"
          value={preset?.id ?? ''}
          onChange={(e) => applyPresetToClips([clip.id], e.target.value || null)}
        >
          <option value="">Filter: none</option>
          {FILTER_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              Filter: {p.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Add effect"
          value=""
          onChange={(e) => {
            if (e.target.value) addEffectToClips([clip.id], e.target.value);
          }}
        >
          <option value="">+ Add effect</option>
          {listEffectDefinitions().map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
      </div>
      {clip.effects.length === 0 && <p className="muted small">No effects. Add one here or from the Effects panel.</p>}
      {clip.effects.map((fx, i) => {
        const def = getEffectDefinition(fx.effectType);
        if (!def) {
          return (
            <div key={fx.id} className="fx-item">
              <div className="fx-item-head">
                <span className="fx-name muted">Unknown effect “{fx.effectType}”</span>
                <button type="button" className="btn btn-small btn-icon-only btn-danger" title="Remove" aria-label="Remove effect" onClick={() => removeEffect(clip.id, fx.id)}>
                  ×
                </button>
              </div>
            </div>
          );
        }
        const values = resolveParams(def, fx.params);
        return (
          <div key={fx.id} className={`fx-item${fx.enabled ? '' : ' fx-disabled'}`} data-effect-type={fx.effectType}>
            <div className="fx-item-head">
              <label className="fx-toggle" title={fx.enabled ? 'Disable effect' : 'Enable effect'}>
                <input
                  type="checkbox"
                  checked={fx.enabled}
                  aria-label={`Enable ${def.label}`}
                  onChange={(e) => setEffectEnabled(clip.id, fx.id, e.target.checked)}
                />
                <span className="fx-name">{def.label}</span>
              </label>
              <span className="fx-tools">
                <button type="button" className="btn btn-small btn-icon-only" title="Move up" aria-label="Move up" disabled={i === 0} onClick={() => moveEffect(clip.id, fx.id, -1)}>
                  ↑
                </button>
                <button
                  type="button"
                  className="btn btn-small btn-icon-only"
                  title="Move down"
                  aria-label="Move down"
                  disabled={i === clip.effects.length - 1}
                  onClick={() => moveEffect(clip.id, fx.id, 1)}
                >
                  ↓
                </button>
                <button type="button" className="btn btn-small btn-icon-only" title="Reset" aria-label={`Reset ${def.label}`} onClick={() => resetEffect(clip.id, fx.id)}>
                  ↺
                </button>
                <button
                  type="button"
                  className="btn btn-small btn-icon-only btn-danger"
                  title="Remove"
                  aria-label={`Remove ${def.label}`}
                  onClick={() => removeEffect(clip.id, fx.id)}
                >
                  ×
                </button>
              </span>
            </div>
            {def.params.map((p) => (
              <EffectSlider
                key={p.key}
                def={p}
                value={values[p.key]!}
                disabled={!fx.enabled}
                onChange={(v) => setEffectParam(clip.id, fx.id, p.key, v)}
              />
            ))}
          </div>
        );
      })}
      {clip.effects.length > 1 && (
        <button
          type="button"
          className="btn btn-small"
          onClick={() => useEditorStore.getState().updateClip(clip.id, { effects: [] })}
        >
          Remove all effects
        </button>
      )}
    </fieldset>
  );
}
