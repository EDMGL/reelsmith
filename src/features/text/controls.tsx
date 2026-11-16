/**
 * Small form controls shared by the P3 inspectors / panels. Continuous edits
 * (slider drags, typing, color picking) are wrapped in a store transaction so
 * each gesture is ONE undo step.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useEditorStore, type TextStyle } from '../../core';
import { parseColor, toCss, toHex } from './color';
import { SYSTEM_FONTS, importFontFile, useImportedFonts } from './fonts';

/** begin/end a store transaction for a gesture; auto-commits if unmounted mid-gesture. */
export function useTxGesture(label: string): { begin: () => void; end: () => void } {
  const open = useRef(false);
  const begin = useCallback(() => {
    if (open.current) return;
    open.current = true;
    useEditorStore.getState().beginTransaction(label);
  }, [label]);
  const end = useCallback(() => {
    if (!open.current) return;
    open.current = false;
    useEditorStore.getState().commitTransaction();
  }, []);
  useEffect(() => end, [end]);
  return { begin, end };
}

/**
 * Groups a burst of edits (typing, color picking) into one undo step: the
 * transaction opens on the first `touch()` and commits after `idleMs` without
 * edits, on `end()` (blur) or on unmount. Unlike focus→blur, it never stays
 * open while the user goes on to edit something else.
 */
export function useBurstTx(label: string, idleMs = 800): { touch: () => void; end: () => void } {
  const open = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const end = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!open.current) return;
    open.current = false;
    useEditorStore.getState().commitTransaction();
  }, []);
  const touch = useCallback(() => {
    if (!open.current) {
      open.current = true;
      useEditorStore.getState().beginTransaction(label);
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(end, idleMs);
  }, [label, idleMs, end]);
  useEffect(() => end, [end]);
  return { touch, end };
}

const round = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="field-input">{children}</span>
    </label>
  );
}

/** Numeric input committing on blur / Enter. */
export function NumberInput({
  label,
  value,
  onCommit,
  step = 1,
  min,
  max,
  suffix,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
}) {
  const [draft, setDraft] = useState(String(round(value)));
  useEffect(() => setDraft(String(round(value))), [value]);
  const commit = () => {
    let v = Number(draft);
    if (!Number.isFinite(v) || draft.trim() === '') return setDraft(String(round(value)));
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    if (v !== round(value)) onCommit(v);
    setDraft(String(round(v)));
  };
  return (
    <Field label={label}>
      <input
        type="number"
        aria-label={label}
        value={draft}
        step={step}
        min={min}
        max={max}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      {suffix && <span className="muted small">{suffix}</span>}
    </Field>
  );
}

/** Range slider; one drag = one undo step. */
export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  const { begin, end } = useTxGesture(label);
  return (
    <Field label={label}>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onPointerDown={begin}
        onPointerUp={end}
        onPointerCancel={end}
        onKeyDown={begin}
        onKeyUp={end}
        onBlur={end}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="muted small range-value">{format ? format(value) : round(value, 2)}</span>
    </Field>
  );
}

/** Color picker + alpha slider; a burst of picker changes is one undo step. */
export function ColorInput({ label, value, onChange }: { label: string; value: string; onChange: (css: string) => void }) {
  const { begin, end } = useTxGesture(label);
  const burst = useBurstTx(label);
  const parsed = parseColor(value) ?? { r: 255, g: 255, b: 255, a: 1 };
  return (
    <Field label={label}>
      <input
        type="color"
        aria-label={label}
        value={toHex(parsed)}
        onBlur={burst.end}
        onChange={(e) => {
          const c = parseColor(e.target.value);
          if (!c) return;
          burst.touch();
          onChange(toCss({ ...c, a: parsed.a }));
        }}
      />
      <input
        type="range"
        aria-label={`${label} opacity`}
        title="Opacity"
        min={0}
        max={1}
        step={0.01}
        value={parsed.a}
        onPointerDown={begin}
        onPointerUp={end}
        onBlur={end}
        onChange={(e) => onChange(toCss({ ...parsed, a: Number(e.target.value) }))}
      />
      <span className="muted small range-value">{Math.round(parsed.a * 100)}%</span>
    </Field>
  );
}

