/**
 * Preview overlay: selection box + transform handles for the selected visual
 * clip (video / image / text), click-to-select, drag to move (with snapping to
 * canvas center/edges), corner handles to scale about the center, a rotate
 * handle, and arrow-key nudging.
 *
 * Pointer handling without blocking the preview: the overlay itself is
 * `pointer-events: none` except for the handles. Clicks on the canvas are
 * observed with a native listener on the element hosting the overlay layer
 * (they bubble up from the canvas), so whatever P2 renders keeps its events.
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useEditorStore, type PreviewOverlayProps, type Transform, type VisualClip } from '../../core';
import { getSharedMeasure } from '../text/textLayout';
import { clipBox, hitTestClips, visualClipsAt, type ClipBox, type Point } from './geometry';
import { moveTransform, nudgeTransform, rotationFromDrag, scaleFromDrag, type Guide } from './transformMath';
import './overlays.css';

const SNAP_PX = 6; // display px
const HIT_TOLERANCE_PX = 3; // display px

type DragMode = 'move' | 'scale' | 'rotate';

interface DragState {
  mode: DragMode;
  clipId: string;
  startPointer: Point;
  startTransform: Transform;
  box: ClipBox;
  moved: boolean;
}

function sameTransform(a: Transform, b: Transform): boolean {
  return a.x === b.x && a.y === b.y && a.scale === b.scale && a.rotation === b.rotation && a.opacity === b.opacity;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return !['button', 'checkbox', 'radio', 'range', 'color', 'submit', 'reset'].includes((target as HTMLInputElement).type);
  return false;
}

/** The selected visual clip if exactly one is selected and it is drawn at the playhead. */
function useSelectedVisual(): { clip: VisualClip; locked: boolean } | null {
  const ids = useEditorStore((s) => s.selectedClipIds);
  const t = useEditorStore((s) => s.currentTime);
  const project = useEditorStore((s) => s.project);
  if (ids.length !== 1) return null;
  const hit = visualClipsAt(project, t, getSharedMeasure(), true).find((h) => h.clip.id === ids[0]);
  return hit ? { clip: hit.clip, locked: hit.track.locked } : null;
}

