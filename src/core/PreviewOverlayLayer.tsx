import type { CSSProperties } from 'react';
import { previewOverlayRegistry, useRegistry, type PreviewOverlayProps } from './registry';
import { Slot } from './Slot';
import type { Project } from './types';

export interface PreviewOverlayLayerProps {
  project: Project;
  /** Displayed canvas size in CSS px. */
  displayWidth: number;
  displayHeight: number;
  /** Extra style for the layer (e.g. positioning when not placed inside the canvas box). */
  style?: CSSProperties;
}

/**
 * Renders every registered preview overlay (`registerPreviewOverlay`), each in
 * a Slot (Suspense + error boundary) inside its own absolutely positioned layer.
 * Mount it inside a `position: relative` (or absolute) element that exactly
 * covers the displayed canvas rectangle. Renders nothing if no overlay is registered.
 */
export function PreviewOverlayLayer({ project, displayWidth, displayHeight, style }: PreviewOverlayLayerProps) {
  const overlays = useRegistry(previewOverlayRegistry);
  if (overlays.length === 0 || displayWidth <= 0 || displayHeight <= 0) return null;
  const props: PreviewOverlayProps = {
    project,
    displayWidth,
    displayHeight,
    scale: project.width > 0 ? displayWidth / project.width : 0,
  };
  return (
    <div
      className="preview-overlay-layer"
      data-testid="preview-overlay-layer"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', ...style }}
    >
      {overlays.map((o) => (
        <div key={o.id} className="preview-overlay" data-overlay-id={o.id} style={{ position: 'absolute', inset: 0 }}>
          <Slot name={o.id} component={o.component} props={props} />
        </div>
      ))}
    </div>
  );
}
