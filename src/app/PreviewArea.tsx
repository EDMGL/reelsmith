import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Icon,
  PreviewOverlayLayer,
  Slot,
  fitRect,
  formatTimecode,
  getProjectDuration,
  previewRegistry,
  useEditorStore,
  useRegistry,
} from '../core';

/** Shown until P2 registers a preview: a box with the project's aspect ratio. */
function PreviewPlaceholder() {
  const project = useEditorStore((s) => s.project);
  const { width, height } = project;
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const PAD = 24;
  const r = fitRect(width, height, Math.max(0, box.w - PAD * 2), Math.max(0, box.h - PAD * 2));
  return (
    <div className="preview-fill" ref={ref}>
      <div
        className="preview-canvas-placeholder"
        data-testid="shell-preview-placeholder"
        style={{ width: r.width, height: r.height, left: r.x + PAD, top: r.y + PAD }}
      >
        <span className="preview-size">
          {width} × {height}
        </span>
        <PreviewOverlayLayer project={project} displayWidth={r.width} displayHeight={r.height} />
      </div>
    </div>
  );
}

/** Render counter for the transport (perf tests): playback must not re-render it. */
export const transportRenderCount = { current: 0 };

/**
 * Play controls + timecodes under the preview. Subscribes only to things that
 * change rarely (play state, fps, project edits); the current timecode is
 * written imperatively from a store subscription so playback (60 ticks/s)
 * causes no React render here.
 */
export function Transport() {
  transportRenderCount.current++;
  (globalThis as { __erdemcutTransportRenders?: number }).__erdemcutTransportRenders = transportRenderCount.current;
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const fps = useEditorStore((s) => s.project.fps);
  const project = useEditorStore((s) => s.project);
  const duration = useMemo(() => getProjectDuration(project), [project]);
  const togglePlay = useEditorStore((s) => s.togglePlay);
  const seek = useEditorStore((s) => s.setCurrentTime);
  const timeRef = useRef<HTMLSpanElement>(null);

  // Layout effect: the timecode is filled in before the first paint.
  useLayoutEffect(() => {
    let last = -1;
    const write = (t: number) => {
      if (t === last || !timeRef.current) return;
      last = t;
      timeRef.current.textContent = formatTimecode(t, fps);
    };
    write(useEditorStore.getState().currentTime);
    return useEditorStore.subscribe((s) => write(s.currentTime));
  }, [fps]);

  return (
    <div className="transport">
      <div className="transport-time">
        <span className="timecode current" ref={timeRef} data-testid="transport-time" />
        <span className="timecode-sep" aria-hidden>
          /
        </span>
        <span className="timecode muted" data-testid="transport-duration">
          {formatTimecode(duration, fps)}
        </span>
      </div>
      <div className="transport-buttons">
        <button type="button" className="btn btn-ghost btn-icon-only" title="Go to start (Home)" aria-label="Go to start" onClick={() => seek(0)}>
          <Icon name="skip-start" size={18} />
        </button>
        <button
          type="button"
          className="btn btn-icon-only btn-play"
          title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          onClick={togglePlay}
        >
          <Icon name={isPlaying ? 'pause' : 'play'} size={18} />
        </button>
        <button type="button" className="btn btn-ghost btn-icon-only" title="Go to end" aria-label="Go to end" onClick={() => seek(duration)}>
          <Icon name="skip-end" size={18} />
        </button>
      </div>
      <div className="transport-right" />
    </div>
  );
}

/** Center area: the registered preview (P2) or a placeholder, plus transport controls. */
export function PreviewArea() {
  const [preview] = useRegistry(previewRegistry);
  return (
    <div className="preview-area">
      <div className="preview-stage">
        {preview ? <Slot name="preview" component={preview.component} props={{}} /> : <PreviewPlaceholder />}
      </div>
      <Transport />
    </div>
  );
}
