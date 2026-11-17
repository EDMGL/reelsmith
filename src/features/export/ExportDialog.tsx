import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Icon, formatDuration, useEditorStore, useEngine, getProjectDuration } from '../../core';
import { useExportStore } from './exportStore';
import { hasWebCodecs } from './pipeline';
import {
  formatBytes,
  formatClock,
  fpsOptions,
  planExport,
  resolutionOptions,
  type QualityPreset,
  type ResolutionPreset,
} from './plan';
import './export.css';

const QUALITY_LABELS: Record<QualityPreset, string> = { low: 'Low (smaller file)', medium: 'Medium', high: 'High (larger file)' };

export default function ExportDialog() {
  const st = useExportStore();
  const project = useEditorStore((s) => s.project);
  const engine = useEngine();
  const running = st.status === 'running';
  const settings = st.settings;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useExportStore.getState().closeDialog();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!settings) return null;
  const duration = getProjectDuration(project);
  const plan = planExport(project, settings);
  const resOptions = resolutionOptions(project.width, project.height);
  const webcodecs = hasWebCodecs();
  const blocker = !engine
    ? 'The preview/render engine is not loaded, so the project cannot be rendered. Export is unavailable.'
    : duration <= 0
      ? 'Nothing to export: the timeline is empty.'
      : !webcodecs
        ? 'This browser does not support WebCodecs video encoding. Use a recent Chrome, Edge or Safari.'
        : st.codecError;
  const canStart = !blocker && !!st.codecs && !st.probing && !running;
  const p = st.progress;

  return createPortal(
    <div className="exp-backdrop" onMouseDown={(e) => e.target === e.currentTarget && st.closeDialog()}>
      <div className="exp-dialog" role="dialog" aria-modal="true" aria-labelledby="exp-title">
        <header className="exp-head">
          <h2 id="exp-title">Export video</h2>
          <button type="button" className="btn btn-ghost btn-icon-only" aria-label="Close" disabled={running} onClick={() => st.closeDialog()}>
            <Icon name="close" />
          </button>
        </header>

        <div className="exp-body">
          <fieldset className="exp-form" disabled={running}>
            <label>
              <span>File name</span>
              <input type="text" value={settings.fileName} onChange={(e) => st.updateSettings({ fileName: e.target.value })} />
            </label>
            <label>
              <span>Resolution</span>
              <select
                value={String(settings.resolution)}
                onChange={(e) => st.updateSettings({ resolution: (e.target.value === 'project' ? 'project' : Number(e.target.value)) as ResolutionPreset })}
              >
                {resOptions.map((o) => (
                  <option key={String(o.value)} value={String(o.value)}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Frame rate</span>
              <select value={settings.fps} onChange={(e) => st.updateSettings({ fps: Number(e.target.value) })}>
                {fpsOptions(project.fps).map((f) => (
                  <option key={f} value={f}>
                    {f} fps{f === project.fps ? ' (project)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Quality</span>
              <select value={settings.quality} onChange={(e) => st.updateSettings({ quality: e.target.value as QualityPreset })}>
                {(Object.keys(QUALITY_LABELS) as QualityPreset[]).map((q) => (
                  <option key={q} value={q}>
                    {QUALITY_LABELS[q]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Format</span>
              <select value={settings.format} onChange={(e) => st.updateSettings({ format: e.target.value as 'mp4' | 'webm' })}>
                <option value="mp4">MP4 (H.264 + AAC)</option>
                <option value="webm">WebM (VP9 + Opus)</option>
              </select>
            </label>
            <div className="exp-row">
              <span>Range</span>
              <span>Whole project ({formatDuration(duration)})</span>
            </div>
          </fieldset>

          <div className="exp-info" data-testid="export-info">
            <div>
              Output: {plan.width}×{plan.height}, {plan.fps} fps, {plan.frameCount} frames, ~{(plan.videoBitrate / 1e6).toFixed(1)} Mbit/s video
            </div>
            <div>
              Encoding:{' '}
              {st.probing ? 'checking browser support…' : st.codecs ? <strong data-testid="export-codec">{st.codecs.label}</strong> : '—'}
            </div>
            {st.codecs?.fallbackNote && <div className="exp-warn">{st.codecs.fallbackNote}</div>}
          </div>

          {blocker && (
            <p className="status-msg warning exp-blocker">
              <Icon name="alert" size={14} />
              <span>{blocker}</span>
            </p>
          )}

          {running && (
            <div className="exp-progress" role="status">
              <div className="exp-bar">
                <div style={{ width: `${Math.round((p?.fraction ?? 0) * 100)}%` }} />
              </div>
              <div className="exp-stats">
                <span>
                  {p?.phase === 'audio' ? 'Mixing audio…' : p?.phase === 'finalizing' ? 'Finalizing…' : `Frame ${p?.framesDone ?? 0} / ${p?.totalFrames ?? plan.frameCount}`}
                </span>
                <span>Elapsed {formatClock(p?.elapsedMs ?? 0)}</span>
                <span>ETA {p?.etaMs != null ? formatClock(p.etaMs) : '—'}</span>
              </div>
            </div>
          )}
          {st.status === 'error' && st.error && (
            <p className="status-msg error exp-error" role="alert">
              Export failed: {st.error}
            </p>
          )}
          {st.status === 'cancelled' && <p className="status-msg exp-note">Export cancelled.</p>}
          {st.status === 'done' && st.result && (
            <p className="status-msg success exp-note exp-done" data-testid="export-done">
              {st.result.savedTo === 'file' ? 'Saved' : 'Downloaded'} <strong>{st.result.fileName}</strong> ({formatBytes(st.result.size)}) in{' '}
              {st.result.seconds.toFixed(1)} s.{' '}
              <a href={st.result.url} download={st.result.fileName} data-testid="export-download">
                Download again
              </a>
            </p>
          )}
        </div>

        <footer className="exp-foot">
          {running ? (
            <button type="button" className="btn" onClick={() => st.cancel()}>
              Cancel export
            </button>
          ) : (
            <>
              <button type="button" className="btn" onClick={() => st.closeDialog()}>
                Close
              </button>
              <button type="button" className="btn btn-primary" disabled={!canStart} onClick={() => void st.start()}>
                Export
              </button>
            </>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  );
}