export default function TransformOverlay({ project, displayWidth, displayHeight, scale }: PreviewOverlayProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const activeRef = useRef(false); // preview "has focus" for arrow-key nudging
  const [guides, setGuides] = useState<Guide[]>([]);
  const [dragging, setDragging] = useState<DragMode | null>(null);
  const [, setFontTick] = useState(0);
  const selected = useSelectedVisual();

  /** Client coords -> project px, using the live rect of the overlay (robust to CSS transitions). */
  const toProject = useCallback((clientX: number, clientY: number): Point => {
    const el = rootRef.current;
    const p = useEditorStore.getState().project;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    const sx = r.width > 0 ? p.width / r.width : 1;
    const sy = r.height > 0 ? p.height / r.height : 1;
    return { x: (clientX - r.left) * sx, y: (clientY - r.top) * sy };
  }, []);

  const displayScale = useCallback(() => {
    const el = rootRef.current;
    const p = useEditorStore.getState().project;
    const w = el?.getBoundingClientRect().width || 0;
    return w > 0 && p.width > 0 ? w / p.width : scale || 1;
  }, [scale]);

  const startDrag = useCallback(
    (mode: DragMode, clip: VisualClip, box: ClipBox, e: PointerEvent | ReactPointerEvent) => {
      const s = useEditorStore.getState();
      dragRef.current = { mode, clipId: clip.id, startPointer: toProject(e.clientX, e.clientY), startTransform: clip.transform, box, moved: false };
      s.beginTransaction(mode === 'move' ? 'Move clip' : mode === 'scale' ? 'Scale clip' : 'Rotate clip');
      setDragging(mode);

      const onMove = (ev: PointerEvent) => {
        const d = dragRef.current;
        if (!d) return;
        const st = useEditorStore.getState();
        const p = toProject(ev.clientX, ev.clientY);
        const W = st.project.width;
        const H = st.project.height;
        const center = { x: d.startTransform.x * W, y: d.startTransform.y * H };
        let next: Transform;
        let g: Guide[] = [];
        if (d.mode === 'move') {
          const dx = p.x - d.startPointer.x;
          const dy = p.y - d.startPointer.y;
          if (!d.moved && Math.hypot(dx, dy) * displayScale() < 2) return; // click, not drag
          const r = moveTransform(d.startTransform, d.box, dx, dy, W, H, ev.altKey ? 0 : SNAP_PX / displayScale());
          next = r.transform;
          g = r.guides;
        } else if (d.mode === 'scale') {
          next = { ...d.startTransform, scale: scaleFromDrag(d.startTransform.scale, center, d.startPointer, p) };
        } else {
          next = { ...d.startTransform, rotation: rotationFromDrag(d.startTransform.rotation, center, d.startPointer, p, ev.shiftKey ? 15 : 0) };
        }
        d.moved = true;
        st.updateClip(d.clipId, { transform: next });
        setGuides(g);
      };
      const finish = (cancel: boolean) => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        window.removeEventListener('keydown', onKey, true);
        const d = dragRef.current;
        dragRef.current = null;
        setGuides([]);
        setDragging(null);
        const st = useEditorStore.getState();
        const end = st.project.clips[d?.clipId ?? ''];
        const unchanged = !!d && !!end && 'transform' in end && sameTransform(end.transform, d.startTransform);
        // A drag that ends where it started leaves no history entry.
        if (cancel || unchanged) st.cancelTransaction();
        else st.commitTransaction();
      };
      const onUp = () => finish(false);
      const onCancel = () => finish(true);
      const onKey = (ev: KeyboardEvent) => {
        if (ev.key === 'Escape') {
          ev.preventDefault();
          ev.stopPropagation();
          finish(true);
        }
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
      window.addEventListener('keydown', onKey, true);
    },
    [toProject, displayScale],
  );

  // Click-to-select / drag-to-move on the canvas host (non-blocking native listener).
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const host = (root.closest('.preview-overlay-layer')?.parentElement ?? root.parentElement) as HTMLElement | null;
    if (!host) return;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || e.defaultPrevented || dragRef.current) return;
      if (e.target instanceof Element && e.target.closest('[data-p3-handle]')) return;
      activeRef.current = true;
      const s = useEditorStore.getState();
      const ds = displayScale();
      const prefer = s.selectedClipIds.length === 1 ? s.selectedClipIds[0] : null;
      const hit = hitTestClips(s.project, s.currentTime, toProject(e.clientX, e.clientY), getSharedMeasure(), prefer, HIT_TOLERANCE_PX / ds);
      if (!hit) {
        if (!e.shiftKey) s.clearSelection();
        return;
      }
      // Handled: keep the event from reaching "click on bare canvas = deselect" handlers of the
      // preview host (they run after us, on React's root listener) and avoid text selection.
      e.stopPropagation();
      e.preventDefault();
      s.selectClips([hit.clip.id], e.shiftKey ? 'toggle' : 'replace');
      if (!e.shiftKey && !hit.track.locked) startDrag('move', hit.clip, hit.box, e);
    };
    const onGlobalDown = (e: PointerEvent) => {
      if (!(e.target instanceof Node) || !host.contains(e.target)) activeRef.current = false;
    };
    host.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerdown', onGlobalDown, true);
    return () => {
      host.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerdown', onGlobalDown, true);
    };
  }, [startDrag, toProject, displayScale]);

  // Arrow keys nudge the selected clip while the preview is the active area (capture phase,
  // so the global frame-step shortcut sees `defaultPrevented` and stays quiet).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!activeRef.current || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (!dir) return;
      const s = useEditorStore.getState();
      if (s.selectedClipIds.length !== 1) return;
      const clip = s.project.clips[s.selectedClipIds[0]!];
      if (!clip || (clip.type !== 'video' && clip.type !== 'image' && clip.type !== 'text')) return;
      const track = s.project.tracks.find((t) => t.id === clip.trackId);
      if (!track || track.locked) return;
      e.preventDefault();
      s.updateClip(clip.id, { transform: nudgeTransform(clip.transform, dir[0]!, dir[1]!, e.shiftKey ? 10 : 1, s.project.width, s.project.height) });
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // Re-measure text when web fonts (e.g. an imported font) finish loading.
  useEffect(() => {
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    if (!fonts?.addEventListener) return;
    const bump = () => setFontTick((n) => n + 1);
    fonts.addEventListener('loadingdone', bump);
    return () => fonts.removeEventListener('loadingdone', bump);
  }, []);

  const box = selected ? clipBox(selected.clip, project, getSharedMeasure()) : null;
  const sc = scale;

  return (
    <div ref={rootRef} className="p3-xf-root" data-testid="transform-overlay" style={{ width: displayWidth, height: displayHeight }}>
      {guides.map((g, i) =>
        g.axis === 'x' ? (
          <div key={i} className="p3-xf-guide p3-xf-guide-v" style={{ left: g.pos * sc }} />
        ) : (
          <div key={i} className="p3-xf-guide p3-xf-guide-h" style={{ top: g.pos * sc }} />
        ),
      )}
      {selected && box && (
        <div
          className={`p3-xf-box${selected.locked ? ' locked' : ''}${dragging ? ' dragging' : ''}`}
          data-testid="transform-box"
          data-clip-id={selected.clip.id}
          style={{
            left: box.cx * sc,
            top: box.cy * sc,
            width: Math.abs(box.width * box.scale * sc),
            height: Math.abs(box.height * box.scale * sc),
            transform: `translate(-50%, -50%) rotate(${box.rotation}deg)`,
          }}
        >
          {selected.locked ? (
            <span className="p3-xf-lock" title="Track is locked">
              🔒
            </span>
          ) : (
            <>
              {(['nw', 'ne', 'se', 'sw'] as const).map((corner) => (
                <div
                  key={corner}
                  className={`p3-xf-handle p3-xf-${corner}`}
                  data-p3-handle="scale"
                  data-testid={`handle-${corner}`}
                  title="Drag to scale"
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    e.preventDefault();
                    e.stopPropagation();
                    activeRef.current = true;
                    startDrag('scale', selected.clip, box, e);
                  }}
                />
              ))}
              <div className="p3-xf-stem" />
              <div
                className="p3-xf-rotate"
                data-p3-handle="rotate"
                data-testid="handle-rotate"
                title="Drag to rotate (Shift: 15° steps)"
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  e.preventDefault();
                  e.stopPropagation();
                  activeRef.current = true;
                  startDrag('rotate', selected.clip, box, e);
                }}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
