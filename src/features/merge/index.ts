/**
 * Merge clips: bake a run of timeline pieces (e.g. after silence removal,
 * with their detached audio) into one clip without moving subtitles.
 */
import { lazy } from 'react';
import { registerToolbarAction } from '../../core';

export function register(): void {
  registerToolbarAction({
    id: 'merge:clips',
    location: 'timeline',
    label: 'Merge',
    title: 'Bake the selected clips into one clip',
    order: 55,
    component: lazy(() => import('./MergeButton')),
  });
}
