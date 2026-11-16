import { lazy } from 'react';
import { registerPanel } from '../../core';

export { importFile, importFiles, detectKind, computeWaveform } from './importMedia';

/** Registers the media library as the first left-panel tab. */
export function register(): void {
  registerPanel({
    id: 'media',
    title: 'Media',
    icon: '▦',
    order: 0,
    component: lazy(() => import('./MediaPanel').then((m) => ({ default: m.MediaPanel }))),
  });
}
