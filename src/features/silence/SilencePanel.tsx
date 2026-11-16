import { formatDuration, getProjectDuration, useEditorStore } from '../../core';
import { includedRanges, isStale, riskyLockedTracks, useSilenceStore } from './silenceStore';
import { totalLength } from './timelineSilence';
import './silence.css';

function NumberField(props: { label: string; value: number; min: number; max: number; step?: number; unit: string; onChange: (v: number) => void; title?: string }) {
  return (
    <label className="sil-field" title={props.title}>
      <span>{props.label}</span>
      <span className="sil-num">
        <input
          type="number"
          value={props.value}
          min={props.min}
          max={props.max}
          step={props.step ?? 10}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) props.onChange(Math.min(props.max, Math.max(props.min, v)));
          }}
        />
        <small>{props.unit}</small>
      </span>
    </label>
  );
}

export default function SilencePanel() {
  const s = useSilenceStore();
  const project = useEditorStore((st) => st.project);
  const selectedCount = useEditorStore((st) => st.selectedClipIds.length);
  const stale = isStale(s.result, project);
  const included = includedRanges(s.result);
  const removable = totalLength(included);
  const duration = getProjectDuration(project);
  const locked = s.result ? riskyLockedTracks(project, s.result) : [];
  const running = s.status === 'running';
  const p = s.params;

  return (
    <div className="sil-panel">
      <h3 className="sil-title">Silence removal</h3>

      <fieldset className="sil-group" disabled={running}>
        <legend>Analyze</legend>
        <label className="sil-radio">
          <input type="radio" name="sil-scope" checked={s.scope === 'timeline'} onChange={() => s.setScope('timeline')} />
          Whole timeline (all audible clips)
        </label>
        <label className="sil-radio">
          <input type="radio" name="sil-scope" checked={s.scope === 'selection'} onChange={() => s.setScope('selection')} />
          Selected clip{selectedCount === 1 ? '' : 's'} ({selectedCount} selected)
        </label>
        {s.scope === 'timeline' && (
          <label className="sil-check" title="Stretches where no unmuted video/audio clip plays (empty gaps, image/text only) are kept unless this is ticked.">
            <input type="checkbox" checked={s.includeNoAudio} onChange={(e) => s.setIncludeNoAudio(e.target.checked)} />
            Also remove stretches without any audio
          </label>
        )}
      </fieldset>

      <fieldset className="sil-group" disabled={running}>
        <legend>Parameters</legend>
        <label className="sil-check">
          <input type="checkbox" checked={p.autoThreshold} onChange={(e) => s.setParams({ autoThreshold: e.target.checked })} />
          Auto threshold (from noise floor)
        </label>
        <label className="sil-field">
          <span>Threshold</span>
          <span className="sil-num">
            <input
              type="range"
              min={-70}
              max={-10}
              step={1}
              value={p.thresholdDb}
              disabled={p.autoThreshold}
              aria-label="Threshold (dBFS)"
              onChange={(e) => s.setParams({ thresholdDb: Number(e.target.value) })}
            />
            <small>{p.autoThreshold ? 'auto' : `${p.thresholdDb} dB`}</small>
          </span>
        </label>
        <NumberField label="Min. silence" unit="ms" min={50} max={10000} value={p.minSilenceMs} onChange={(v) => s.setParams({ minSilenceMs: v })} />
        <NumberField label="Padding" unit="ms" min={0} max={2000} value={p.paddingMs} onChange={(v) => s.setParams({ paddingMs: v })} title="Audio kept before and after speech" />
        <NumberField
          label="Min. speech kept"
          unit="ms"
          min={0}
          max={5000}
          value={p.minKeepMs}
          onChange={(v) => s.setParams({ minKeepMs: v })}
          title="Speech fragments shorter than this between two silences are removed too (0 = off)"
        />
        <NumberField label="Window" unit="ms" min={5} max={100} step={5} value={p.windowMs} onChange={(v) => s.setParams({ windowMs: v })} />
      </fieldset>

      <div className="sil-actions">
        {running ? (
          <button type="button" className="btn" onClick={() => s.abort()}>
            Cancel
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => void s.detect()}>
            Detect silence
          </button>
        )}
      </div>

      {running && (
        <div className="sil-progress" role="status">
          <div className="sil-bar">
            <div style={{ width: `${Math.round(s.progress.fraction * 100)}%` }} />
          </div>
          <small>
            {s.progress.label} {Math.round(s.progress.fraction * 100)}%
          </small>
        </div>
      )}
      {s.error && <p className="sil-msg sil-error">{s.error}</p>}
      {s.notice && <p className="sil-msg">{s.notice}</p>}

      {s.result && (
        <div className="sil-result">
          {stale && <p className="sil-msg sil-warn">The timeline changed since detection. Run Detect again before removing.</p>}
          {locked.length > 0 && (
            <p className="sil-msg sil-warn">
              Locked track{locked.length > 1 ? 's' : ''} {locked.map((n) => `"${n}"`).join(', ')} will not be cut and will go out of sync. Unlock to keep everything aligned.
            </p>
          )}
          {s.result.skipped.length > 0 && <p className="sil-msg sil-warn">Skipped (treated as no audio): {s.result.skipped.join('; ')}</p>}
          <dl className="sil-summary" data-testid="silence-summary">
            <dt>Silences</dt>
            <dd>
              {included.length} of {s.result.ranges.length} selected
            </dd>
            <dt>Removable</dt>
            <dd>{removable.toFixed(2)} s</dd>
            <dt>Duration</dt>
            <dd>
              {formatDuration(duration)} → {formatDuration(Math.max(0, duration - removable))}
            </dd>
            {s.result.thresholds.map((t) => (
              <div key={t.assetId} className="sil-thr">
                <dt title={t.name}>Threshold</dt>
                <dd>
                  {t.thresholdDb.toFixed(1)} dB{t.floorDb !== null ? ` (floor ${t.floorDb.toFixed(1)} dB)` : ''}
                </dd>
              </div>
            ))}
          </dl>
          {s.result.ranges.length > 0 && (
            <div className="sil-bulk">
              <button type="button" className="btn btn-small" onClick={() => s.setAllIncluded(true)}>
                Select all
              </button>
              <button type="button" className="btn btn-small" onClick={() => s.setAllIncluded(false)}>
                Select none
              </button>
            </div>
          )}
          <ul className="sil-list">
            {s.result.ranges.map((r, i) => (
              <li key={`${r.start}-${r.end}`} className={r.included ? '' : 'excluded'}>
                <input type="checkbox" checked={r.included} aria-label={`Include silence ${i + 1}`} onChange={() => s.toggleRange(i)} />
                <button
                  type="button"
                  className="sil-seek"
                  title="Move the playhead here"
                  onClick={() => useEditorStore.getState().setCurrentTime(r.start)}
                >
                  {r.start.toFixed(2)}s – {r.end.toFixed(2)}s
                </button>
                <small>{(r.end - r.start).toFixed(2)}s</small>
              </li>
            ))}
          </ul>
          <div className="sil-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={stale || included.length === 0}
              onClick={() => s.removeSelected()}
            >
              Remove selected silences
            </button>
            <button type="button" className="btn" onClick={() => s.clear()}>
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
