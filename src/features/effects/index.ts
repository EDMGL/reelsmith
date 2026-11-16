/**
 * Effects package (P2): effect definitions + filter presets, the left panel
 * "Effects" and the "Effects" inspector section for video/image clips. The
 * rendering pipeline (`apply.ts`) is used by the engine's compositor.
 */
import { lazy } from 'react';
import { registerInspector, registerPanel } from '../../core';

export * from './definitions';
export * from './apply';
export * from './actions';

export function register(): void {
  registerPanel({
    id: 'effects',
    title: 'Effects',
    icon: '✦',
    order: 30,
    component: lazy(() => import('./EffectsPanel')),
  });
  registerInspector(['video', 'image'], lazy(() => import('./EffectsInspector')), {
    id: 'effects',
    title: 'Effects',
    order: 50,
    multi: true,
  });
}
