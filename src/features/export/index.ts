/**
 * P4 — Export: top-bar primary "Export" action opening the export dialog
 * (WebCodecs encode via the engine's renderFrame/mixAudio, mediabunny mux).
 */
import { lazy } from 'react';
import { registerToolbarAction } from '../../core';

export function register(): void {
  registerToolbarAction({
    id: 'export',
    location: 'topbar',
    label: 'Export',
    variant: 'primary',
    title: 'Export the project to a video file',
    order: 1000,
    component: lazy(() => import('./ExportButton')),
  });
}
