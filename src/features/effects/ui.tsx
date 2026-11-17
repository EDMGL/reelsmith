/** Small shared UI pieces of the effects package. */
import { useRef } from 'react';
import { Icon, useEditorStore, type IconName } from '../../core';
import type { EffectDefinition, EffectParamDef } from './definitions';

/** Line icons for the built-in effects; others fall back to the definition's glyph. */
const EFFECT_ICONS: Partial<Record<string, IconName>> = {
  brightness: 'sun',
  contrast: 'contrast',
  saturation: 'droplet',
  blur: 'blur',
  temperature: 'thermometer',
  vignette: 'vignette',
  grain: 'grain',
};

/** Decorative icon of an effect definition (SVG when mapped, else its text glyph). */
export function EffectIcon({ def, size = 14 }: { def: Pick<EffectDefinition, 'id' | 'icon'>; size?: number }) {
  const name = EFFECT_ICONS[def.id];
  if (name) return <Icon name={name} size={size} />;
  return <>{def.icon ?? '•'}</>;
}

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
