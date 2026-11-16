/**
 * Screen + camera recorder (Loom style): left panel "Record" + top bar action.
 */
import { createElement, lazy } from 'react';
import { openPanel, registerPanel, registerToolbarAction } from '../../core';

export const RECORDER_PANEL_ID = 'record';

export function register(): void {
  registerPanel({
    id: RECORDER_PANEL_ID,
    title: 'Record',
    icon: createElement('span', { 'aria-hidden': true, className: 'rec-tab-icon' }, '⏺'),
    order: 5,
    component: lazy(() => import('./RecorderPanel')),
  });
  registerToolbarAction({
    id: 'recorder:open',
    location: 'topbar',
    label: 'Record',
    icon: '⏺',
    title: 'Record your screen and camera',
    order: 10,
    run: () => openPanel(RECORDER_PANEL_ID),
  });
}
