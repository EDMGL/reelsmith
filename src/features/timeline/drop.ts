/**
 * Committing drag plans to the store, and HTML5 drops onto the timeline:
 * media-library assets, clip templates and files straight from the OS.
 */
import type { DragEvent } from 'react';
import {
  ASSET_DRAG_MIME,
  CLIP_TEMPLATE_DRAG_MIME,
  clipEnd,
  createClipFromAsset,
  createId,
  getDragPayload,
  importDroppedFiles,
  isFileDrag,
  snapInterval,
  useEditorStore,
  type Clip,
  type Id,
} from '../../core';
import { snapCandidates } from './geometry';
import { planInsert, type Plan } from './placement';
import { HEADER_WIDTH, SNAP_PX, useTimelineUi, type GhostItem } from './timelineUi';
import { hitTest, timelineView, type Hit } from './timelineView';

/**
 * Applies a plan as ONE undo step: creates the planned new track (if any), then
 * runs `run` with a resolver for each ghost's track. Rolls back if `run` fails.
 */
export function commitPlan(plan: Plan, label: string, run: (trackOf: (g: GhostItem) => Id) => boolean): boolean {
  if (!plan.valid || plan.ghosts.length === 0) return false;
  const s = useEditorStore.getState();
  const outer = !!s.transaction;
  s.beginTransaction(label);
  let ok = false;
  let newTrackId: Id | null = null;
  try {
    if (plan.newTrack) newTrackId = s.addTrack(plan.newTrack.kind, { order: plan.newTrack.order });
    ok = run((g) => g.trackId ?? newTrackId!);
  } finally {
    const st = useEditorStore.getState();
    if (ok) st.commitTransaction();
    else if (outer) {
      if (newTrackId) st.removeTrack(newTrackId);
      st.commitTransaction();
    } else st.cancelTransaction();
  }
  return ok;
}

/** Moves the planned clips (clip drag). */
export function commitMove(plan: Plan): boolean {
  return commitPlan(plan, plan.ghosts.length > 1 ? 'Move clips' : 'Move clip', (trackOf) =>
    useEditorStore.getState().moveClipsTo(plan.ghosts.map((g) => ({ id: g.clip.id, start: g.start, trackId: trackOf(g) }))),
  );
}

/** Inserts the planned new clip (media / template drop). Returns its id. */
export function commitInsert(plan: Plan): Id | null {
  let id: Id | null = null;
  commitPlan(plan, 'Add clip', (trackOf) => {
    const g = plan.ghosts[0]!;
    id = useEditorStore.getState().insertClip({ ...g.clip, id: createId('clip') } as Clip, { trackId: trackOf(g), start: g.start });
    return !!id;
  });
  return id;
}

export function acceptsTimelineDrag(e: Pick<DragEvent, 'dataTransfer'>): boolean {
  const types = Array.from(e.dataTransfer.types);
  return types.includes(ASSET_DRAG_MIME) || types.includes(CLIP_TEMPLATE_DRAG_MIME) || isFileDrag(e.dataTransfer);
}

/** Snaps an inserted clip's start (or end) to clip edges / playhead when snapping is on. */
function snapInsert(time: number, duration: number, altKey: boolean): { time: number; line: number | null } {
  const s = useEditorStore.getState();
  if (useTimelineUi.getState().snapping === altKey) return { time, line: null };
  const r = snapInterval(time, duration, snapCandidates(s.project, new Set(), s.currentTime), SNAP_PX / s.zoom);
  return { time: Math.max(0, r.time), line: r.snappedTo };
}

/** A clip template for the dragged asset / template (from the payload or, on drop, the data). */
function draggedClip(dt: DataTransfer | null, onDrop: boolean): Clip | null {
  const s = useEditorStore.getState();
  let assetId: string | undefined;
  let tpl: Clip | undefined;
  const payload = getDragPayload();
  if (payload?.kind === 'asset') assetId = payload.assetId;
  if (payload?.kind === 'clip-template') tpl = payload.clip;
  if (onDrop && dt) {
    assetId = dt.getData(ASSET_DRAG_MIME) || assetId;
    const raw = dt.getData(CLIP_TEMPLATE_DRAG_MIME);
    if (raw) {
      try {
        tpl = JSON.parse(raw) as Clip;
      } catch {
        tpl = undefined;
      }
    }
  }
  if (assetId) {
    const asset = s.project.assets[assetId];
    return asset ? createClipFromAsset(asset, { trackId: '', start: 0 }) : null;
  }
  if (tpl && typeof tpl.duration === 'number' && tpl.duration > 0) return { ...tpl, id: createId('clip') } as Clip;
  return null;
}

