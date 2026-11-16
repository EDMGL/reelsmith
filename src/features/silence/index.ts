/**
 * P4 — Silence detection & removal.
 * - Left panel "Silence" (lazy) with parameters, results and removal.
 * - Timeline toolbar action "Remove silence": runs detection and focuses the panel.
 * - Timeline overlay drawing the detected ranges.
 */
import { createElement, lazy } from 'react';
import { openPanel, registerPanel, registerTimelineOverlay, registerToolbarAction, useEditorStore } from '../../core';
import { useSilenceStore } from './silenceStore';
import { getAudibleClips } from './timelineSilence';

export const SILENCE_PANEL_ID = 'silence';

export function runSilenceAction(): Promise<void> {
  const editor = useEditorStore.getState();
  const s = useSilenceStore.getState();
  openPanel(SILENCE_PANEL_ID);
  if (s.status === 'running') return Promise.resolve();
  const selectedAudible = getAudibleClips(editor.project, editor.selectedClipIds);
  s.setScope(selectedAudible.length > 0 ? 'selection' : 'timeline');
  return useSilenceStore.getState().detect();
}

export function register(): void {
  registerPanel({
    id: SILENCE_PANEL_ID,
    title: 'Silence',
    icon: createElement('span', { 'aria-hidden': true }, '〰'),
    order: 60,
    component: lazy(() => import('./SilencePanel')),
  });
  registerToolbarAction({
    id: 'silence:detect',
    location: 'timeline',
    label: 'Remove silence',
    icon: '〰',
    title: 'Detect silent parts (selected clip, or whole timeline) and review them in the Silence panel',
    order: 50,
    isEnabled: (st) => Object.keys(st.project.clips).length > 0,
    run: runSilenceAction,
  });
  registerTimelineOverlay(lazy(() => import('./SilenceOverlay')), { id: 'silence', order: 10 });
}
