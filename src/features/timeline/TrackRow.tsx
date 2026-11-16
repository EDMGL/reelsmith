import { Fragment, memo, useState, type DragEvent } from 'react';
import {
  ASSET_DRAG_MIME,
  CLIP_TEMPLATE_DRAG_MIME,
  createId,
  snapTime,
  useEditorStore,
  type Clip,
  type Track,
} from '../../core';
import { ClipView } from './ClipView';
import { snapCandidates } from './geometry';
import { HEADER_WIDTH, SNAP_PX, TRACK_HEIGHT, useTimelineUi } from './timelineUi';

const KIND_ICON: Record<Track['kind'], string> = { video: '▬', overlay: '◱', audio: '♪', text: 'T', subtitle: '❝' };

function TrackHeader({ track, canDelete }: { track: Track; canDelete: boolean }) {
  const updateTrack = useEditorStore((s) => s.updateTrack);
  const removeTrack = useEditorStore((s) => s.removeTrack);
  const selectTrack = useEditorStore((s) => s.selectTrack);
  const selected = useEditorStore((s) => s.selectedTrackId === track.id);
  const clipCount = useEditorStore((s) => Object.values(s.project.clips).filter((c) => c.trackId === track.id).length);
  const visual = track.kind !== 'audio';
  const audible = track.kind === 'video' || track.kind === 'audio' || track.kind === 'overlay';
  return (
    <div className={`track-header${selected ? ' selected' : ''}`} style={{ width: HEADER_WIDTH }} onPointerDown={() => selectTrack(track.id)}>
      <span className={`track-kind kind-${track.kind}`} aria-hidden>
        {KIND_ICON[track.kind]}
      </span>
      <span className="track-name" title={track.name}>
        {track.name}
      </span>
      <div className="track-buttons">
        {audible && (
          <button
            type="button"
            className={`tbtn${track.muted ? ' on' : ''}`}
            aria-pressed={track.muted}
            aria-label={track.muted ? 'Unmute track' : 'Mute track'}
            title={track.muted ? 'Unmute' : 'Mute'}
            onClick={() => updateTrack(track.id, { muted: !track.muted })}
          >
            {track.muted ? '🔇' : '🔊'}
          </button>
        )}
        {visual && (
          <button
            type="button"
            className={`tbtn${track.hidden ? ' on' : ''}`}
            aria-pressed={track.hidden}
            aria-label={track.hidden ? 'Show track' : 'Hide track'}
            title={track.hidden ? 'Show' : 'Hide'}
            onClick={() => updateTrack(track.id, { hidden: !track.hidden })}
          >
            {track.hidden ? '◌' : '◉'}
          </button>
        )}
        <button
          type="button"
          className={`tbtn${track.locked ? ' on' : ''}`}
          aria-pressed={track.locked}
          aria-label={track.locked ? 'Unlock track' : 'Lock track'}
          title={track.locked ? 'Unlock' : 'Lock'}
          onClick={() => updateTrack(track.id, { locked: !track.locked })}
        >
          {track.locked ? '🔒' : '🔓'}
        </button>
        {canDelete && (
          <button
            type="button"
            className="tbtn tbtn-danger"
            aria-label="Remove track"
            title="Remove track"
            onClick={() => {
              if (clipCount === 0 || window.confirm(`Remove "${track.name}" and its ${clipCount} clip(s)?`)) removeTrack(track.id);
            }}
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}

/** Handles media-library / clip-template drops at a time, optionally onto a track. */
export function handleTimelineDrop(e: DragEvent, time: number, trackId?: string): boolean {
  const s = useEditorStore.getState();
  const t = Math.max(0, snapTime(time, snapCandidates(s.project, new Set(), s.currentTime), SNAP_PX / s.zoom).time);
  const assetId = e.dataTransfer.getData(ASSET_DRAG_MIME);
  if (assetId) {
    e.preventDefault();
    const id = (trackId && s.addAssetClip(assetId, { trackId, start: t })) || s.addAssetClip(assetId, { start: t });
    return !!id;
  }
  const tpl = e.dataTransfer.getData(CLIP_TEMPLATE_DRAG_MIME);
  if (tpl) {
    e.preventDefault();
    try {
      const clip = { ...(JSON.parse(tpl) as Clip), id: createId('clip') };
      const id = (trackId && s.insertClip(clip, { trackId, start: t })) || s.insertClip(clip, { start: t });
      return !!id;
    } catch {
      return false;
    }
  }
  return false;
}

export function acceptsTimelineDrag(e: DragEvent): boolean {
  return e.dataTransfer.types.includes(ASSET_DRAG_MIME) || e.dataTransfer.types.includes(CLIP_TEMPLATE_DRAG_MIME);
}

interface TrackRowProps {
  track: Track;
  clips: Clip[];
  /** Clips dragged from other tracks onto this one (ghosts). */
  incoming: Clip[];
  zoom: number;
  contentWidth: number;
  canDelete: boolean;
  clientXToTime: (x: number) => number;
}

export const TrackRow = memo(function TrackRow({ track, clips, incoming, zoom, contentWidth, canDelete, clientXToTime }: TrackRowProps) {
  const drag = useTimelineUi((s) => s.drag);
  const [dropHover, setDropHover] = useState(false);
  const height = TRACK_HEIGHT[track.kind] ?? 48;
  const dragged = new Set(drag?.ids ?? []);
  return (
    <div className={`track-row kind-${track.kind}${track.hidden ? ' hidden-track' : ''}${track.locked ? ' locked-track' : ''}`} style={{ height }}>
      <TrackHeader track={track} canDelete={canDelete} />
      <div
        className={`lane${dropHover ? ' drop-hover' : ''}`}
        data-lane-track-id={track.id}
        style={{ width: contentWidth }}
        onPointerDown={(e) => {
          if (e.button !== 0 || e.target !== e.currentTarget) return;
          const s = useEditorStore.getState();
          s.clearSelection();
          s.selectTrack(track.id);
          s.setCurrentTime(clientXToTime(e.clientX));
        }}
        onDragOver={(e) => {
          if (!acceptsTimelineDrag(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          setDropHover(true);
        }}
        onDragLeave={() => setDropHover(false)}
        onDrop={(e) => {
          setDropHover(false);
          handleTimelineDrop(e, clientXToTime(e.clientX), track.id);
        }}
      >
        {clips.map((c) => {
          const isDragged = dragged.has(c.id);
          const movesAway = isDragged && drag?.trackId !== undefined && drag.trackId !== track.id;
          if (!isDragged) return <ClipView key={c.id} clip={c} start={c.start} zoom={zoom} locked={track.locked} />;
          return (
            <Fragment key={c.id}>
              <ClipView clip={c} start={c.start} zoom={zoom} locked={track.locked} placeholder />
              {!movesAway && (
                <ClipView clip={c} start={Math.max(0, c.start + drag!.delta)} zoom={zoom} locked={false} ghost={drag!.valid ? 'valid' : 'invalid'} />
              )}
            </Fragment>
          );
        })}
        {drag &&
          incoming.map((c) => (
            <ClipView
              key={`ghost-${c.id}`}
              clip={c}
              start={Math.max(0, c.start + drag.delta)}
              zoom={zoom}
              locked={false}
              ghost={drag.valid ? 'valid' : 'invalid'}
            />
          ))}
      </div>
    </div>
  );
});