export function FontSelect({ value, onChange }: { value: string; onChange: (family: string) => void }) {
  const imported = useImportedFonts();
  const [error, setError] = useState<string | null>(null);
  const choices = [...SYSTEM_FONTS, ...imported];
  const known = choices.some((c) => c.family === value);
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <Field label="Font">
        <select aria-label="Font" value={value} onChange={(e) => onChange(e.target.value)} style={{ flex: 1, minWidth: 0 }}>
          {!known && <option value={value}>{value.split(',')[0]!.replace(/"/g, '')}</option>}
          {choices.map((c) => (
            <option key={c.family} value={c.family}>
              {c.label}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-small" title="Use a font file from your computer (this session only)" onClick={() => fileRef.current?.click()}>
          Import…
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".ttf,.otf,.woff,.woff2,font/*"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            try {
              setError(null);
              const choice = await importFontFile(file);
              onChange(choice.family);
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Could not load font');
            }
          }}
        />
      </Field>
      {error && <p className="small p3-error">{error}</p>}
    </>
  );
}

const WEIGHTS = [300, 400, 500, 600, 700, 800, 900];

/**
 * Editor for every `TextStyle` field. `onChange` receives the full next style;
 * the caller persists it (e.g. `updateClip`). Sliders/colors are transactional.
 */
export function TextStyleEditor({ style, onChange }: { style: TextStyle; onChange: (next: TextStyle) => void }) {
  const set = (patch: Partial<TextStyle>) => onChange({ ...style, ...patch });
  return (
    <>
      <FontSelect value={style.fontFamily} onChange={(fontFamily) => set({ fontFamily })} />
      <NumberInput label="Size" value={style.fontSize} min={4} max={1000} step={1} suffix="px" onCommit={(fontSize) => set({ fontSize })} />
      <Field label="Weight">
        <select aria-label="Weight" value={style.fontWeight} onChange={(e) => set({ fontWeight: Number(e.target.value) })}>
          {WEIGHTS.map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
        <label className="p3-check">
          <input type="checkbox" checked={style.italic} onChange={(e) => set({ italic: e.target.checked })} /> Italic
        </label>
      </Field>
      <Field label="Align">
        <span className="segmented" role="group" aria-label="Align">
          {(['left', 'center', 'right'] as const).map((a) => (
            <button key={a} type="button" className={style.align === a ? 'active' : ''} aria-pressed={style.align === a} onClick={() => set({ align: a })}>
              {a[0]!.toUpperCase() + a.slice(1)}
            </button>
          ))}
        </span>
      </Field>
      <ColorInput label="Color" value={style.color} onChange={(color) => set({ color })} />
      <Slider label="Line height" value={style.lineHeight} min={0.6} max={3} step={0.05} onChange={(lineHeight) => set({ lineHeight })} />

      <Toggle label="Outline" checked={!!style.stroke} onChange={(on) => set({ stroke: on ? { color: '#000000', width: 4 } : null })} />
      {style.stroke && (
        <div className="p3-sub">
          <ColorInput label="Color" value={style.stroke.color} onChange={(color) => set({ stroke: { ...style.stroke!, color } })} />
          <Slider label="Width" value={style.stroke.width} min={0} max={40} step={0.5} onChange={(width) => set({ stroke: { ...style.stroke!, width } })} />
        </div>
      )}

      <Toggle
        label="Shadow"
        checked={!!style.shadow}
        onChange={(on) => set({ shadow: on ? { color: 'rgba(0,0,0,0.5)', blur: 8, offsetX: 0, offsetY: 4 } : null })}
      />
      {style.shadow && (
        <div className="p3-sub">
          <ColorInput label="Color" value={style.shadow.color} onChange={(color) => set({ shadow: { ...style.shadow!, color } })} />
          <Slider label="Blur" value={style.shadow.blur} min={0} max={80} step={1} onChange={(blur) => set({ shadow: { ...style.shadow!, blur } })} />
          <Slider label="Offset X" value={style.shadow.offsetX} min={-60} max={60} step={1} onChange={(offsetX) => set({ shadow: { ...style.shadow!, offsetX } })} />
          <Slider label="Offset Y" value={style.shadow.offsetY} min={-60} max={60} step={1} onChange={(offsetY) => set({ shadow: { ...style.shadow!, offsetY } })} />
        </div>
      )}

      <Toggle
        label="Background"
        checked={!!style.background}
        onChange={(on) => set({ background: on ? { color: 'rgba(0,0,0,0.6)', padding: 16, radius: 8 } : null })}
      />
      {style.background && (
        <div className="p3-sub">
          <ColorInput label="Color" value={style.background.color} onChange={(color) => set({ background: { ...style.background!, color } })} />
          <Slider label="Padding" value={style.background.padding} min={0} max={120} step={1} onChange={(padding) => set({ background: { ...style.background!, padding } })} />
          <Slider label="Radius" value={style.background.radius} min={0} max={120} step={1} onChange={(radius) => set({ background: { ...style.background!, radius } })} />
        </div>
      )}
    </>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="p3-toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  );
}
