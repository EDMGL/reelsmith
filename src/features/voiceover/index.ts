/**
 * Voiceover: record narration from the microphone while the timeline plays.
 * Left panel "Voiceover" + timeline toolbar shortcut.
 */
import { createElement, lazy } from 'react';
import { openPanel, registerPanel, registerToolbarAction } from '../../core';

export const VOICEOVER_PANEL_ID = 'voiceover';

export function register(): void {
  registerPanel({
    id: VOICEOVER_PANEL_ID,
    title: 'Voiceover',
    icon: createElement('span', { 'aria-hidden': true }, '🎙'),
    order: 25,
    component: lazy(() => import('./VoiceoverPanel')),
  });
  registerToolbarAction({
    id: 'voiceover:open',
    location: 'timeline',
    label: 'Voiceover',
    icon: '🎙',
    title: 'Record a voiceover from the playhead',
    order: 55,
    run: () => openPanel(VOICEOVER_PANEL_ID),
  });
}
