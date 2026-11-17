import { Icon, inspectorTargets, useEditorStore, type InspectorProps } from '../../core';
import {
  addEffectToClips,
  applyPresetToClips,
  moveEffect as moveEffectRaw,
  removeEffect as removeEffectRaw,
  resetEffect as resetEffectRaw,
  sameEffects,
  setEffectEnabled as setEffectEnabledRaw,
  setEffectParam as setEffectParamRaw,
  supportsEffects,
  syncEffects,
} from './actions';
import { FILTER_PRESETS, getEffectDefinition, listEffectDefinitions, matchPreset, resolveParams } from './definitions';
import { EffectIcon, EffectSlider } from './ui';
import './effects.css';

/** Inspector section "Effects" for video/image clips: the clip's effect stack. */
export default function EffectsInspector(props: InspectorProps<'video' | 'image'>) {
  const { clip, track, project } = props;
  const locked = track.locked;
  const preset = matchPreset(clip.effects);
  const targets = inspectorTargets(props);
  const multi = targets.length > 1;
  const differ = multi && targets.some((id) => {
    const c = project.clips[id];
    return supportsEffects(c) && !sameEffects(c.effects, clip.effects);
  });
  /** Edits the shown (first) clip's stack, then copies it to the other selected clips: one undo step. */
  const edit = (label: string, fn: () => unknown) => {
    if (!multi) return void fn();
    useEditorStore.getState().transact(label, () => {
      fn();
      syncEffects(clip.id, targets);
    });
  };
  const setEffectParam = (cid: string, fid: string, key: string, v: number) => edit('Effect', () => setEffectParamRaw(cid, fid, key, v));
  const setEffectEnabled = (cid: string, fid: string, on: boolean) => edit('Toggle effect', () => setEffectEnabledRaw(cid, fid, on));
  const removeEffect = (cid: string, fid: string) => edit('Remove effect', () => removeEffectRaw(cid, fid));
  const resetEffect = (cid: string, fid: string) => edit('Reset effect', () => resetEffectRaw(cid, fid));
  const moveEffect = (cid: string, fid: string, dir: -1 | 1) => edit('Move effect', () => moveEffectRaw(cid, fid, dir));
  return (
    <fieldset className="inspector-fields fx-inspector" disabled={locked} data-testid="effects-inspector">
      <div className="fx-quick">
        <select
          aria-label="Filter preset"
          value={preset?.id ?? ''}
          onChange={(e) => applyPresetToClips(targets, e.target.value || null)}
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
            if (e.target.value) addEffectToClips(targets, e.target.value);
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
      {differ && <p className="muted small">The selected clips have different effects. Showing the first one; changing anything here copies its effects to all {targets.length} clips.</p>}
      {clip.effects.length === 0 && <p className="muted small">No effects. Add one here or from the Effects panel.</p>}
      {clip.effects.map((fx, i) => {
        const def = getEffectDefinition(fx.effectType);
        if (!def) {
          return (
            <div key={fx.id} className="fx-item">
              <div className="fx-item-head">
                <span className="fx-name muted">Unknown effect “{fx.effectType}”</span>
                <button type="button" className="btn btn-small btn-icon-only btn-danger" title="Remove" aria-label="Remove effect" onClick={() => removeEffect(clip.id, fx.id)}>
                  <Icon name="close" size={14} />
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
                <span className="fx-item-icon" aria-hidden>
                  <EffectIcon def={def} />
                </span>
                <span className="fx-name">{def.label}</span>
              </label>
              <span className="fx-tools">
                <button type="button" className="btn btn-small btn-icon-only" title="Move up" aria-label="Move up" disabled={i === 0} onClick={() => moveEffect(clip.id, fx.id, -1)}>
                  <Icon name="arrow-up" size={14} />
                </button>
                <button
                  type="button"
                  className="btn btn-small btn-icon-only"
                  title="Move down"
                  aria-label="Move down"
                  disabled={i === clip.effects.length - 1}
                  onClick={() => moveEffect(clip.id, fx.id, 1)}
                >
                  <Icon name="arrow-down" size={14} />
                </button>
                <button type="button" className="btn btn-small btn-icon-only" title="Reset" aria-label={`Reset ${def.label}`} onClick={() => resetEffect(clip.id, fx.id)}>
                  <Icon name="reset" size={14} />
                </button>
                <button
                  type="button"
                  className="btn btn-small btn-icon-only btn-danger"
                  title="Remove"
                  aria-label={`Remove ${def.label}`}
                  onClick={() => removeEffect(clip.id, fx.id)}
                >
                  <Icon name="close" size={14} />
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
      {(clip.effects.length > 1 || (multi && clip.effects.length > 0)) && (
        <button
          type="button"
          className="btn btn-small"
          onClick={() => useEditorStore.getState().updateClips(targets, (c) => (supportsEffects(c) ? { effects: [] } : null), 'Remove all effects')}
        >
          Remove all effects
        </button>
      )}
    </fieldset>
  );
}
