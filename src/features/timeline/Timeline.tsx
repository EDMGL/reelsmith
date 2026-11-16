import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import {
  Slot,
  getProjectDuration,
  pxToTime,
  timeToPx,
  timelineOverlayRegistry,
  useEditorStore,
  useRegistry,
  type Clip,
  type Id,
  type TimelineOverlayProps,
  type Track,
  type TrackLayout,
} from '../../core';
import { clipsInBox, contentWidthPx, displayTracks } from './geometry';
import { startScrub } from './interactions';
import { Ruler } from './Ruler';
import { TimelineToolbar } from './TimelineToolbar';
import { acceptsTimelineDrag, handleTimelineDrop, TrackRow } from './TrackRow';
import { HEADER_WIDTH, RULER_HEIGHT, TRACK_HEIGHT, useTimelineUi } from './timelineUi';
import './timeline.css';

function Overlays(props: TimelineOverlayProps) {
  const overlays = useRegistry(timelineOverlayRegistry);
  return (
    <div className="timeline-overlays" style={{ left: HEADER_WIDTH, width: props.width, height: props.height }}>
      {overlays.map((o) => (
        <div key={o.id} className="timeline-overlay">
          <Slot name={o.id} component={o.component} props={props} />
        </div>
      ))}
    </div>
  );
}

