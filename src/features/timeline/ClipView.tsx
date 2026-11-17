import { memo, useMemo, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import { Icon, formatDuration, isMediaClip, useEditorStore, type Clip, type MediaAsset } from '../../core';
import { startClipMove, startClipTrim } from './interactions';
import { renderCounts, useTimelineUi } from './timelineUi';
import { pointerTime } from './timelineView';

function Waveform({ asset, clip }: { asset: MediaAsset; clip: Clip }) {
  const media = isMediaClip(clip) ? clip : null;
  const sourceIn = media?.sourceIn ?? 0;
  const sourceOut = media?.sourceOut ?? 0;
  const wf = asset.waveform;
  const dur = asset.duration;
  const geom = useMemo(() => {
    if (!wf || !dur) return null;
    const n = wf.length;
    const a = Math.max(0, Math.floor((sourceIn / dur) * n));
    const b = Math.min(n, Math.ceil((sourceOut / dur) * n));
    const slice = wf.slice(a, Math.max(a + 1, b));
    return { n: slice.length, d: slice.map((p, i) => `M${i} ${50 - p * 46}V${50 + p * 46}`).join('') };
  }, [wf, dur, sourceIn, sourceOut]);
  if (!geom || !media) return null;
  return (
    <svg className="clip-waveform" viewBox={`0 0 ${geom.n} 100`} preserveAspectRatio="none" aria-hidden>
      <path d={geom.d} stroke="currentColor" strokeWidth={Math.max(0.6, geom.n / 400)} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Visual body of a clip (no store subscriptions; shared by clips and drag ghosts). */
export function ClipBody({ clip, asset, width, zoom }: { clip: Clip; asset: MediaAsset | undefined; width: number; zoom: number }) {
  const label = clip.type === 'text' || clip.type === 'subtitle' ? clip.text || clip.name : clip.name;
  return (
    <>
      {clip.type === 'audio' && asset && <Waveform asset={asset} clip={clip} />}
      <div className="clip-label">
        {clip.type === 'video' && clip.audioDetached && (
          <span className="clip-icon" title="Audio detached (video is silent)" aria-label="Audio detached">
            <Icon name="volume-off" size={11} />
          </span>
        )}
        {clip.type === 'audio' && clip.detachedFromClipId && (
          <span className="clip-icon" title="Audio detached from a video clip" aria-hidden>
            <Icon name="link" size={11} />
          </span>
        )}
        <span className="clip-name">{label}</span>
        {width > 90 && <span className="clip-dur">{formatDuration(clip.duration)}</span>}
        {isMediaClip(clip) && clip.speed !== 1 && <span className="clip-tag">{clip.speed}×</span>}
      </div>
      {clip.fadeIn > 0 && <div className="clip-fade clip-fade-in" style={{ width: clip.fadeIn * zoom }} />}
      {clip.fadeOut > 0 && <div className="clip-fade clip-fade-out" style={{ width: clip.fadeOut * zoom }} />}
    </>
  );
}

export function clipClassName(clip: Clip, asset: MediaAsset | undefined, extra: (string | false | undefined)[]): string {
  return ['clip', `clip-${clip.type}`, asset?.status === 'missing' && 'missing', ...extra].filter(Boolean).join(' ');
}

export function clipStyle(clip: Clip, asset: MediaAsset | undefined, start: number, zoom: number): CSSProperties {
  const style: CSSProperties = { left: start * zoom, width: Math.max(2, clip.duration * zoom) };
  if ((clip.type === 'video' || clip.type === 'image') && asset?.thumbnail) style.backgroundImage = `url(${asset.thumbnail})`;
  return style;
}

function openClipMenu(e: ReactMouseEvent, clip: Clip) {
  e.preventDefault();
  e.stopPropagation();
  const s = useEditorStore.getState();
  if (!s.selectedClipIds.includes(clip.id)) s.selectClips([clip.id]);
  useTimelineUi.getState().openMenu({ x: e.clientX, y: e.clientY, clipId: clip.id, trackId: clip.trackId, time: Math.max(0, pointerTime(e.clientX)) });
}

export interface ClipViewProps {
  clip: Clip;
  zoom: number;
  locked: boolean;
}

/** A clip on its track. Memoized: re-renders only when the clip, zoom, lock, selection or drag state of THIS clip changes. */
export const ClipView = memo(function ClipView({ clip, zoom, locked }: ClipViewProps) {
  renderCounts.clipView++;
  const selected = useEditorStore((s) => s.selectedClipIds.includes(clip.id));
  const asset = useEditorStore((s) => ('assetId' in clip ? s.project.assets[clip.assetId] : undefined));
  const placeholder = useTimelineUi((s) => s.draggingIds?.has(clip.id) ?? false);
  const width = Math.max(2, clip.duration * zoom);
  // Handles never take more than a quarter of the clip each, so short clips stay movable.
  const handle = Math.max(3, Math.min(10, width / 4));
  return (
    <div
      className={clipClassName(clip, asset, [selected && 'selected', locked && 'locked', placeholder && 'placeholder'])}
      style={clipStyle(clip, asset, clip.start, zoom)}
      data-clip-id={clip.id}
      onPointerDown={(e) => startClipMove(e, clip)}
      onContextMenu={(e) => openClipMenu(e, clip)}
      title={`${clip.name} · ${formatDuration(clip.duration)}`}
    >
      <ClipBody clip={clip} asset={asset} width={width} zoom={zoom} />
      {!locked && (
        <>
          <div
            className="trim-handle trim-start"
            style={{ width: handle }}
            onPointerDown={(e) => startClipTrim(e, clip, 'start')}
            title="Drag to trim the start"
            aria-label="Trim start"
          />
          <div
            className="trim-handle trim-end"
            style={{ width: handle }}
            onPointerDown={(e) => startClipTrim(e, clip, 'end')}
            title="Drag to trim the end"
            aria-label="Trim end"
          />
        </>
      )}
    </div>
  );
});
