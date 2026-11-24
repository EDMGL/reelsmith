import { useMemo, useRef, useState, type DragEvent } from 'react';
import { ASSET_DRAG_MIME, formatDuration, Icon, isFileDrag, setDragPayload, useEditorStore, type IconName, type MediaAsset } from '../../core';
import { useProxyStore } from '../proxy/proxyManager';
import { importFiles } from './importMedia';
import './media.css';

const KIND_ICON: Record<MediaAsset['kind'], IconName> = { video: 'film', audio: 'waveform', image: 'image' };

/** Preview-copy state of a video: building %, queued, ready (smooth preview) or failed (original plays). */
function ProxyStatus({ asset }: { asset: MediaAsset }) {
  const building = useProxyStore((s) => s.building[asset.id]);
  const queued = useProxyStore((s) => s.queued.includes(asset.id));
  const failed = useProxyStore((s) => s.failed[asset.id]);
  if (asset.previewURL) return <span title="Preview plays a light copy; export uses the original"> · smooth preview</span>;
  if (building !== undefined) return <span title="Making a light preview copy for smooth playback"> · preparing preview {Math.round(building * 100)}%</span>;
  if (queued) return <span title="Waiting to make a light preview copy"> · preview queued</span>;
  if (failed) return <span title={failed}> · original preview</span>;
  return null;
}

function AssetCard({ asset, usage, view }: { asset: MediaAsset; usage: number; view: 'grid' | 'list' }) {
  const addAssetClip = useEditorStore((s) => s.addAssetClip);
  const removeAsset = useEditorStore((s) => s.removeAsset);
  const onRemove = () => {
    if (usage > 0 && !window.confirm(`"${asset.name}" is used by ${usage} clip(s). Remove it and those clips?`)) return;
    removeAsset(asset.id);
  };
  return (
    <li
      className={`asset-card asset-${view}${asset.status === 'missing' ? ' asset-missing' : ''}`}
      draggable={asset.status === 'ready'}
      onDragStart={(e) => {
        e.dataTransfer.setData(ASSET_DRAG_MIME, asset.id);
        e.dataTransfer.setData('text/plain', asset.name);
        e.dataTransfer.effectAllowed = 'copy';
        // Lets the timeline preview the exact landing spot (drag data is unreadable until drop).
        setDragPayload({ kind: 'asset', assetId: asset.id });
      }}
      onDragEnd={() => setDragPayload(null)}
      title={asset.name}
    >
      <div className="asset-thumb">
        {asset.thumbnail ? (
          <img src={asset.thumbnail} alt="" draggable={false} />
        ) : asset.kind === 'audio' && asset.waveform ? (
          <svg viewBox={`0 0 ${asset.waveform.length} 100`} preserveAspectRatio="none" aria-hidden>
            <path
              d={asset.waveform.map((p, i) => `M${i} ${50 - p * 48}V${50 + p * 48}`).join('')}
              stroke="currentColor"
              strokeWidth={Math.max(1, asset.waveform.length / 120)}
            />
          </svg>
        ) : (
          <span className="asset-kind-icon">
            <Icon name={KIND_ICON[asset.kind]} size={22} />
          </span>
        )}
        {asset.duration !== null && <span className="asset-badge">{formatDuration(asset.duration)}</span>}
        {usage > 0 && <span className="asset-used" title={`Used by ${usage} clip(s)`} />}
      </div>
      <div className="asset-meta">
        <span className="asset-name">{asset.name}</span>
        <span className="asset-sub">
          {asset.status === 'missing'
            ? 'File missing — re-import'
            : asset.kind === 'audio'
              ? 'Audio'
              : `${asset.width}×${asset.height}${asset.kind === 'video' && !asset.hasAudio ? ' · no audio' : ''}`}
          {asset.kind === 'video' && asset.status === 'ready' && <ProxyStatus asset={asset} />}
        </span>
      </div>
      <div className="asset-actions">
        <button
          type="button"
          className="btn btn-small btn-icon-only"
          aria-label={`Add ${asset.name} to timeline`}
          title="Add to timeline"
          disabled={asset.status !== 'ready'}
          onClick={() => addAssetClip(asset.id)}
        >
          <Icon name="plus" size={14} />
        </button>
        <button type="button" className="btn btn-small btn-icon-only btn-danger" aria-label={`Remove ${asset.name}`} title="Remove" onClick={onRemove}>
          <Icon name="close" size={14} />
        </button>
      </div>
    </li>
  );
}

export function MediaPanel() {
  const assets = useEditorStore((s) => s.project.assets);
  const clips = useEditorStore((s) => s.project.clips);
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [busy, setBusy] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const usage = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of Object.values(clips)) if ('assetId' in c) m.set(c.assetId, (m.get(c.assetId) ?? 0) + 1);
    return m;
  }, [clips]);

  const list = Object.values(assets);

  const handleFiles = async (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;
    const arr = Array.from(files);
    setBusy((b) => b + arr.length);
    setMessage(null);
    try {
      const { failed } = await importFiles(arr);
      if (failed.length) setMessage(`Could not import: ${failed.join(', ')}`);
    } finally {
      setBusy((b) => b - arr.length);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    void handleFiles(e.dataTransfer.files);
  };

  return (
    <div
      className={`media-panel${dragOver ? ' drag-over' : ''}`}
      onDragOver={(e) => {
        if (isFileDrag(e.dataTransfer)) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragOver(false);
      }}
      onDrop={onDrop}
    >
      <div className="media-toolbar">
        <button type="button" className="btn btn-primary" onClick={() => inputRef.current?.click()}>
          <Icon name="upload" />
          Import media
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="video/*,audio/*,image/*"
          hidden
          data-testid="media-file-input"
          onChange={(e) => {
            void handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <div className="segmented" role="group" aria-label="View">
          <button type="button" className={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')} aria-pressed={view === 'grid'}>
            Grid
          </button>
          <button type="button" className={view === 'list' ? 'active' : ''} onClick={() => setView('list')} aria-pressed={view === 'list'}>
            List
          </button>
        </div>
      </div>
      {busy > 0 && (
        <p className="status-msg media-status">
          <span className="spinner" aria-hidden />
          Importing {busy} file(s)…
        </p>
      )}
      {message && (
        <p className="status-msg error media-status" role="status">
          <Icon name="alert" size={14} />
          {message}
        </p>
      )}
      {list.length === 0 ? (
        <div className="empty-state media-empty" onClick={() => inputRef.current?.click()}>
          <div className="empty-state-icon">
            <Icon name="upload" size={20} />
          </div>
          <div className="empty-state-title">No media yet</div>
          <p className="empty-state-text">Drop videos, audio or images here, or click Import media to browse.</p>
        </div>
      ) : (
        <ul className={`asset-list asset-list-${view}`}>
          {list.map((a) => (
            <AssetCard key={a.id} asset={a} usage={usage.get(a.id) ?? 0} view={view} />
          ))}
        </ul>
      )}
    </div>
  );
}
