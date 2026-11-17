import { useEditorStore, type Track, type TrackLayout } from '../../core';
import { ClipBody, clipClassName, clipStyle } from './ClipView';
import { HEADER_WIDTH, TOP_GUTTER, useTimelineUi } from './timelineUi';

const NEW_TRACK_GHOST_H = 34;

/** y (rows coordinates) where a new track with compositing `order` would be inserted. */
export function newTrackY(tracks: readonly Track[], layout: readonly TrackLayout[], order: number): number {
  let y = TOP_GUTTER;
  for (const l of layout) {
    const t = tracks.find((x) => x.id === l.trackId);
    if (t && t.order >= order) y = l.top + l.height;
  }
  return y;
}

/**
 * Drag feedback over the track rows: ghosts exactly where the clips will land
 * (red when the drop would be rejected), the new-track insertion line, the
 * file-drop marker and the snap guide. The only component that re-renders
 * on every pointer move of a drag.
 */
export function DragLayer({ tracks, layout, zoom }: { tracks: readonly Track[]; layout: readonly TrackLayout[]; zoom: number }) {
  const drag = useTimelineUi((s) => s.drag);
  const snapLine = useTimelineUi((s) => s.snapLine);
  const assets = useEditorStore((s) => s.project.assets);
  if (!drag && snapLine === null) return null;
  const newY = drag?.newTrack ? newTrackY(tracks, layout, drag.newTrack.order) : null;
  const rowOf = (trackId: string | null) => {
    if (trackId === null) return { top: (newY ?? TOP_GUTTER) - NEW_TRACK_GHOST_H / 2, height: NEW_TRACK_GHOST_H };
    const l = layout.find((x) => x.trackId === trackId);
    return l ? { top: l.top, height: l.height } : null;
  };
  const state = drag ? (drag.valid ? 'valid' : 'invalid') : 'valid';
  return (
    <div className="drag-layer" style={{ left: HEADER_WIDTH }} data-testid="drag-layer">
      {newY !== null && (
        <div className="new-track-line" style={{ top: newY }} data-testid="new-track-line">
          <span>New {drag!.newTrack!.kind} track</span>
        </div>
      )}
      {drag?.ghosts.map((g) => {
        const row = rowOf(g.trackId);
        if (!row) return null;
        const asset = 'assetId' in g.clip ? assets[g.clip.assetId] : undefined;
        return (
          <div key={g.clip.id} className="ghost-row" style={{ top: row.top, height: row.height }}>
            <div
              className={clipClassName(g.clip, asset, ['ghost', `ghost-${state}`, `ghost-${drag.outcome}`])}
              style={clipStyle(g.clip, asset, g.start, zoom)}
              data-testid="drag-ghost"
              data-ghost-track={g.trackId ?? 'new'}
              data-ghost-start={g.start.toFixed(3)}
            >
              <ClipBody clip={g.clip} asset={asset} width={g.clip.duration * zoom} zoom={zoom} />
            </div>
          </div>
        );
      })}
      {drag?.marker &&
        (() => {
          const row = drag.marker.trackId ? rowOf(drag.marker.trackId) : null;
          return (
            <div
              className="drop-marker"
              style={{ left: drag.marker.time * zoom, top: row?.top ?? 0, height: row?.height ?? '100%' }}
              data-testid="drop-marker"
            />
          );
        })()}
      {snapLine !== null && <div className="snap-line" style={{ left: snapLine * zoom }} data-testid="snap-line" />}
    </div>
  );
}