export function Timeline({ toolbarExtras }: { toolbarExtras?: ReactNode }) {
  const project = useEditorStore((s) => s.project);
  const zoom = useEditorStore((s) => s.zoom);
  const currentTime = useEditorStore((s) => s.currentTime);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const drag = useTimelineUi((s) => s.drag);
  const snapLine = useTimelineUi((s) => s.snapLine);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowsRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ left: 0, width: 800 });

  const duration = getProjectDuration(project);
  const lanesViewport = Math.max(100, view.width - HEADER_WIDTH);
  const contentWidth = contentWidthPx(duration, zoom, lanesViewport);
  const tracks = useMemo(() => displayTracks(project), [project]);

  const clipsByTrack = useMemo(() => {
    const m = new Map<Id, Clip[]>();
    for (const t of project.tracks) m.set(t.id, []);
    for (const c of Object.values(project.clips)) m.get(c.trackId)?.push(c);
    return m;
  }, [project]);

  const incomingByTrack = useMemo(() => {
    const m = new Map<Id, Clip[]>();
    if (drag?.trackId) {
      const moved = drag.ids.map((id) => project.clips[id]).filter((c): c is Clip => !!c && c.trackId !== drag.trackId);
      m.set(drag.trackId, moved);
    }
    return m;
  }, [drag, project]);

  const layout: TrackLayout[] = useMemo(() => {
    let top = 0;
    return tracks.map((t) => {
      const h = TRACK_HEIGHT[t.kind] ?? 48;
      const l = { trackId: t.id, top, height: h };
      top += h;
      return l;
    });
  }, [tracks]);
  const rowsHeight = layout.reduce((s, l) => s + l.height, 0);

  // Box selection: drag on empty lane space. A click without dragging keeps the
  // old behaviour (clear selection, select the track, move the playhead).
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const onLanePointerDown = useCallback((e: ReactPointerEvent, track: Track) => {
    const rows = rowsRef.current;
    if (!rows) return;
    const toLocal = (cx: number, cy: number) => {
      const r = rows.getBoundingClientRect();
      return { x: cx - r.left - HEADER_WIDTH, y: cy - r.top };
    };
    const start = toLocal(e.clientX, e.clientY);
    const s0 = useEditorStore.getState();
    const base = e.shiftKey || e.metaKey || e.ctrlKey ? s0.selectedClipIds : [];
    let dragging = false;
    const onMove = (ev: PointerEvent) => {
      const p = toLocal(ev.clientX, ev.clientY);
      if (!dragging && Math.hypot(p.x - start.x, p.y - start.y) < 4) return;
      dragging = true;
      setBox({ x0: start.x, y0: start.y, x1: p.x, y1: p.y });
      const s = useEditorStore.getState();
      const hit = clipsInBox(s.project, layoutRef.current, pxToTime(start.x, s.zoom), pxToTime(p.x, s.zoom), start.y, p.y);
      s.selectClips([...new Set([...base, ...hit])]);
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      setBox(null);
      if (dragging) return;
      const s = useEditorStore.getState();
      s.clearSelection();
      s.selectTrack(track.id);
      s.setCurrentTime(Math.max(0, pxToTime(toLocal(ev.clientX, ev.clientY).x, s.zoom)));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }, []);

  const clientXToTime = useCallback(
    (clientX: number) => {
      const rect = rowsRef.current?.getBoundingClientRect();
      if (!rect) return 0;
      return Math.max(0, pxToTime(clientX - rect.left - HEADER_WIDTH, useEditorStore.getState().zoom));
    },
    [],
  );

  // Track viewport size / scroll.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setView({ left: el.scrollLeft, width: el.clientWidth });
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro?.disconnect();
    };
  }, []);

  // Ctrl/Cmd + wheel zooms around the cursor (non-passive listener to block page zoom).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const s = useEditorStore.getState();
      const rect = el.getBoundingClientRect();
      const cursorX = e.clientX - rect.left - HEADER_WIDTH;
      const t = (el.scrollLeft + cursorX) / s.zoom;
      s.setZoom(s.zoom * Math.exp(-e.deltaY * 0.0025));
      requestAnimationFrame(() => {
        el.scrollLeft = Math.max(0, t * useEditorStore.getState().zoom - cursorX);
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Keep the playhead visible while playing.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !isPlaying) return;
    const x = currentTime * zoom;
    const visibleW = el.clientWidth - HEADER_WIDTH;
    if (x < el.scrollLeft || x > el.scrollLeft + visibleW - 40) el.scrollLeft = Math.max(0, x - 40);
  }, [currentTime, isPlaying, zoom]);

  const overlayProps: TimelineOverlayProps = {
    pxPerSecond: zoom,
    timeToPx: (t) => timeToPx(t, zoom),
    pxToTime: (px) => pxToTime(px, zoom),
    width: contentWidth,
    height: rowsHeight,
    tracks: layout,
  };

  const viewStart = pxToTime(view.left, zoom);
  const viewEnd = viewStart + pxToTime(lanesViewport, zoom);

  return (
    <div className="timeline">
      <TimelineToolbar viewportPx={lanesViewport} extras={toolbarExtras} />
      <div className="timeline-scroll" ref={scrollRef}>
        <div className="timeline-inner" style={{ width: HEADER_WIDTH + contentWidth }}>
          <div className="ruler-row" style={{ height: RULER_HEIGHT }}>
            <div className="ruler-corner" style={{ width: HEADER_WIDTH }} />
            <div className="ruler-wrap">
              <Ruler zoom={zoom} width={contentWidth} viewStart={viewStart} viewEnd={viewEnd} onPointerDown={(e) => startScrub(e, clientXToTime)} />
              <div
                className="playhead-head"
                style={{ left: currentTime * zoom }}
                onPointerDown={(e) => startScrub(e, clientXToTime)}
                aria-hidden
              />
            </div>
          </div>
          <div className="rows" ref={rowsRef}>
            {tracks.map((t) => (
              <TrackRow
                key={t.id}
                track={t}
                clips={clipsByTrack.get(t.id) ?? []}
                incoming={incomingByTrack.get(t.id) ?? []}
                zoom={zoom}
                contentWidth={contentWidth}
                canDelete={tracks.length > 1}
                clientXToTime={clientXToTime}
                onLanePointerDown={onLanePointerDown}
              />
            ))}
            <div
              className="new-track-drop"
              style={{ marginLeft: HEADER_WIDTH, width: contentWidth }}
              onDragOver={(e) => {
                if (!acceptsTimelineDrag(e)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
              }}
              onDrop={(e) => handleTimelineDrop(e, clientXToTime(e.clientX))}
              onPointerDown={(e) => {
                if (e.button === 0) {
                  useEditorStore.getState().clearSelection();
                  useEditorStore.getState().setCurrentTime(clientXToTime(e.clientX));
                }
              }}
            >
              {Object.keys(project.clips).length === 0 && <span>Drag media here, or press + on an item in the media library</span>}
            </div>
            <Overlays {...overlayProps} />
 {box && (
              <div
                className="select-box"
                data-testid="select-box"
                style={{
                  left: HEADER_WIDTH + Math.min(box.x0, box.x1),
                  top: Math.min(box.y0, box.y1),
                  width: Math.abs(box.x1 - box.x0),
                  height: Math.abs(box.y1 - box.y0),
                }}
              />
            )}
            {snapLine !== null && <div className="snap-line" style={{ left: HEADER_WIDTH + snapLine * zoom }} />}
            <div className="playhead-line" style={{ left: HEADER_WIDTH + currentTime * zoom }} />
          </div>
        </div>
      </div>
    </div>
  );
}
