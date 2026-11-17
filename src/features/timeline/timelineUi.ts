/** Transient timeline UI state (not part of the project, not undoable). */
import { create } from 'zustand';
import type { Clip, Id, TrackKind } from '../../core';

/** One clip of a drag preview, drawn where it would land. */
export interface GhostItem {
  clip: Clip;
  /** Landing start time. */
  start: number;
  /** Landing track, or null = the new track described by `DragPreview.newTrack`. */
  trackId: Id | null;
}

/** How a drop would land relative to the pointer position. */
export type DropOutcome = 'exact' | 'shifted' | 'new-track' | 'rejected';

/**
 * Preview of the drag in progress (clip move, media drag, file drag). Drawn by
 * the drag layer, so per-frame updates re-render only that layer.
 */
export interface DragPreview {
  ghosts: GhostItem[];
  /** A track that the drop would create (order = compositing order it gets). */
  newTrack: { kind: TrackKind; order: number } | null;
  /** False if dropping now would be rejected. */
  valid: boolean;
  outcome: DropOutcome;
  /** Vertical drop marker for drags of unknown length (OS files). */
  marker?: { time: number; trackId: Id | null };
}

export interface ContextMenuState {
  /** Viewport coordinates of the click. */
  x: number;
  y: number;
  /** Right-clicked clip (undefined: empty lane). */
  clipId?: Id;
  /** Track under the pointer. */
  trackId?: Id;
  /** Timeline time under the pointer. */
  time: number;
}

interface TimelineUiState {
  drag: DragPreview | null;
  /** Ids of the clips being moved (their originals are drawn as placeholders). Changes only at drag start/end. */
  draggingIds: ReadonlySet<Id> | null;
  /** Time of the active snap guide line, or null. */
  snapLine: number | null;
  snapping: boolean;
  menu: ContextMenuState | null;
  /** Short feedback message (e.g. a drop that could not be placed). */
  notice: { text: string; key: number } | null;
  setDrag(drag: DragPreview | null): void;
  setDraggingIds(ids: ReadonlySet<Id> | null): void;
  setSnapLine(t: number | null): void;
  toggleSnapping(): void;
  openMenu(menu: ContextMenuState): void;
  closeMenu(): void;
  showNotice(text: string): void;
}

let noticeTimer: ReturnType<typeof setTimeout> | undefined;

export const useTimelineUi = create<TimelineUiState>()((set, get) => ({
  drag: null,
  draggingIds: null,
  snapLine: null,
  snapping: true,
  menu: null,
  notice: null,
  setDrag: (drag) => {
    if (drag !== get().drag) set({ drag });
  },
  setDraggingIds: (draggingIds) => set({ draggingIds }),
  setSnapLine: (snapLine) => {
    if (snapLine !== get().snapLine) set({ snapLine });
  },
  toggleSnapping: () => set((s) => ({ snapping: !s.snapping })),
  openMenu: (menu) => set({ menu }),
  closeMenu: () => {
    if (get().menu) set({ menu: null });
  },
  showNotice: (text) => {
    clearTimeout(noticeTimer);
    set({ notice: { text, key: (get().notice?.key ?? 0) + 1 } });
    noticeTimer = setTimeout(() => set({ notice: null }), 2500);
  },
}));

/** Pixel layout constants shared by timeline components. */
export const HEADER_WIDTH = 176;
export const RULER_HEIGHT = 28;
/** Strip above the first track: dropping/dragging there creates a new track on top. */
export const TOP_GUTTER = 14;
export const SNAP_PX = 8;
/** A drop on an occupied slot moves to a free slot at most this far away (px), else to a new track. */
export const NEAR_SLOT_PX = 100;
export const TRACK_HEIGHT: Record<string, number> = { video: 64, overlay: 52, audio: 48, text: 36, subtitle: 36 };

/**
 * Render counters (incremented in the component bodies). Used by tests and the
 * browser benchmark to verify that playback causes no track/clip re-renders.
 */
export const renderCounts = { timeline: 0, trackRow: 0, clipView: 0 };
// Readable from the browser console / benchmarks in dev builds.
if (import.meta.env?.DEV) (globalThis as { __erdemcutTimelineRenders?: typeof renderCounts }).__erdemcutTimelineRenders = renderCounts;
export function resetRenderCounts(): void {
  renderCounts.timeline = 0;
  renderCounts.trackRow = 0;
  renderCounts.clipView = 0;
}
