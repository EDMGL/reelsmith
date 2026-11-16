/**
 * P3 — image overlays: `image` renderer, Fit/Fill placement section, and the
 * transform-handles preview overlay (select / move / scale / rotate / nudge).
 */
import { lazy } from 'react';
import { registerClipRenderer, registerInspector, registerPreviewOverlay } from '../../core';
import { renderImage } from './renderImage';

export { renderImage } from './renderImage';

export function register(): void {
  registerClipRenderer('image', renderImage);
  registerInspector(['image', 'video'], lazy(() => import('./FitInspector')), { id: 'overlays:placement', title: 'Placement', order: 15, multi: true });
  registerPreviewOverlay(lazy(() => import('./TransformOverlay')), { id: 'overlays:transform', order: 10 });
}
