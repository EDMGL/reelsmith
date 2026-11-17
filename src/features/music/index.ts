/**
 * Music & sound library: original, procedurally generated background music and
 * sound effects (Web Audio synthesis, no downloads). Left panel "Music".
 */
import { createElement, lazy } from 'react';
import { registerPanel } from '../../core';

export const MUSIC_PANEL_ID = 'music';

export function register(): void {
  registerPanel({
    id: MUSIC_PANEL_ID,
    title: 'Music',
    icon: createElement('span', { 'aria-hidden': true }, '♫'),
    order: 22,
    component: lazy(() => import('./MusicPanel')),
  });
}
