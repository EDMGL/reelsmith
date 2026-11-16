/**
 * Pointer interactions for clips: move (with snapping and cross-track drag)
 * and edge trimming (live, grouped into one undo step via a transaction).
 * Uses window listeners so the gesture survives re-mounts of the clip element.
 */
import type { PointerEvent as ReactPointerEvent } from 'react';
import { getTrack, ops, snapInterval, snapTime, trackAccepts, useEditorStore, type Clip, type Id } from '../../core';
import { snapCandidates } from './geometry';
import { SNAP_PX, useTimelineUi } from './timelineUi';

const DRAG_THRESHOLD = 3;

function trackIdAtPoint(x: number, y: number): Id | undefined {
  const el = document.elementFromPoint(x, y);
  const lane = el instanceof Element ? el.closest<HTMLElement>('[data-lane-track-id]') : null;
  return lane?.dataset.laneTrackId;
}

function track(onMove: (e: PointerEvent) => void, onEnd: (e: PointerEvent | null) => void) {
  const move = (e: PointerEvent) => onMove(e);
  const up = (e: PointerEvent) => {
    cleanup();
    onEnd(e);
  };
  const cancel = () => {
    cleanup();
    onEnd(null);
  };
  function cleanup() {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
  }
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
}

/** Starts a move gesture on a clip body. */
export function startClipMove(e: ReactPointerEvent, clip: Clip): void {
  if (e.button !== 0) return;
  e.stopPropagation();
  const store = useEditorStore.getState();
  const ui = useTimelineUi.getState();
  const additive = e.shiftKey || e.metaKey || e.ctrlKey;
  if (additive) {
    store.selectClips([clip.id], 'toggle');
    return;
  }
  const wasSelected = store.selectedClipIds.includes(clip.id);
  if (!wasSelected) store.selectClips([clip.id]);
  const project = useEditorStore.getState().project;
  const ids = (wasSelected ? store.selectedClipIds : [clip.id]).filter((id) => ops.isClipEditable(project, id));
  if (!ids.includes(clip.id)) return; // locked
  const zoom = store.zoom;
  const startX = e.clientX;
  const startY = e.clientY;
  const candidates = snapCandidates(project, new Set(ids), store.currentTime);
  let moved = false;
  let last: { start: number; trackId: Id; delta: number; valid: boolean } | null = null;

  track(
    (ev) => {
      const dx = ev.clientX - startX;
      if (!moved && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(ev.clientY - startY) < DRAG_THRESHOLD) return;
      moved = true;
      let start = Math.max(0, clip.start + dx / zoom);
      let snapLine: number | null = null;
      if (useTimelineUi.getState().snapping !== ev.altKey) {
        const r = snapInterval(start, clip.duration, candidates, SNAP_PX / zoom);
        start = Math.max(0, r.time);
        snapLine = r.snappedTo;
      }
      let trackId = clip.trackId;
      if (ids.length === 1) {
        const tid = trackIdAtPoint(ev.clientX, ev.clientY);
        const t = tid ? getTrack(project, tid) : undefined;
        if (t && !t.locked && trackAccepts(t, clip.type)) trackId = t.id;
      }
      const delta = start - clip.start;
      const valid =
        ids.length === 1
          ? ops.updateClip(project, clip.id, { start, trackId }) !== null
          : ops.moveClips(project, ids, delta) !== null;
      last = { start, trackId, delta, valid };
      ui.setSnapLine(snapLine);
      ui.setDrag({ ids, delta, trackId: trackId !== clip.trackId ? trackId : undefined, valid });
    },
    (ev) => {
      ui.setDrag(null);
      ui.setSnapLine(null);
      const s = useEditorStore.getState();
      if (moved && last && ev) {
        if (ids.length === 1) s.moveClip(clip.id, last.start, last.trackId);
        else s.moveClips(ids, last.delta);
      } else if (!moved && wasSelected && s.selectedClipIds.length > 1) {
        s.selectClips([clip.id]);
      }
    },
  );
}

/** Starts a trim gesture on a clip edge handle. */
export function startClipTrim(e: ReactPointerEvent, clip: Clip, edge: ops.TrimEdge): void {
  if (e.button !== 0) return;
  e.stopPropagation();
  const store = useEditorStore.getState();
  if (!ops.isClipEditable(store.project, clip.id)) return;
  store.selectClips([clip.id]);
  const ui = useTimelineUi.getState();
  const zoom = store.zoom;
  const startX = e.clientX;
  const edgeTime = edge === 'start' ? clip.start : clip.start + clip.duration;
  const candidates = snapCandidates(store.project, new Set([clip.id]), store.currentTime);
  store.beginTransaction('Trim clip');
  track(
    (ev) => {
      let t = edgeTime + (ev.clientX - startX) / zoom;
      let line: number | null = null;
      if (useTimelineUi.getState().snapping !== ev.altKey) {
        const r = snapTime(t, candidates, SNAP_PX / zoom);
        t = r.time;
        line = r.snappedTo;
      }
      ui.setSnapLine(line);
      useEditorStore.getState().trimClip(clip.id, edge, t);
    },
    (ev) => {
      ui.setSnapLine(null);
      if (ev) useEditorStore.getState().commitTransaction();
      else useEditorStore.getState().cancelTransaction();
    },
  );
}

/** Scrub gesture: seeks while dragging on the ruler (or the playhead head). */
export function startScrub(e: ReactPointerEvent, clientXToTime: (x: number) => number): void {
  if (e.button !== 0) return;
  e.preventDefault();
  const seek = (x: number) => useEditorStore.getState().setCurrentTime(Math.max(0, clientXToTime(x)));
  seek(e.clientX);
  track(
    (ev) => seek(ev.clientX),
    () => undefined,
  );
}
