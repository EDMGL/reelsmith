import type { ReactNode } from 'react';
import { ZOOM_MAX, ZOOM_MIN, clipContainsTime, getProjectDuration, useEditorStore, type TrackKind } from '../../core';
import { fitZoom } from './geometry';
import { useTimelineUi } from './timelineUi';

const TRACK_KINDS: { kind: TrackKind; label: string }[] = [
  { kind: 'video', label: 'Video track' },
  { kind: 'overlay', label: 'Overlay track' },
  { kind: 'audio', label: 'Audio track' },
  { kind: 'text', label: 'Text track' },
  { kind: 'subtitle', label: 'Subtitle track' },
];

export function TimelineToolbar({ viewportPx, extras }: { viewportPx: number; extras?: ReactNode }) {
  const selected = useEditorStore((s) => s.selectedClipIds);
  const canSplit = useEditorStore((s) =>
    Object.values(s.project.clips).some((c) => clipContainsTime(c, s.currentTime) && c.start < s.currentTime - 1e-3),
  );
  const zoom = useEditorStore((s) => s.zoom);
  const duration = useEditorStore((s) => getProjectDuration(s.project));
  const snapping = useTimelineUi((s) => s.snapping);
  const toggleSnapping = useTimelineUi((s) => s.toggleSnapping);
  const st = useEditorStore.getState;
  const has = selected.length > 0;
  return (
    <div className="timeline-toolbar">
      <div className="tool-group">
        <button type="button" className="btn btn-small" disabled={!canSplit} onClick={() => st().splitAtPlayhead()} title="Split at playhead (S)">
          ✂ Split
        </button>
        <button type="button" className="btn btn-small" disabled={!has} onClick={() => st().removeClips(st().selectedClipIds)} title="Delete (Del)">
          Delete
        </button>
        <button
          type="button"
          className="btn btn-small"
          disabled={!has}
          onClick={() => st().rippleDeleteClips(st().selectedClipIds)}
          title="Delete and close the gap (Shift+Del)"
        >
          Ripple delete
        </button>
        <button type="button" className="btn btn-small" disabled={!has} onClick={() => st().duplicateClips(st().selectedClipIds)} title="Duplicate (⌘/Ctrl+D)">
          Duplicate
        </button>
      </div>
      <div className="tool-group">
        <select
          className="select-small"
          aria-label="Add track"
          value=""
          onChange={(e) => {
            if (e.target.value) st().addTrack(e.target.value as TrackKind);
          }}
        >
          <option value="">+ Add track</option>
          {TRACK_KINDS.map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={`btn btn-small${snapping ? ' active' : ''}`}
          aria-pressed={snapping}
          onClick={toggleSnapping}
          title="Snapping (hold Alt while dragging to invert)"
        >
          🧲 Snap
        </button>
      </div>
      {extras}
      <div className="tool-spacer" />
      <div className="tool-group zoom-group">
        <button type="button" className="btn btn-small btn-icon-only" aria-label="Zoom out" title="Zoom out (-)" onClick={() => st().setZoom(zoom / 1.25)}>
          −
        </button>
        <input
          type="range"
          aria-label="Zoom"
          min={Math.log(ZOOM_MIN)}
          max={Math.log(ZOOM_MAX)}
          step={0.01}
          value={Math.log(zoom)}
          onChange={(e) => st().setZoom(Math.exp(Number(e.target.value)))}
        />
        <button type="button" className="btn btn-small btn-icon-only" aria-label="Zoom in" title="Zoom in (+)" onClick={() => st().setZoom(zoom * 1.25)}>
          +
        </button>
        <button type="button" className="btn btn-small" disabled={duration <= 0} onClick={() => st().setZoom(fitZoom(duration, viewportPx))} title="Fit timeline">
          Fit
        </button>
      </div>
    </div>
  );
}
