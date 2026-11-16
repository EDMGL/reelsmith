/** Small shared UI pieces of the effects package. */
import { useRef } from 'react';
import { useEditorStore } from '../../core';
import type { EffectParamDef } from './definitions';

/**
 * Range slider whose whole pointer drag is ONE undo step: the transaction is
 * opened on pointerdown and committed on the next window pointerup/cancel
 * (robust even if the pointer is released outside the input).
 */
export function EffectSlider({
  def,
  value,
  disabled,
  onChange,
}: {
  def: EffectParamDef;
  value: number;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  const open = useRef(false);
  const begin = () => {
    if (open.current) return;
    open.current = true;
    useEditorStore.getState().beginTransaction(`Adjust ${def.label.toLowerCase()}`);
    const end = () => {
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      if (!open.current) return;
      open.current = false;
      useEditorStore.getState().commitTransaction();
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };
  return (
    <label className="field fx-param">
      <span className="field-label">{def.label}</span>
      <span className="field-input">
        <input
          type="range"
          min={def.min}
          max={def.max}
          step={def.step}
          value={value}
          disabled={disabled}
          aria-label={def.label}
          onPointerDown={begin}
          onChange={(e) => onChange(Number(e.target.value))}
          onDoubleClick={() => onChange(def.default)}
        />
        <span className="muted small range-value">
          {Math.round(value * 10) / 10}
          {def.unit}
        </span>
      </span>
    </label>
  );
}
