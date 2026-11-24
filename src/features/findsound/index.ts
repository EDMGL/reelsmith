/**
 * "Find sound": search YouTube for music, preview it, and add it as an MP3 on a
 * music track. Needs the local dev server (yt-dlp + ffmpeg), see server/soundApi.ts.
 */
import { createElement, lazy } from 'react';
import { registerPanel } from '../../core';

export const FIND_SOUND_PANEL_ID = 'find-sound';

export function register(): void {
  registerPanel({
    id: FIND_SOUND_PANEL_ID,
    title: 'Find sound',
    icon: createElement('span', { 'aria-hidden': true }, '♪'),
    order: 61,
    component: lazy(() => import('./FindSoundPanel')),
  });
}
