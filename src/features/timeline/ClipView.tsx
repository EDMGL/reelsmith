import { memo, type CSSProperties } from 'react';
import { formatDuration, isMediaClip, useEditorStore, type Clip, type MediaAsset } from '../../core';
import { startClipMove, startClipTrim } from './interactions';

function Waveform({ asset, clip }: { asset: MediaAsset; clip: Clip }) {
  if (!asset.waveform || !asset.duration || !isMediaClip(clip)) return null;
  const n = asset.waveform.length;
  const a = Math.max(0, Math.floor((clip.sourceIn / asset.duration) * n));
  const b = Math.min(n, Math.ceil((clip.sourceOut / asset.duration) * n));
  const slice = asset.waveform.slice(a, Math.max(a + 1, b));
  const d = slice.map((p, i) => `M${i} ${50 - p * 46}V${50 + p * 46}`).join('');
  return (
    <svg className="clip-waveform" viewBox={`0 0 ${slice.length} 100`} preserveAspectRatio="none" aria-hidden>
      <path d={d} stroke="currentColor" strokeWidth={Math.max(0.6, slice.length / 400)} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export interface ClipViewProps {
  clip: Clip;
  /** Rendered start (may differ from clip.start while dragging). */
  start: number;
  zoom: number;
  locked: boolean;
  ghost?: 'valid' | 'invalid';
  /** Original position of a clip being dragged elsewhere. */
  placeholder?: boolean;
}

export const ClipView = memo(function ClipView({ clip, start, zoom, locked, ghost, placeholder }: ClipViewProps) {
  const selected = useEditorStore((s) => s.selectedClipIds.includes(clip.id));
  const asset = useEditorStore((s) => ('assetId' in clip ? s.project.assets[clip.assetId] : undefined));
  const width = Math.max(2, clip.duration * zoom);
  const style: CSSProperties = { left: start * zoom, width };
  if ((clip.type === 'video' || clip.type === 'image') && asset?.thumbnail) {
    style.backgroundImage = `url(${asset.thumbnail})`;
  }
  const cls = [
    'clip',
    `clip-${clip.type}`,
    selected && 'selected',
    locked && 'locked',
    ghost && `ghost ghost-${ghost}`,
    placeholder && 'placeholder',
    asset?.status === 'missing' && 'missing',
  ]
    .filter(Boolean)
    .join(' ');
  const label = clip.type === 'text' || clip.type === 'subtitle' ? clip.text || clip.name : clip.name;
  return (
    <div
      className={cls}
      style={style}
      data-clip-id={clip.id}
      onPointerDown={(e) => !ghost && startClipMove(e, clip)}
      title={`${clip.name} · ${formatDuration(clip.duration)}`}
    >
      {clip.type === 'audio' && asset && <Waveform asset={asset} clip={clip} />}
      <div className="clip-label">
        <span className="clip-name">{label}</span>
        {width > 90 && <span className="clip-dur">{formatDuration(clip.duration)}</span>}
        {isMediaClip(clip) && clip.speed !== 1 && <span className="clip-tag">{clip.speed}×</span>}
      </div>
      {clip.fadeIn > 0 && <div className="clip-fade clip-fade-in" style={{ width: clip.fadeIn * zoom }} />}
      {clip.fadeOut > 0 && <div className="clip-fade clip-fade-out" style={{ width: clip.fadeOut * zoom }} />}
      {!locked && !ghost && (
        <>
          <div className="trim-handle trim-start" onPointerDown={(e) => startClipTrim(e, clip, 'start')} aria-label="Trim start" />
          <div className="trim-handle trim-end" onPointerDown={(e) => startClipTrim(e, clip, 'end')} aria-label="Trim end" />
        </>
      )}
    </div>
  );
});
