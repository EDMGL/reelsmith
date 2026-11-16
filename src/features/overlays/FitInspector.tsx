import { containSize, useEditorStore, type InspectorProps, type Transform } from '../../core';

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

export default function FitInspector({ clip, track, project }: InspectorProps<'image' | 'video'>) {
  if (clip.type !== 'image' && clip.type !== 'video') return null;
  const asset = project.assets[clip.assetId];
  const set = (patch: Partial<Transform>) => useEditorStore.getState().updateClip(clip.id, { transform: { ...clip.transform, ...patch } });
  const fill = asset ? fillScale(asset.width, asset.height, project.width, project.height) : 1;
  return (
    <fieldset className="inspector-fields" disabled={track.locked}>
      <div className="segmented" role="group" aria-label="Placement">
        <button type="button" onClick={() => set({ x: 0.5, y: 0.5, scale: 1, rotation: 0 })} title="Whole image visible (contain)">
          Fit
        </button>
        <button type="button" onClick={() => set({ x: 0.5, y: 0.5, scale: fill, rotation: 0 })} title="Cover the whole canvas (crops overflow)">
          Fill
        </button>
        <button type="button" onClick={() => set({ x: 0.5, y: 0.5 })} title="Center on canvas">
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
