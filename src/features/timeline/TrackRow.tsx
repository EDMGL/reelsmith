import { memo, useMemo, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Icon, clipEnd, useEditorStore, type Clip, type IconName, type Track } from '../../core';
import { ClipView } from './ClipView';
import { HEADER_WIDTH, TRACK_HEIGHT, renderCounts } from './timelineUi';

const KIND_ICON: Record<Track['kind'], IconName> = { video: 'film', overlay: 'layers', audio: 'waveform', text: 'text', subtitle: 'subtitles' };

function TrackHeader({ track, canDelete }: { track: Track; canDelete: boolean }) {
  const updateTrack = useEditorStore((s) => s.updateTrack);
  const removeTrack = useEditorStore((s) => s.removeTrack);
  const selectTrack = useEditorStore((s) => s.selectTrack);
  const selected = useEditorStore((s) => s.selectedTrackId === track.id);
  const visual = track.kind !== 'audio';
  const audible = track.kind === 'video' || track.kind === 'audio' || track.kind === 'overlay';
  return (
    <div className={`track-header${selected ? ' selected' : ''}`} style={{ width: HEADER_WIDTH }} onPointerDown={() => selectTrack(track.id)}>
      <span className={`track-kind kind-${track.kind}`} aria-hidden>
        <Icon name={KIND_ICON[track.kind]} size={14} />
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
            <Icon name={track.muted ? 'volume-off' : 'volume'} size={14} />
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
            <Icon name={track.hidden ? 'eye-off' : 'eye'} size={14} />
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
          <Icon name={track.locked ? 'lock' : 'unlock'} size={14} />
        </button>
        {canDelete && (
          <button
            type="button"
            className="tbtn tbtn-danger"
            aria-label="Remove track"
            title="Remove track"
            onClick={() => {
              // Counted on click only (a per-render count would scan every clip on every store update).
              const clipCount = Object.values(useEditorStore.getState().project.clips).filter((c) => c.trackId === track.id).length;
              if (clipCount === 0 || window.confirm(`Remove "${track.name}" and its ${clipCount} clip(s)?`)) removeTrack(track.id);
            }}
          >
            <Icon name="close" size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Clips of a start-sorted, non-overlapping track list that intersect
 * [from, to] (binary search on the end times, which are sorted too).
 */
export function visibleClips(clips: readonly Clip[], from: number, to: number): Clip[] {
  let lo = 0;
  let hi = clips.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (clipEnd(clips[mid]!) < from) lo = mid + 1;
    else hi = mid;
  }
  const out: Clip[] = [];
  for (let i = lo; i < clips.length && clips[i]!.start <= to; i++) out.push(clips[i]!);
  return out;
}

interface TrackRowProps {
  track: Track;
  /** This track's clips sorted by start. Keeps its identity while the track is unchanged. */
  clips: readonly Clip[];
  zoom: number;
  contentWidth: number;
  canDelete: boolean;
  /** Mounted time window (seconds): only clips intersecting it are rendered. */
  winStart: number;
  winEnd: number;
  /** Pointer down on empty lane space (box selection / click to seek). */
  onLanePointerDown: (e: ReactPointerEvent, track: Track) => void;
  /** Right click on empty lane space. */
  onLaneContextMenu: (e: ReactMouseEvent, track: Track) => void;
}

export const TrackRow = memo(function TrackRow({
  track,
  clips,
  zoom,
  contentWidth,
  canDelete,
  winStart,
  winEnd,
  onLanePointerDown,
  onLaneContextMenu,
}: TrackRowProps) {
  renderCounts.trackRow++;
  const height = TRACK_HEIGHT[track.kind] ?? 48;
  const shown = useMemo(() => visibleClips(clips, winStart, winEnd), [clips, winStart, winEnd]);
  return (
    <div
      className={`track-row kind-${track.kind}${track.hidden ? ' hidden-track' : ''}${track.locked ? ' locked-track' : ''}${track.muted ? ' muted-track' : ''}`}
      style={{ height }}
      data-track-id={track.id}
    >
      <TrackHeader track={track} canDelete={canDelete} />
      <div
        className="lane"
        data-lane-track-id={track.id}
        style={{ width: contentWidth }}
        onPointerDown={(e) => {
          if (e.button !== 0 || e.target !== e.currentTarget) return;
          onLanePointerDown(e, track);
        }}
        onContextMenu={(e) => {
          if (e.target !== e.currentTarget) return;
          onLaneContextMenu(e, track);
        }}
      >
        {shown.map((c) => (
          <ClipView key={c.id} clip={c} zoom={zoom} locked={track.locked} />
        ))}
      </div>
    </div>
  );
});
