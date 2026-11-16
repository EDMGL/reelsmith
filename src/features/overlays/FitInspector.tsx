import { containSize, inspectorTargets, useEditorStore, type ClipShape, type InspectorProps, type Transform } from '../../core';

/**
 * Quick placement for image/video clips (the numeric transform lives in the
 * core 'core:transform' section). The model has no fit mode / flip / crop, so
 * "Fill" is expressed through `transform.scale` (cover = contain x factor).
 */
export function fillScale(assetW: number, assetH: number, canvasW: number, canvasH: number): number {
  const c = containSize(assetW, assetH, canvasW, canvasH);
  if (c.width <= 0 || c.height <= 0) return 1;
  return Math.max(canvasW / c.width, canvasH / c.height);
}

const DEFAULT_SHAPE: ClipShape = { kind: 'rect', radius: 0.12, border: 0, borderColor: '#ffffff' };
const SHAPES: readonly { kind: ClipShape['kind']; label: string; hint: string }[] = [
  { kind: 'rect', label: '▭ Rect', hint: 'Plain rectangle' },
  { kind: 'rounded', label: '▢ Rounded', hint: 'Rounded corners' },
  { kind: 'circle', label: '◯ Circle', hint: 'Round mask (webcam bubble)' },
];

export default function FitInspector(props: InspectorProps<'image' | 'video'>) {
  const { clip, track, project } = props;
  if (clip.type !== 'image' && clip.type !== 'video') return null;
  const asset = project.assets[clip.assetId];
  const targets = inspectorTargets(props);
  /** Fill depends on each clip's own source size, so it is computed per clip. */
  const set = (patch: (c: { assetId: string }) => Partial<Transform>) =>
    useEditorStore.getState().updateClips(
      targets,
      (c) => {
        if (c.type !== 'image' && c.type !== 'video') return null;
        return { transform: { ...c.transform, ...patch(c) } };
      },
      'Placement',
    );
  const setShape = (patch: Partial<ClipShape>) =>
    useEditorStore.getState().updateClips(
      targets,
      (c) => (c.type === 'image' || c.type === 'video' ? { shape: { ...DEFAULT_SHAPE, ...c.shape, ...patch } } : null),
      'Shape',
    );
  const fillFor = (c: { assetId: string }) => {
    const a = project.assets[c.assetId];
    return a ? fillScale(a.width, a.height, project.width, project.height) : 1;
  };
  return (
    <fieldset className="inspector-fields" disabled={track.locked}>
      <div className="segmented" role="group" aria-label="Placement">
        <button type="button" onClick={() => set(() => ({ x: 0.5, y: 0.5, scale: 1, rotation: 0 }))} title="Whole image visible (contain)">
          Fit
        </button>
        <button type="button" onClick={() => set((c) => ({ x: 0.5, y: 0.5, scale: fillFor(c), rotation: 0 }))} title="Cover the whole canvas (crops overflow)">
          Fill
        </button>
        <button type="button" onClick={() => set(() => ({ x: 0.5, y: 0.5 }))} title="Center on canvas">
          Center
        </button>
      </div>
      <div className="segmented" role="group" aria-label="Shape">
        {SHAPES.map((sh) => (
          <button
            key={sh.kind}
            type="button"
            className={(clip.shape?.kind ?? 'rect') === sh.kind ? 'active' : ''}
            aria-pressed={(clip.shape?.kind ?? 'rect') === sh.kind}
            title={sh.hint}
            onClick={() => setShape({ kind: sh.kind })}
          >
            {sh.label}
          </button>
        ))}
      </div>
      <label className="field">
        <span className="field-label">Outline</span>
        <span className="field-input">
          <input type="checkbox" aria-label="Outline" checked={(clip.shape?.border ?? 0) > 0} onChange={(e) => setShape({ border: e.target.checked ? 8 : 0 })} />
          <input type="color" aria-label="Outline color" value={clip.shape?.borderColor ?? '#ffffff'} onChange={(e) => setShape({ borderColor: e.target.value })} />
        </span>
      </label>
      {asset && (
        <p className="muted small">
          Source {asset.width}×{asset.height}
        </p>
      )}
    </fieldset>
  );
}
