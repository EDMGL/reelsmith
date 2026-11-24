/**
 * Templates: a gallery of ready-made edits with media slots. Pick a template,
 * add photos/videos (they fill the slots in order), edit the texts and apply:
 * cuts, motion, effects, text and catalogue music land on the timeline as
 * ordinary clips in one undo step. Left panel "Templates".
 */
import { createElement, lazy } from 'react';
import { registerPanel } from '../../core';

export const TEMPLATES_PANEL_ID = 'templates';

export function register(): void {
  registerPanel({
    id: TEMPLATES_PANEL_ID,
    title: 'Templates',
    icon: createElement('span', { 'aria-hidden': true }, '❖'),
    order: 3,
    component: lazy(() => import('./TemplatesPanel')),
  });
}