/** Scrolls the timeline when a drag is near its edges. Returns true if it scrolled. */
export function edgeAutoScroll(clientX: number, clientY: number, step = 1): boolean {
  const el = timelineView.scroll;
  if (!el) return false;
  const r = el.getBoundingClientRect();
  const EDGE = 40;
  const left = r.left + HEADER_WIDTH;
  let dx = 0;
  let dy = 0;
  if (clientX < left + EDGE) dx = -Math.ceil(((left + EDGE - clientX) / EDGE) * 24);
  else if (clientX > r.right - EDGE) dx = Math.ceil(((clientX - (r.right - EDGE)) / EDGE) * 24);
  if (clientY < r.top + EDGE && clientY > r.top - 200) dy = -Math.ceil(((r.top + EDGE - clientY) / EDGE) * 12);
  else if (clientY > r.bottom - EDGE) dy = Math.ceil(((clientY - (r.bottom - EDGE)) / EDGE) * 12);
  dx = Math.max(-60, Math.min(60, dx)) * step;
  dy = Math.max(-30, Math.min(30, dy)) * step;
  if (!dx && !dy) return false;
  const beforeL = el.scrollLeft;
  const beforeT = el.scrollTop;
  el.scrollLeft = Math.max(0, beforeL + dx);
  el.scrollTop = Math.max(0, beforeT + dy);
  return el.scrollLeft !== beforeL || el.scrollTop !== beforeT;
}

function planForHover(clip: Clip, hit: Hit, altKey: boolean): Plan {
  const s = useEditorStore.getState();
  const snapped = snapInsert(hit.time, clip.duration, altKey);
  useTimelineUi.getState().setSnapLine(snapped.line);
  return planInsert(s.project, clip, { ...hit, time: snapped.time }, s.zoom);
}

let lastOver: { x: number; y: number; alt: boolean; plan: string } | null = null;

/** dragover on the timeline: accepts the drag and updates the landing preview. */
export function handleTimelineDragOver(e: DragEvent): void {
  if (!acceptsTimelineDrag(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  edgeAutoScroll(e.clientX, e.clientY, 0.5);
  // dragover fires continuously even when the pointer rests: skip identical updates.
  const key = `${useEditorStore.getState().zoom}`;
  if (lastOver && lastOver.x === e.clientX && lastOver.y === e.clientY && lastOver.alt === e.altKey && lastOver.plan === key) return;
  lastOver = { x: e.clientX, y: e.clientY, alt: e.altKey, plan: key };
  const hit = hitTest(e.clientX, e.clientY);
  const ui = useTimelineUi.getState();
  const clip = draggedClip(e.dataTransfer, false);
  if (clip) {
    ui.setDrag(planForHover(clip, hit, e.altKey));
    return;
  }
  ui.setSnapLine(null);
  ui.setDrag({ ghosts: [], newTrack: null, valid: true, outcome: 'exact', marker: { time: hit.time, trackId: hit.trackId ?? null } });
}

export function clearDropPreview(): void {
  lastOver = null;
  const ui = useTimelineUi.getState();
  ui.setDrag(null);
  ui.setSnapLine(null);
}

/** dragleave on the timeline: clears the preview once the pointer really left it. */
export function handleTimelineDragLeave(e: DragEvent): void {
  const to = e.relatedTarget as Node | null;
  if (to && (e.currentTarget as Node).contains(to)) return;
  clearDropPreview();
}

/**
 * Drop on the timeline. Assets / templates land exactly where the preview
 * showed; OS files are imported and placed one after another from the drop
 * point (all placements = one undo step). Resolves to the new clip ids.
 */
export async function handleTimelineDrop(e: DragEvent): Promise<Id[]> {
  if (!acceptsTimelineDrag(e)) return [];
  e.preventDefault();
  clearDropPreview();
  const hit = hitTest(e.clientX, e.clientY);
  const altKey = e.altKey;
  const ui = useTimelineUi.getState();
  if (isFileDrag(e.dataTransfer) && e.dataTransfer.files.length > 0) {
    const files = Array.from(e.dataTransfer.files);
    const { imported, failed } = await importDroppedFiles(files);
    if (failed.length) ui.showNotice(`Could not import: ${failed.join(', ')}`);
    return placeAssets(imported, hit, altKey);
  }
  const clip = draggedClip(e.dataTransfer, true);
  if (!clip) return [];
  const plan = planForHover(clip, hit, altKey);
  ui.setSnapLine(null);
  const id = commitInsert(plan);
  if (!id) ui.showNotice('Could not place the clip here');
  return id ? [id] : [];
}

/** Places assets one after another starting at `hit` (one undo step). */
export function placeAssets(assetIds: readonly Id[], hit: Hit, altKey = false): Id[] {
  const out: Id[] = [];
  if (assetIds.length === 0) return out;
  const s = useEditorStore.getState();
  s.transact('Add media', () => {
    let at: Hit = hit;
    assetIds.forEach((assetId, i) => {
      const st = useEditorStore.getState();
      const asset = st.project.assets[assetId];
      if (!asset) return;
      const clip = createClipFromAsset(asset, { trackId: '', start: 0 });
      const plan = i === 0 ? planForHover(clip, at, altKey) : planInsert(st.project, clip, at, st.zoom);
      const id = commitInsert(plan);
      if (!id) return;
      out.push(id);
      const placed = useEditorStore.getState().project.clips[id]!;
      // The next file goes right after this one, on the same track (if compatible).
      at = { time: clipEnd(placed), trackId: placed.trackId };
    });
  });
  useTimelineUi.getState().setSnapLine(null);
  if (out.length) useEditorStore.getState().selectClips(out);
  return out;
}
