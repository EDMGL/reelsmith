import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import {
  PreviewOverlayLayer,
  fitRect,
  formatTimecode,
  getProjectDuration,
  snapToFrame,
  useEditorStore,
  useEngine,
  type Canvas2D,
} from '../../core';
import './preview.css';

const PAD = 16;

function useElementSize(ref: RefObject<HTMLElement | null>): { w: number; h: number } {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setSize((s) => (s.w === el.clientWidth && s.h === el.clientHeight ? s : { w: el.clientWidth, h: el.clientHeight }));
    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

function useDevicePixelRatio(): number {
  const get = () => (typeof window !== 'undefined' && window.devicePixelRatio > 0 ? Math.min(window.devicePixelRatio, 3) : 1);
  const [dpr, setDpr] = useState(get);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(`(resolution: ${dpr}dppx)`);
    const onChange = () => setDpr(get());
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, [dpr]);
  return dpr;
}

/**
 * Center preview: a canvas fitted to the stage at the project aspect ratio
 * (devicePixelRatio-aware), rendered by the engine on every relevant change
 * while paused and every frame while playing. Hosts the preview overlay
 * layer (P3 transform handles) over the exact canvas rectangle.
 */
export default function Preview() {
  const project = useEditorStore((s) => s.project);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const engine = useEngine();
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<{ canvas: HTMLCanvasElement; ctx: Canvas2D | null } | null>(null);
  const box = useElementSize(stageRef);
  const dpr = useDevicePixelRatio();
  const [fullscreen, setFullscreen] = useState(false);

  const r = fitRect(project.width, project.height, Math.max(0, box.w - PAD * 2), Math.max(0, box.h - PAD * 2));
  const cw = Math.max(1, Math.round(r.width * dpr));
  const ch = Math.max(1, Math.round(r.height * dpr));
  const empty = Object.keys(project.clips).length === 0;

  const getCtx = useCallback((): Canvas2D | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    if (ctxRef.current?.canvas !== canvas) {
      let ctx: Canvas2D | null = null;
      try {
        ctx = canvas.getContext('2d', { alpha: false });
      } catch {
        ctx = null;
      }
      ctxRef.current = { canvas, ctx };
    }
    return ctxRef.current.ctx;
  }, []);

  // Render scheduling: coalesced to one render per animation frame.
  useEffect(() => {
    if (!engine) return;
    let raf = 0;
    let pending = false;
    let alive = true;
    const draw = () => {
      pending = false;
      if (!alive) return;
      const canvas = canvasRef.current;
      const ctx = getCtx();
      if (!canvas || !ctx || r.width <= 0) return;
      const s = useEditorStore.getState();
      engine.renderFrame(s.currentTime, ctx, { width: canvas.width, height: canvas.height }).catch((e) => console.error('[preview] render failed', e));
      if (s.isPlaying) request();
    };
    const request = () => {
      if (pending || !alive) return;
      pending = true;
      raf = requestAnimationFrame(draw);
    };
    request();
    const unsub = useEditorStore.subscribe((s, prev) => {
      if (s.project !== prev.project || s.currentTime !== prev.currentTime || s.isPlaying !== prev.isPlaying) request();
    });
    return () => {
      alive = false;
      unsub();
      cancelAnimationFrame(raf);
    };
  }, [engine, cw, ch, getCtx, r.width]);

  useEffect(() => {
    const onFs = () => setFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const onStagePointerDown = (e: ReactPointerEvent) => {
    // Only a click on the bare stage/canvas clears the selection; events from
    // overlay elements (P3 handles) pass untouched. An event already handled
    // (preventDefault, e.g. by a native overlay listener) never clears.
    if (e.defaultPrevented || e.nativeEvent.defaultPrevented) return;
    if (e.button !== 0) return;
    if (e.target === e.currentTarget || e.target === canvasRef.current) useEditorStore.getState().clearSelection();
  };

  const toggleFullscreen = () => {
    const el = rootRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
    else void el.requestFullscreen?.().catch(() => undefined);
  };

  return (
    <div className={`rs-preview${fullscreen ? ' is-fullscreen' : ''}`} ref={rootRef} data-testid="preview">
      <div className="rs-preview-stage" ref={stageRef} onPointerDown={onStagePointerDown}>
        <div
          className="rs-preview-frame"
          data-testid="preview-frame"
          style={{ left: r.x + PAD, top: r.y + PAD, width: r.width, height: r.height }}
        >
          <canvas
            ref={canvasRef}
            className="rs-preview-canvas"
            data-testid="preview-canvas"
            width={cw}
            height={ch}
            style={{ width: r.width, height: r.height }}
          />
          {empty && (
            <div className="rs-preview-empty" data-testid="preview-placeholder">
              <span className="rs-preview-size">
                {project.width} × {project.height}
              </span>
              <span>Add media to the timeline to preview it here</span>
            </div>
          )}
          <PreviewOverlayLayer project={project} displayWidth={r.width} displayHeight={r.height} />
        </div>
      </div>
      <PreviewTools fullscreen={fullscreen} isPlaying={isPlaying} onFullscreen={toggleFullscreen} />
    </div>
  );
}

function PreviewTools({ fullscreen, isPlaying, onFullscreen }: { fullscreen: boolean; isPlaying: boolean; onFullscreen: () => void }) {
  const fps = useEditorStore((s) => s.project.fps);
  const t = useEditorStore((s) => s.currentTime);
  const duration = useEditorStore((s) => getProjectDuration(s.project));
  const step = (dir: -1 | 1) => {
    const s = useEditorStore.getState();
    if (s.isPlaying) s.pause();
    const { currentTime, project } = useEditorStore.getState();
    const next = snapToFrame(currentTime, fps) + dir / fps;
    s.setCurrentTime(Math.max(0, Math.min(getProjectDuration(project), next)));
  };
  return (
    <div className="rs-preview-tools">
      {fullscreen && (
        <>
          <button type="button" className="btn btn-small btn-icon-only" aria-label={isPlaying ? 'Pause' : 'Play'} onClick={() => useEditorStore.getState().togglePlay()}>
            {isPlaying ? '❚❚' : '▶'}
          </button>
          <span className="timecode current">{formatTimecode(t, fps)}</span>
          <span className="timecode muted">/ {formatTimecode(duration, fps)}</span>
        </>
      )}
      <button type="button" className="btn btn-small btn-icon-only" title="Previous frame (←)" aria-label="Previous frame" onClick={() => step(-1)}>
        ◂❘
      </button>
      <button type="button" className="btn btn-small btn-icon-only" title="Next frame (→)" aria-label="Next frame" onClick={() => step(1)}>
        ❘▸
      </button>
      <button
        type="button"
        className="btn btn-small btn-icon-only"
        title={fullscreen ? 'Exit full screen' : 'Full screen'}
        aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
        onClick={onFullscreen}
      >
        {fullscreen ? '⤡' : '⤢'}
      </button>
    </div>
  );
}
