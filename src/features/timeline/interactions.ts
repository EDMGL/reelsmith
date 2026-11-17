/**
 * Pointer gestures on the timeline: clip move (snapping, cross-track, new
 * track, free-slot resolution), edge trimming, ruler scrubbing.
 *
 * Every gesture runs through `runGesture`, which guarantees that it ENDS:
 * pointerup commits; pointercancel, Escape, window blur and tab switch cancel.
 * Moves are applied once at the end (one undo step); trims run in a store
 * transaction that is committed or cancelled — never left open.
 */
import type { PointerEvent as ReactPointerEvent } from 'react';
import { ops, snapInterval, snapTime, useEditorStore, type Clip } from '../../core';
import { commitMove, edgeAutoScroll } from './drop';
import { snapCandidates } from './geometry';
import { planMove, type Plan } from './placement';
import { SNAP_PX, useTimelineUi } from './timelineUi';
import { hitTest, pointerTime } from './timelineView';

const DRAG_THRESHOLD = 3;

export interface PointerSample {
  clientX: number;
  clientY: number;
  altKey: boolean;
}

export interface GestureHandlers {
  /** Pointer moved (also called after an auto-scroll step with the last sample). */
  move(p: PointerSample): void;
  /** Gesture over: `commit` = pointerup; false = cancelled (Esc, blur, pointercancel, new gesture). */
  end(commit: boolean, p: PointerSample | null): void;
  /** Scroll the timeline while the pointer is near its edges. */
  autoScroll?: boolean;
}

let activeCancel: (() => void) | null = null;

/** Cancels the gesture in progress, if any. */
export function cancelActiveGesture(): void {
  activeCancel?.();
}

/** True while a pointer gesture is in progress. */
export function isGestureActive(): boolean {
  return activeCancel !== null;
}

export function runGesture(h: GestureHandlers): void {
  cancelActiveGesture();
  let last: PointerSample | null = null;
  let done = false;
  let raf = 0;
  const sample = (e: PointerEvent | MouseEvent): PointerSample => ({ clientX: e.clientX, clientY: e.clientY, altKey: e.altKey });
  const onMove = (e: PointerEvent) => {
    last = sample(e);
    h.move(last);
  };
  const onUp = (e: PointerEvent) => finish(true, sample(e));
  const onCancel = () => finish(false, last);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      finish(false, last);
    } else if (e.key === 'Alt' && last) {
      last = { ...last, altKey: e.type === 'keydown' };
      h.move(last);
    }
  };
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') finish(false, last);
  };
  const tick = () => {
    raf = 0;
    if (done) return;
    if (last && edgeAutoScroll(last.clientX, last.clientY)) h.move(last);
    raf = requestAnimationFrame(tick);
  };
  function finish(commit: boolean, p: PointerSample | null) {
    if (done) return;
    done = true;
    activeCancel = null;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('keyup', onKey, true);
    window.removeEventListener('blur', onCancel);
    document.removeEventListener('visibilitychange', onVisibility);
    if (raf) cancelAnimationFrame(raf);
    h.end(commit, p);
  }
  activeCancel = () => finish(false, last);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('keyup', onKey, true);
  window.addEventListener('blur', onCancel);
  document.addEventListener('visibilitychange', onVisibility);
  if (h.autoScroll && typeof requestAnimationFrame !== 'undefined') raf = requestAnimationFrame(tick);
}

function snappingOn(altKey: boolean): boolean {
  return useTimelineUi.getState().snapping !== altKey;
}

