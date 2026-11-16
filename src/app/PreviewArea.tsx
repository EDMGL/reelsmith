import { useLayoutEffect, useRef, useState } from 'react';
import {
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
        <span>
          {width} × {height}
        </span>
        <PreviewOverlayLayer project={project} displayWidth={r.width} displayHeight={r.height} />
      </div>
    </div>
  );
}

function Transport() {
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const t = useEditorStore((s) => s.currentTime);
  const fps = useEditorStore((s) => s.project.fps);
  const duration = useEditorStore((s) => getProjectDuration(s.project));
  const togglePlay = useEditorStore((s) => s.togglePlay);
  const seek = useEditorStore((s) => s.setCurrentTime);
  return (
    <div className="transport">
      <span className="timecode current">{formatTimecode(t, fps)}</span>
      <div className="transport-buttons">
        <button type="button" className="btn btn-icon-only" title="Go to start" aria-label="Go to start" onClick={() => seek(0)}>
          ⏮
        </button>
        <button
          type="button"
          className="btn btn-icon-only btn-play"
          title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          onClick={togglePlay}
        >
          {isPlaying ? '❚❚' : '▶'}
        </button>
        <button type="button" className="btn btn-icon-only" title="Go to end" aria-label="Go to end" onClick={() => seek(duration)}>
          ⏭
        </button>
      </div>
      <span className="timecode muted">{formatTimecode(duration, fps)}</span>
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
