import { containSize, inspectorTargets, useEditorStore, type InspectorProps, type Transform } from '../../core';

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
      {asset && (
        <p className="muted small">
          Source {asset.width}×{asset.height}
        </p>
      )}
    </fieldset>
  );
}