/** Starts a move gesture on a clip body. */
export function startClipMove(e: ReactPointerEvent, clip: Clip): void {
  if (e.button !== 0) return;
  e.stopPropagation();
  const store = useEditorStore.getState();
  const ui = useTimelineUi.getState();
  ui.closeMenu();
  const additive = e.shiftKey || e.metaKey || e.ctrlKey;
  if (additive) {
    store.selectClips([clip.id], 'toggle');
    return;
  }
  const wasSelected = store.selectedClipIds.includes(clip.id);
  if (!wasSelected) store.selectClips([clip.id]);
  const project = useEditorStore.getState().project;
  const ids = (wasSelected ? store.selectedClipIds : [clip.id]).filter((id) => ops.isClipEditable(project, id));
  const locked = !ids.includes(clip.id);
  const startX = e.clientX;
  const startY = e.clientY;
  const t0 = pointerTime(e.clientX);
  const candidates = snapCandidates(project, new Set(ids), store.currentTime);
  let moved = false;
  let plan: Plan | null = null;

  runGesture({
    autoScroll: true,
    move(p) {
      if (locked) return;
      if (!moved && Math.abs(p.clientX - startX) < DRAG_THRESHOLD && Math.abs(p.clientY - startY) < DRAG_THRESHOLD) return;
      if (!moved) {
        moved = true;
        ui.setDraggingIds(new Set(ids));
      }
      const s = useEditorStore.getState();
      let start = clip.start + (pointerTime(p.clientX) - t0);
      let line: number | null = null;
      if (snappingOn(p.altKey)) {
        const r = snapInterval(start, clip.duration, candidates, SNAP_PX / s.zoom);
        start = r.time;
        line = r.snappedTo;
      }
      plan = planMove(s.project, { ids, anchorId: clip.id, delta: start - clip.start, hit: hitTest(p.clientX, p.clientY), zoom: s.zoom });
      ui.setSnapLine(line);
      ui.setDrag(plan);
    },
    end(commit) {
      ui.setDrag(null);
      ui.setSnapLine(null);
      if (moved) ui.setDraggingIds(null);
      const s = useEditorStore.getState();
      if (!moved) {
        if (commit && wasSelected && s.selectedClipIds.length > 1) s.selectClips([clip.id]);
        return;
      }
      if (!commit || !plan) return;
      if (!plan.valid || !commitMove(plan)) ui.showNotice('No room to place the clip there');
    },
  });
}

/** Starts a trim gesture on a clip edge handle. */
export function startClipTrim(e: ReactPointerEvent, clip: Clip, edge: ops.TrimEdge): void {
  if (e.button !== 0) return;
  e.stopPropagation();
  e.preventDefault();
  const store = useEditorStore.getState();
  if (!ops.isClipEditable(store.project, clip.id)) return;
  store.selectClips([clip.id]);
  const ui = useTimelineUi.getState();
  ui.closeMenu();
  const startX = e.clientX;
  const t0 = pointerTime(e.clientX);
  const edgeTime = edge === 'start' ? clip.start : clip.start + clip.duration;
  const candidates = snapCandidates(store.project, new Set([clip.id]), store.currentTime);
  let began = false;
  runGesture({
    autoScroll: true,
    move(p) {
      if (!began && Math.abs(p.clientX - startX) < 1) return;
      const s = useEditorStore.getState();
      let t = edgeTime + (pointerTime(p.clientX) - t0);
      let line: number | null = null;
      if (snappingOn(p.altKey)) {
        const r = snapTime(t, candidates, SNAP_PX / s.zoom);
        t = r.time;
        line = r.snappedTo;
      }
      if (!began) {
        s.beginTransaction('Trim clip');
        began = true;
      }
      ui.setSnapLine(line);
      useEditorStore.getState().trimClip(clip.id, edge, t);
    },
    end(commit) {
      ui.setSnapLine(null);
      if (!began) return;
      if (commit) useEditorStore.getState().commitTransaction();
      else useEditorStore.getState().cancelTransaction();
    },
  });
}

/** Scrub gesture: seeks while dragging on the ruler (or the playhead head). */
export function startScrub(e: ReactPointerEvent): void {
  if (e.button !== 0) return;
  e.preventDefault();
  const seek = (x: number) => useEditorStore.getState().setCurrentTime(Math.max(0, pointerTime(x)));
  seek(e.clientX);
  runGesture({ move: (p) => seek(p.clientX), end: () => undefined });
}
