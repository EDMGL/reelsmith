import { Icon, inspectorTargets, type IconName, type InspectorProps, type MotionPreset } from '../../core';
import { Slider } from '../text/controls';
import { DEFAULT_FOCUS, MOTION_PRESETS, alternatePunchIn, motionFor, patchMotion, setMotionPreset } from './motion';
import './motion.css';

const FOCUS_GRID = [0.2, 0.5, 0.8];

/** Line icons for the presets; unmapped presets keep their text glyph from motion.ts. */
const PRESET_ICONS: Partial<Record<string, IconName>> = {
  'zoom-in': 'zoom-in',
  'zoom-out': 'zoom-out',
  'punch-in': 'punch-in',
  'pan-left': 'chevron-left',
  'pan-right': 'chevron-right',
};

export default function MotionInspector(props: InspectorProps<'video' | 'image'>) {
  const { clip, track } = props;
  const targets = inspectorTargets(props);
  const m = clip.motion ?? motionFor('none');
  const active = m.preset !== 'none';
  const timed = m.preset === 'zoom-in' || m.preset === 'zoom-out' || m.preset === 'pan-left' || m.preset === 'pan-right';
  const fx = m.focusX ?? DEFAULT_FOCUS.focusX;
  const fy = m.focusY ?? DEFAULT_FOCUS.focusY;

  return (
    <fieldset className="inspector-fields mo" disabled={track.locked}>
      <div className="mo-presets" role="group" aria-label="Motion preset">
        {MOTION_PRESETS.map((p) => (
          <button
            key={p.preset}
            type="button"
            className={`mo-preset${m.preset === p.preset ? ' active' : ''}`}
            aria-pressed={m.preset === p.preset}
            title={p.hint}
            onClick={() => setMotionPreset(targets, p.preset as MotionPreset)}
          >
            <span className="mo-icon" aria-hidden>
              {PRESET_ICONS[p.preset] ? <Icon name={PRESET_ICONS[p.preset]!} size={16} /> : p.icon}
            </span>
            <span className="mo-label">{p.label}</span>
          </button>
        ))}
      </div>
      {active && (
        <>
          <Slider label="Amount" value={m.amount} min={1.02} max={2} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(amount) => patchMotion(targets, { amount })} />
          {timed && (
            <Slider
              label="Speed"
              value={m.duration}
              min={0}
              max={10}
              step={0.1}
              format={(v) => (v === 0 ? 'whole clip' : `${v.toFixed(1)} s`)}
              onChange={(duration) => patchMotion(targets, { duration })}
            />
          )}
          {m.preset !== 'pan-left' && m.preset !== 'pan-right' && (
            <div className="field mo-focus-field">
              <span className="field-label">Focus</span>
              <div className="mo-focus" role="group" aria-label="Zoom focus">
                {FOCUS_GRID.map((y) =>
                  FOCUS_GRID.map((x) => {
                    const on = Math.abs(x - fx) < 0.16 && Math.abs(y - fy) < 0.16;
                    return (
                      <button
                        key={`${x}-${y}`}
                        type="button"
                        className={on ? 'on' : ''}
                        aria-pressed={on}
                        aria-label={`Focus ${y < 0.4 ? 'top' : y > 0.6 ? 'bottom' : 'middle'} ${x < 0.4 ? 'left' : x > 0.6 ? 'right' : 'center'}`}
                        onClick={() => patchMotion(targets, { focusX: x, focusY: y === 0.5 ? DEFAULT_FOCUS.focusY : y })}
                      />
                    );
                  }),
                )}
              </div>
            </div>
          )}
        </>
      )}
      {targets.length > 1 && (
        <button type="button" className="btn btn-small mo-alt" title="Every second clip (in time order) zooms in: wide, close, wide, close…" onClick={() => alternatePunchIn(targets, m.preset === 'punch-in' ? m.amount : 1.2)}>
          <Icon name="punch-in" size={14} />
          Alternate punch-in (jump cuts)
        </button>
      )}
      <p className="muted small mo-tip">Tip: after silence removal, select all pieces (⌘A) and use “Alternate punch-in” for a dynamic talking-head edit.</p>
    </fieldset>
  );
}
