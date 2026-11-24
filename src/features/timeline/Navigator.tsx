/**
 * Overview strip under the timeline: the WHOLE project in one row (clip blocks,
 * the part currently in view, the playhead).
 * - Click / drag anywhere: jump the playhead there (the timeline scrolls along).
 * - Drag the "in view" box: scroll the timeline without moving the playhead.
 * Cheap while playing: only the playhead line re-renders per tick.
 */
import { memo, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { clipEnd, formatDuration, getProjectDuration, useEditorStore, type Project } from '../../core';
import { HEADER_WIDTH } from './timelineUi';

const ROW_OF: Partial<Record<string, number>> = { video: 0, image: 0, overlay: 0, text: 0, audio: 1, subtitle: 2 };

/** Merged [start, end] blocks per row (0 picture, 1 sound, 2 captions), as fractions of `total`. */
export function overviewBlocks(project: Project, total: number): { row: number; a: number; b: number }[] {
  if (!(total > 0)) return [];
  const rows: [number, number][][] = [[], [], []];
  for (const c of Object.values(project.clips)) {
    const row = c.type === 'subtitle' ? 2 : c.type === 'audio' ? 1 : (ROW_OF[c.type] ?? 0);
    rows[row]!.push([c.start, clipEnd(c)]);
  }
  const out: { row: number; a: number; b: number }[] = [];
  const minGap = total / 600; // merge what would be under one pixel apart
  rows.forEach((spans, row) => {
    spans.sort((x, y) => x[0] - y[0]);
    let cur: [number, number] | null = null;
    for (const s of spans) {
      if (cur && s[0] <= cur[1] + minGap) cur[1] = Math.max(cur[1], s[1]);
      else {
        if (cur) out.push({ row, a: cur[0] / total, b: cur[1] / total });
        cur = [s[0], s[1]];
      }
    }
    if (cur) out.push({ row, a: cur[0] / total, b: cur[1] / total });
  });
  return out;
}

const Blocks = memo(function Blocks({ project, total }: { project: Project; total: number }) {
  const blocks = useMemo(() => overviewBlocks(project, total), [project.clips, total]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <svg className="nav-blocks" viewBox="0 0 1000 30" preserveAspectRatio="none" aria-hidden>
      {blocks.map((b, i) => (
        <rect key={i} className={`nav-block nav-row-${b.row}`} x={b.a * 1000} y={2 + b.row * 9.5} width={Math.max(1, (b.b - b.a) * 1000)} height={7} rx={1} />
      ))}
    </svg>
  );
});

function NavPlayhead({ total }: { total: number }) {
  const t = useEditorStore((s) => s.currentTime);
  return <div className="nav-playhead" style={{ left: `${Math.min(100, (t / total) * 100)}%` }} />;
}

interface NavigatorProps {
  scrollRef: RefObject<HTMLDivElement | null>;
  zoom: number;
}

/** The strip spans exactly the project (0 .. end of the last clip). */
export function Navigator({ scrollRef, zoom }: NavigatorProps) {
  const project = useEditorStore((s) => s.project);
  const duration = getProjectDuration(project);
  const total = Math.max(1e-3, duration);
  const stripRef = useRef<HTMLDivElement>(null);
  const [win, setWin] = useState({ left: 0, width: 1 });

  // Track the timeline's scroll position (one update per frame at most).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const visible = Math.max(1, el.clientWidth - HEADER_WIDTH) / zoom;
      const left = el.scrollLeft / zoom;
      setWin({ left: Math.min(1, left / total), width: Math.max(0, Math.min(1, (left + visible) / total) - Math.min(1, left / total)) });
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
  }, [scrollRef, zoom, total]);

  const fractionAt = (clientX: number) => {
    const r = stripRef.current?.getBoundingClientRect();
    if (!r || r.width <= 0) return 0;
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width));
  };

  const follow = (target: Element, pointerId: number, move: (clientX: number) => void) => {
    try {
      target.setPointerCapture(pointerId);
    } catch {
      /* jsdom / detached */
    }
    const onMove = (e: PointerEvent) => move(e.clientX);
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  /** Seek (and the timeline reveals the playhead on its own, see Timeline). */
  const onStripDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const seek = (x: number) => useEditorStore.getState().setCurrentTime(fractionAt(x) * total);
    seek(e.clientX);
    follow(e.currentTarget, e.pointerId, seek);
  };

  /** Pan: drag the in-view box. */
  const onWindowDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = scrollRef.current;
    if (!el) return;
    const startX = e.clientX;
    const startLeft = el.scrollLeft;
    const stripW = stripRef.current?.getBoundingClientRect().width || 1;
    follow(e.currentTarget, e.pointerId, (x) => {
      el.scrollLeft = Math.max(0, startLeft + ((x - startX) / stripW) * total * zoom);
    });
  };

  if (!(duration > 0)) return null;
  // Everything in view already (and the box would cover the whole strip): no box.
  const showWindow = !(win.left <= 1e-3 && win.width >= 0.999);
  return (
    <div className="timeline-navigator">
      <span className="nav-time">{formatDuration(0)}</span>
      <div
        ref={stripRef}
        className="nav-strip"
        role="slider"
        aria-label="Timeline overview: click to jump"
        aria-valuemin={0}
        aria-valuemax={Math.round(total)}
        title="Click or drag to jump anywhere · drag the highlighted box to scroll"
        data-testid="timeline-navigator"
        onPointerDown={onStripDown}
      >
        <Blocks project={project} total={total} />
        {showWindow && (
          <div className="nav-window" style={{ left: `${win.left * 100}%`, width: `${win.width * 100}%` }} onPointerDown={onWindowDown} />
        )}
        <NavPlayhead total={total} />
      </div>
      <span className="nav-time">{formatDuration(duration)}</span>
    </div>
  );
}
