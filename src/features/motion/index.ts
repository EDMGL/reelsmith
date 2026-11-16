/**
 * Zoom & motion: animated zoom / pan inside video and image clips, a
 * "Punch-in" timeline action at the playhead, and jump-cut alternate zooms.
 */
import { lazy } from 'react';
import { registerInspector, registerToolbarAction } from '../../core';
import { pictureClipAt, punchInAtPlayhead } from './motion';

export function register(): void {
  registerInspector(['video', 'image'], lazy(() => import('./MotionInspector')), { id: 'motion', title: 'Zoom & motion', order: 30, multi: true });
  registerToolbarAction({
    id: 'motion:punch-in',
    location: 'timeline',
    label: 'Punch-in',
    icon: '◎',
    title: 'Split at the playhead and zoom in on what follows (jump-cut zoom)',
    order: 45,
    isEnabled: (s) => pictureClipAt(s.currentTime) !== null,
    run: () => void punchInAtPlayhead(),
  });
}
