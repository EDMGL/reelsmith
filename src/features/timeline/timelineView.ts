/**
 * The mounted timeline's DOM elements and track layout, so pointer gestures
 * (which run outside React) can map client coordinates to time / track without
 * `elementFromPoint` (robust while ghosts and placeholders are under the pointer).
 */
import { useEditorStore, type Id, type TrackLayout } from '../../core';
import { HEADER_WIDTH, TOP_GUTTER } from './timelineUi';

export const timelineView: {
  rows: HTMLElement | null;
  scroll: HTMLElement | null;
  /** Track rows in display order, `top` relative to the rows element. */
  layout: readonly TrackLayout[];
} = { rows: null, scroll: null, layout: [] };

/** Where the pointer is: a track, or the zone above / below the tracks (= new track). */
export interface Hit {
  time: number;
  trackId?: Id;
  zone?: 'top' | 'bottom';
}

/** Timeline time under a client x (not clamped). */
export function pointerTime(clientX: number): number {
  const rect = timelineView.rows?.getBoundingClientRect();
  const zoom = useEditorStore.getState().zoom;
  if (!rect) return 0;
  return (clientX - rect.left - HEADER_WIDTH) / zoom;
}

/** Pure hit test against a layout (y relative to the rows element). */
export function hitTestLayout(layout: readonly TrackLayout[], y: number): Pick<Hit, 'trackId' | 'zone'> {
  if (y < TOP_GUTTER) return { zone: 'top' };
  for (const l of layout) if (y >= l.top && y < l.top + l.height) return { trackId: l.trackId };
  const last = layout[layout.length - 1];
  if (!last || y >= last.top + last.height) return { zone: 'bottom' };
  return { zone: 'top' };
}

export function hitTest(clientX: number, clientY: number): Hit {
  const rect = timelineView.rows?.getBoundingClientRect();
  const time = Math.max(0, pointerTime(clientX));
  if (!rect) return { time };
  return { time, ...hitTestLayout(timelineView.layout, clientY - rect.top) };
}
