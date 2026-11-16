import { act, render, screen } from '@testing-library/react';
import { lazy } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { createProject } from '../model';
import { PreviewOverlayLayer } from '../PreviewOverlayLayer';
import {
  previewOverlayRegistry,
  registerPreviewOverlay,
  resetRegistries,
  type PreviewOverlayProps,
} from '../registry';

afterEach(() => resetRegistries());

function Probe({ displayWidth, displayHeight, scale }: PreviewOverlayProps) {
  return <div data-testid="probe">{`${displayWidth}x${displayHeight}@${scale}`}</div>;
}

describe('preview overlay registry', () => {
  it('registers, orders, looks up and unregisters overlays', () => {
    const offB = registerPreviewOverlay(Probe, { id: 'b', order: 20 });
    registerPreviewOverlay(Probe, { id: 'a', order: 10 });
    expect(previewOverlayRegistry.list().map((o) => o.id)).toEqual(['a', 'b']);
    expect(previewOverlayRegistry.get('b')?.component).toBe(Probe);
    offB();
    expect(previewOverlayRegistry.get('b')).toBeUndefined();
    const offAuto = registerPreviewOverlay(Probe);
    expect(previewOverlayRegistry.list()).toHaveLength(2);
    offAuto();
  });
});

describe('PreviewOverlayLayer', () => {
  const project = createProject({ width: 1080, height: 1920 });

  it('renders nothing when no overlay is registered', () => {
    render(<PreviewOverlayLayer project={project} displayWidth={270} displayHeight={480} />);
    expect(screen.queryByTestId('preview-overlay-layer')).toBeNull();
  });

  it('renders a registered overlay with display size and scale', () => {
    registerPreviewOverlay(Probe, { id: 'probe' });
    render(<PreviewOverlayLayer project={project} displayWidth={270} displayHeight={480} />);
    expect(screen.getByTestId('probe').textContent).toBe('270x480@0.25');
    const layer = screen.getByTestId('preview-overlay-layer');
    expect(layer.style.position).toBe('absolute');
    expect(layer.style.pointerEvents).toBe('none');
  });

  it('renders lazy overlays inside Suspense and reacts to late registration', async () => {
    render(<PreviewOverlayLayer project={project} displayWidth={540} displayHeight={960} />);
    act(() => {
      registerPreviewOverlay(
        lazy(async () => ({ default: Probe })),
        { id: 'lazy' },
      );
    });
    expect((await screen.findByTestId('probe')).textContent).toBe('540x960@0.5');
  });
});
