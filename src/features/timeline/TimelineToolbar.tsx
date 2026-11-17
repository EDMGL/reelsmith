import type { ReactNode } from 'react';
import type { IconName } from '../../core';
import { Icon, ZOOM_MAX, ZOOM_MIN, clipContainsTime, getProjectDuration, ops, useEditorStore, type Clip, type Project, type TrackKind } from '../../core';
import { modKey } from './ContextMenu';
import { fitZoom } from './geometry';
import { useTimelineUi } from './timelineUi';

const TRACK_KINDS: { kind: TrackKind; label: string }[] = [
  { kind: 'video', label: 'Video track' },
  { kind: 'overlay', label: 'Overlay track' },
  { kind: 'audio', label: 'Audio track' },
  { kind: 'text', label: 'Text track' },
  { kind: 'subtitle', label: 'Subtitle track' },
];

// Derived values cached per clips object: the toolbar's selectors run on EVERY
// store update (incl. each playback tick), so they must not scan all clips each time.
const clipListCache = new WeakMap<Project['clips'], { list: Clip[]; duration: number }>();
function clipList(p: Project): { list: Clip[]; duration: number } {
  let v = clipListCache.get(p.clips);
  if (!v) {
    v = { list: Object.values(p.clips), duration: getProjectDuration(p) };
    clipListCache.set(p.clips, v);
  }
  return v;
}

/** Icon + label (label hides in a narrow toolbar; aria-label keeps the name). */
function TL({ icon, label }: { icon: IconName; label: string }) {
  return (
    <>
      <Icon name={icon} size={15} />
      <span className="btn-label">{label}</span>
    </>
  );
}

export function TimelineToolbar({ viewportPx, extras }: { viewportPx: number; extras?: ReactNode }) {
  const selected = useEditorStore((s) => s.selectedClipIds);
  // While playing the button simply stays enabled (no per-tick scan of all clips).
  const canSplit = useEditorStore(
    (s) => s.isPlaying || clipList(s.project).list.some((c) => clipContainsTime(c, s.currentTime) && c.start < s.currentTime - 1e-3),
  );
  const zoom = useEditorStore((s) => s.zoom);
  const duration = useEditorStore((s) => clipList(s.project).duration);
  const hasClipboard = useEditorStore((s) => !!s.clipboard?.clips.length);
  const canDetach = useEditorStore((s) => s.selectedClipIds.some((id) => ops.canDetachAudio(s.project, s.project.clips[id])));
  const canRestore = useEditorStore((s) => s.selectedClipIds.some((id) => ops.canRestoreAudio(s.project, s.project.clips[id])));
  const snapping = useTimelineUi((s) => s.snapping);
  const toggleSnapping = useTimelineUi((s) => s.toggleSnapping);
  const st = useEditorStore.getState;
  const has = selected.length > 0;
  return (
    <div className="timeline-toolbar">
      <div className="tool-group" role="group" aria-label="Edit">
        <button type="button" className="btn btn-small btn-ghost" disabled={!canSplit} onClick={() => st().splitAtPlayhead()} title="Split at playhead (S)" aria-label="Split">
          <TL icon="split" label="Split" />
        </button>
        <button type="button" className="btn btn-small btn-ghost" disabled={!has} onClick={() => st().removeClips(st().selectedClipIds)} title="Delete (Del)" aria-label="Delete">
          <TL icon="trash" label="Delete" />
        </button>
        <button
          type="button"
          className="btn btn-small btn-ghost"
          disabled={!has}
          onClick={() => st().rippleDeleteClips(st().selectedClipIds)}
          title="Ripple delete: delete and close the gap (Shift+Del)"
          aria-label="Ripple delete"
        >
          <TL icon="ripple-delete" label="Ripple delete" />
        </button>
        <button type="button" className="btn btn-small btn-ghost" disabled={!has} onClick={() => st().duplicateClips(st().selectedClipIds)} title={`Duplicate (${modKey('D')})`} aria-label="Duplicate">
          <TL icon="duplicate" label="Duplicate" />
        </button>
      </div>
      <div className="tool-group" role="group" aria-label="Clipboard">
        <button type="button" className="btn btn-small btn-ghost" disabled={!has} onClick={() => st().cutClips()} title={`Cut (${modKey('X')}); ripple cut ${modKey('X', true)}`} aria-label="Cut">
          <TL icon="scissors" label="Cut" />
        </button>
        <button type="button" className="btn btn-small btn-ghost" disabled={!has} onClick={() => st().copyClips()} title={`Copy (${modKey('C')})`} aria-label="Copy">
          <TL icon="copy" label="Copy" />
        </button>
        <button type="button" className="btn btn-small btn-ghost" disabled={!hasClipboard} onClick={() => st().pasteClips()} title={`Paste at playhead (${modKey('V')})`} aria-label="Paste">
          <TL icon="paste" label="Paste" />
        </button>
        {canRestore && !canDetach ? (
          <button type="button" className="btn btn-small btn-ghost" onClick={() => st().restoreAudio()} title="Put the audio back into the video clip" aria-label="Restore audio">
            <TL icon="link" label="Restore audio" />
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-small btn-ghost"
            disabled={!canDetach}
            onClick={() => st().detachAudio()}
            title={`Detach audio to its own clip (${modKey('A', true)})`}
            aria-label="Detach audio"
          >
            <TL icon="unlink" label="Detach audio" />
          </button>
        )}
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
          className={`btn btn-small btn-ghost${snapping ? ' active' : ''}`}
          aria-pressed={snapping}
          onClick={toggleSnapping}
          title="Snapping: hold Alt while dragging to invert"
          aria-label="Snap"
        >
          <TL icon="magnet" label="Snap" />
        </button>
      </div>
      {extras}
      <div className="tool-spacer" />
      <div className="tool-group zoom-group">
        <button type="button" className="btn btn-small btn-ghost btn-icon-only" aria-label="Zoom out" title="Zoom out (-)" onClick={() => st().setZoom(zoom / 1.25)}>
          <Icon name="zoom-out" size={15} />
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
        <button type="button" className="btn btn-small btn-ghost btn-icon-only" aria-label="Zoom in" title="Zoom in (+)" onClick={() => st().setZoom(zoom * 1.25)}>
          <Icon name="zoom-in" size={15} />
        </button>
        <button type="button" className="btn btn-small btn-ghost" disabled={duration <= 0} onClick={() => st().setZoom(fitZoom(duration, viewportPx))} title="Fit the whole timeline in view" aria-label="Fit">
          <TL icon="fit" label="Fit" />
        </button>
      </div>
    </div>
  );
}
