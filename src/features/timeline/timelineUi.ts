/** Transient timeline UI state (not part of the project, not undoable). */
import { create } from 'zustand';
import type { Id } from '../../core';

export interface DragPreview {
  ids: Id[];
  /** Time delta applied to every dragged clip. */
  delta: number;
  /** Target track for a single-clip drag (undefined = unchanged). */
  trackId?: Id;
  /** False if dropping here would be rejected (overlap / incompatible track). */
  valid: boolean;
}

interface TimelineUiState {
  drag: DragPreview | null;
  /** Time of the active snap guide line, or null. */
  snapLine: number | null;
  snapping: boolean;
  setDrag(drag: DragPreview | null): void;
  setSnapLine(t: number | null): void;
  toggleSnapping(): void;
}

export const useTimelineUi = create<TimelineUiState>()((set) => ({
  drag: null,
  snapLine: null,
  snapping: true,
  setDrag: (drag) => set({ drag }),
  setSnapLine: (snapLine) => set({ snapLine }),
  toggleSnapping: () => set((s) => ({ snapping: !s.snapping })),
}));

/** Pixel layout constants shared by timeline components. */
export const HEADER_WIDTH = 176;
export const RULER_HEIGHT = 28;
export const SNAP_PX = 8;
export const TRACK_HEIGHT: Record<string, number> = { video: 64, overlay: 52, audio: 48, text: 36, subtitle: 36 };
