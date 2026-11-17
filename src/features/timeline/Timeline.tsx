import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import {
  Icon,
  Slot,
  getProjectDuration,
  pxToTime,
  timeToPx,
  timelineOverlayRegistry,
  useEditorStore,
  useRegistry,
  type Clip,
  type Id,
  type Project,
  type TimelineOverlayProps,
  type Track,
  type TrackLayout,
} from '../../core';
import { ContextMenu } from './ContextMenu';
import { DragLayer } from './DragLayer';
import { clearDropPreview, handleTimelineDragLeave, handleTimelineDragOver, handleTimelineDrop } from './drop';
import { clipsInBox, contentWidthPx, displayTracks } from './geometry';
import { runGesture, startScrub } from './interactions';
import { PlayheadMarker } from './Playhead';
import { Ruler } from './Ruler';
import { TimelineToolbar } from './TimelineToolbar';
import { TrackRow } from './TrackRow';
import { HEADER_WIDTH, RULER_HEIGHT, TOP_GUTTER, TRACK_HEIGHT, renderCounts, useTimelineUi } from './timelineUi';
import { pointerTime, timelineView } from './timelineView';
import './timeline.css';

function Overlays(props: TimelineOverlayProps) {
  const overlays = useRegistry(timelineOverlayRegistry);
  if (overlays.length === 0) return null;
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

function Notice() {
  const notice = useTimelineUi((s) => s.notice);
  if (!notice) return null;
  return (
    <div key={notice.key} className="timeline-notice" role="status">
      {notice.text}
    </div>
  );
}

const EMPTY: readonly Clip[] = [];

/**
 * Per-track clip lists sorted by start. A track's array keeps its identity when
 * none of its clips changed, so memoized rows of untouched tracks skip rendering.
 */
function useClipsByTrack(project: Project): Map<Id, readonly Clip[]> {
  const prev = useRef(new Map<Id, readonly Clip[]>());
  return useMemo(() => {
    const groups = new Map<Id, Clip[]>();
    for (const t of project.tracks) groups.set(t.id, []);
    for (const c of Object.values(project.clips)) groups.get(c.trackId)?.push(c);
    const out = new Map<Id, readonly Clip[]>();
    for (const [id, list] of groups) {
      list.sort((a, b) => a.start - b.start);
      const old = prev.current.get(id);
      out.set(id, old && old.length === list.length && old.every((c, i) => c === list[i]) ? old : list);
    }
    prev.current = out;
    return out;
  }, [project.clips, project.tracks]);
}

/** Mounted window = 3 viewport-wide chunks around the visible one (changes only when a chunk boundary is crossed). */
function windowFor(scrollLeft: number, viewportPx: number): { chunk: number; idx: number } {
  const chunk = Math.max(400, viewportPx);
  return { chunk, idx: Math.floor(Math.max(0, scrollLeft) / chunk) };
}

export function Timeline({ toolbarExtras }: { toolbarExtras?: ReactNode }) {
  renderCounts.timeline++;
  const project = useEditorStore((s) => s.project);
  const zoom = useEditorStore((s) => s.zoom);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowsRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ idx: 0, width: 800 });

  const duration = getProjectDuration(project);
  const lanesViewport = Math.max(100, view.width - HEADER_WIDTH);
  const contentWidth = contentWidthPx(duration, zoom, lanesViewport);
  const projectTracks = project.tracks;
  const tracks = useMemo(() => displayTracks({ tracks: projectTracks }), [projectTracks]);
  const clipsByTrack = useClipsByTrack(project);

  const layout: TrackLayout[] = useMemo(() => {
    let top = TOP_GUTTER;
    return tracks.map((t) => {
      const h = TRACK_HEIGHT[t.kind] ?? 48;
      const l = { trackId: t.id, top, height: h };
      top += h;
      return l;
    });
  }, [tracks]);
  const rowsHeight = layout.length ? layout[layout.length - 1]!.top + layout[layout.length - 1]!.height : TOP_GUTTER;

  useLayoutEffect(() => {
    timelineView.layout = layout;
  }, [layout]);
  useLayoutEffect(() => {
    timelineView.rows = rowsRef.current;
    timelineView.scroll = scrollRef.current;
    return () => {
      timelineView.rows = null;
      timelineView.scroll = null;
    };
  }, []);

  // Box selection: drag on empty lane space. A click without dragging clears
  // the selection, selects the track and moves the playhead.
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const onLanePointerDown = useCallback((e: ReactPointerEvent, track: Track) => {
    const rows = rowsRef.current;
    if (!rows) return;
    useTimelineUi.getState().closeMenu();
    const toLocal = (cx: number, cy: number) => {
      const r = rows.getBoundingClientRect();
      return { x: cx - r.left - HEADER_WIDTH, y: cy - r.top };
    };
    const start = toLocal(e.clientX, e.clientY);
    const s0 = useEditorStore.getState();
    const base = e.shiftKey || e.metaKey || e.ctrlKey ? s0.selectedClipIds : [];
    let dragging = false;
    runGesture({
      autoScroll: true,
      move(p) {
        const q = toLocal(p.clientX, p.clientY);
        if (!dragging && Math.hypot(q.x - start.x, q.y - start.y) < 4) return;
        dragging = true;
        setBox({ x0: start.x, y0: start.y, x1: q.x, y1: q.y });
        const s = useEditorStore.getState();
        const hit = clipsInBox(s.project, timelineView.layout, pxToTime(start.x, s.zoom), pxToTime(q.x, s.zoom), start.y, q.y);
        s.selectClips([...new Set([...base, ...hit])]);
      },
      end(commit, p) {
        setBox(null);
        if (dragging || !commit || !p) return;
        const s = useEditorStore.getState();
        s.clearSelection();
        s.selectTrack(track.id);
        s.setCurrentTime(Math.max(0, pxToTime(toLocal(p.clientX, p.clientY).x, s.zoom)));
      },
    });
  }, []);

  const onLaneContextMenu = useCallback((e: ReactMouseEvent, track: Track) => {
    e.preventDefault();
    useTimelineUi.getState().openMenu({ x: e.clientX, y: e.clientY, trackId: track.id, time: Math.max(0, pointerTime(e.clientX)) });
  }, []);

  const onEmptyPointerDown = useCallback((e: ReactPointerEvent) => {
    if (e.button !== 0 || e.target !== e.currentTarget) return;
    const s = useEditorStore.getState();
    useTimelineUi.getState().closeMenu();
    s.clearSelection();
    s.setCurrentTime(Math.max(0, pointerTime(e.clientX)));
  }, []);
  const onEmptyContextMenu = useCallback((e: ReactMouseEvent) => {
    if (e.target !== e.currentTarget) return;
    e.preventDefault();
    useTimelineUi.getState().openMenu({ x: e.clientX, y: e.clientY, time: Math.max(0, pointerTime(e.clientX)) });
  }, []);

  // Viewport size / scroll: coalesced to one state update per frame, and only
  // when the mounted window changes (not on every scroll pixel).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const width = el.clientWidth || 800;
      const { idx } = windowFor(el.scrollLeft, Math.max(100, width - HEADER_WIDTH));
      setView((v) => (v.idx === idx && v.width === width ? v : { idx, width }));
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    el.addEventListener('scroll', schedule, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener('scroll', schedule);
      ro?.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // Ctrl/Cmd + wheel zooms around the cursor. Wheel events are accumulated and
  // applied once per animation frame; the scroll position is fixed up right
  // after the zoomed layout is committed (layout effect below).
  const zoomAnchor = useRef<{ t: number; cursorX: number } | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let factor = 1;
    let cursorX = 0;
    let raf = 0;
    const flush = () => {
      raf = 0;
      const s = useEditorStore.getState();
      zoomAnchor.current = { t: (el.scrollLeft + cursorX) / s.zoom, cursorX };
      s.setZoom(s.zoom * factor);
      factor = 1;
    };
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      factor *= Math.exp(-e.deltaY * 0.0025);
      cursorX = e.clientX - el.getBoundingClientRect().left - HEADER_WIDTH;
      if (!raf) raf = requestAnimationFrame(flush);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const a = zoomAnchor.current;
    if (!el || !a) return;
    zoomAnchor.current = null;
    el.scrollLeft = Math.max(0, a.t * zoom - a.cursorX);
  }, [zoom]);

  // Keep the playhead visible while playing: checked at most ~8x per second,
  // page-jumps the scroll position (no React render involved).
  const viewWidth = useRef(view.width);
  viewWidth.current = view.width;
  useEffect(() => {
    let last = 0;
    return useEditorStore.subscribe((s, prev) => {
      if (!s.isPlaying || s.currentTime === prev.currentTime) return;
      const now = performance.now();
      if (now - last < 120) return;
      last = now;
      const el = scrollRef.current;
      if (!el || useTimelineUi.getState().drag) return;
      const x = s.currentTime * s.zoom;
      const visibleW = viewWidth.current - HEADER_WIDTH;
      const left = el.scrollLeft;
      if (x < left || x > left + visibleW - 40) el.scrollLeft = Math.max(0, x - visibleW * 0.1);
    });
  }, []);

  // A drag that ends anywhere (Esc, drop outside) clears the drop preview.
  useEffect(() => {
    window.addEventListener('dragend', clearDropPreview);
    window.addEventListener('drop', clearDropPreview);
    return () => {
      window.removeEventListener('dragend', clearDropPreview);
      window.removeEventListener('drop', clearDropPreview);
    };
  }, []);

  const overlayProps: TimelineOverlayProps = useMemo(
    () => ({
      pxPerSecond: zoom,
      timeToPx: (t) => timeToPx(t, zoom),
      pxToTime: (px) => pxToTime(px, zoom),
      width: contentWidth,
      height: rowsHeight,
      tracks: layout,
    }),
    [zoom, contentWidth, rowsHeight, layout],
  );

  const { chunk } = windowFor(0, lanesViewport);
  const winStartPx = Math.max(0, (view.idx - 1) * chunk);
  const winStart = pxToTime(winStartPx, zoom);
  const winEnd = pxToTime(winStartPx + 3 * chunk, zoom);
  const empty = Object.keys(project.clips).length === 0;

  return (
    <div className="timeline">
      <TimelineToolbar viewportPx={lanesViewport} extras={toolbarExtras} />
      <div
        className="timeline-scroll"
        ref={scrollRef}
        onDragOver={handleTimelineDragOver}
        onDragLeave={handleTimelineDragLeave}
        onDrop={(e) => void handleTimelineDrop(e)}
      >
        <div className="timeline-inner" style={{ width: HEADER_WIDTH + contentWidth }}>
          <div className="ruler-row" style={{ height: RULER_HEIGHT }}>
            <div className="ruler-corner" style={{ width: HEADER_WIDTH }} />
            <div className="ruler-wrap">
              <Ruler zoom={zoom} width={contentWidth} viewStart={winStart} viewEnd={winEnd} onPointerDown={startScrub} />
              <PlayheadMarker className="playhead-head" zoom={zoom} onPointerDown={startScrub} />
            </div>
          </div>
          <div className="rows" ref={rowsRef}>
            <div
              className="new-track-top"
              style={{ height: TOP_GUTTER, marginLeft: HEADER_WIDTH, width: contentWidth }}
              onPointerDown={onEmptyPointerDown}
              onContextMenu={onEmptyContextMenu}
            />
            {tracks.map((t) => (
              <TrackRow
                key={t.id}
                track={t}
                clips={clipsByTrack.get(t.id) ?? EMPTY}
                zoom={zoom}
                contentWidth={contentWidth}
                canDelete={tracks.length > 1}
                winStart={winStart}
                winEnd={winEnd}
                onLanePointerDown={onLanePointerDown}
                onLaneContextMenu={onLaneContextMenu}
              />
            ))}
            <div
              className="new-track-drop"
              style={{ marginLeft: HEADER_WIDTH, width: contentWidth }}
              onPointerDown={onEmptyPointerDown}
              onContextMenu={onEmptyContextMenu}
            >
              {empty && (
                <span className="timeline-empty">
                  <Icon name="upload" size={16} />
                  <span>
                    <strong>Drop files here</strong> or drag clips from the media library (press + on an item to add it at the playhead)
                  </span>
                </span>
              )}
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
            <DragLayer tracks={tracks} layout={layout} zoom={zoom} />
            <PlayheadMarker className="playhead-line" zoom={zoom} offset={HEADER_WIDTH} />
          </div>
        </div>
      </div>
      <Notice />
      <ContextMenu />
    </div>
  );
}
