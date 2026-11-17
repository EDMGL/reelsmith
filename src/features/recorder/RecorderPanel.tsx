import { useEffect, useRef } from 'react';
import { Icon, type IconName } from '../../core';
import { cancelRecording, closePreview, openPreview, setSources, startRecording, stopRecording, useRecorderStore } from './recorderStore';
import type { BubbleCorner, BubbleShape, BubbleSize } from './layout';
import './recorder.css';

function LiveVideo({ stream, mirror, className, label }: { stream: MediaStream | null; mirror?: boolean; className?: string; label: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;
    if (stream) void el.play().catch(() => undefined);
  }, [stream]);
  return <video ref={ref} className={`${className ?? ''}${mirror ? ' rc-mirror' : ''}`} muted playsInline aria-label={label} />;
}

const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

const CORNERS: readonly { id: BubbleCorner; icon: IconName }[] = [
  { id: 'top-left', icon: 'corner-tl' },
  { id: 'top-right', icon: 'corner-tr' },
  { id: 'bottom-left', icon: 'corner-bl' },
  { id: 'bottom-right', icon: 'corner-br' },
];

export default function RecorderPanel() {
  const r = useRecorderStore();
  const busy = r.status !== 'idle';
  const live = r.status === 'recording' || r.status === 'countdown';

  useEffect(() => {
    if (r.sources.camera) void openPreview();
  }, [r.sources.camera]);
  useEffect(() => () => closePreview(), []);

  const source = (key: 'screen' | 'camera' | 'mic', icon: IconName, label: string, hint: string) => (
    <button
      type="button"
      className={`rc-source${r.sources[key] ? ' on' : ''}`}
      aria-pressed={r.sources[key]}
      disabled={busy}
      title={hint}
      onClick={() => setSources({ [key]: !r.sources[key] })}
    >
      <span className="rc-source-icon" aria-hidden>
        <Icon name={icon} size={20} />
      </span>
      <span>{label}</span>
    </button>
  );

  return (
    <div className="rc-panel">
      <div className="rc-head">
        <h3 className="section-title rc-title">Record</h3>
        <p className="rc-msg">Screen, camera and mic together. They land on the timeline as separate clips you can edit.</p>
      </div>

      <div className="rc-sources" role="group" aria-label="Sources">
        {source('screen', 'monitor', 'Screen', 'Record a screen, window or tab (the browser asks which)')}
        {source('camera', 'camera', 'Camera', 'Your webcam, shown as a bubble over the screen')}
        {source('mic', 'mic', 'Mic', 'Your voice')}
      </div>

      <div className={`rc-stage${live ? ' live' : ''}`}>
        {r.screenPreview && <LiveVideo stream={r.screenPreview} className="rc-screen" label="Screen preview" />}
        {!r.screenPreview && r.sources.screen && <div className="rc-screen rc-screen-empty">{r.status === 'starting' ? 'Choose what to share…' : 'Screen'}</div>}
        {r.sources.camera && (
          <div className={`rc-bubble rc-${r.shape} rc-${r.size} rc-${r.corner}${r.sources.screen ? '' : ' rc-full'}`}>
            {r.preview ? <LiveVideo stream={r.preview} mirror label="Camera preview" /> : <span className="rc-cam-off">Camera</span>}
          </div>
        )}
        {r.status === 'countdown' && <div className="rc-countdown">{r.countdown}</div>}
        {r.status === 'recording' && (
          <div className="rc-rec" role="status">
            <span className="rc-dot" aria-hidden /> REC {fmt(r.elapsed)}
          </div>
        )}
        {r.status === 'processing' && <div className="rc-countdown rc-small">Preparing files…</div>}
      </div>

      {r.sources.camera && r.sources.screen && (
        <fieldset className="rc-options" disabled={busy}>
          <div className="rc-row">
            <span className="rc-label">Bubble</span>
            <div className="segmented" role="group" aria-label="Bubble shape">
              {(['circle', 'rounded'] as BubbleShape[]).map((s) => (
                <button key={s} type="button" className={r.shape === s ? 'active' : ''} aria-pressed={r.shape === s} onClick={() => useRecorderStore.setState({ shape: s })}>
                  <Icon name={s === 'circle' ? 'shape-circle' : 'shape-rounded'} size={14} />
                  {s === 'circle' ? 'Circle' : 'Rounded'}
                </button>
              ))}
            </div>
          </div>
          <div className="rc-row">
            <span className="rc-label">Size</span>
            <div className="segmented" role="group" aria-label="Bubble size">
              {(['small', 'medium', 'large'] as BubbleSize[]).map((s) => (
                <button key={s} type="button" className={r.size === s ? 'active' : ''} aria-pressed={r.size === s} onClick={() => useRecorderStore.setState({ size: s })}>
                  {s[0]!.toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div className="rc-row">
            <span className="rc-label">Corner</span>
            <div className="rc-corners" role="group" aria-label="Bubble corner">
              {CORNERS.map((c) => (
                <button key={c.id} type="button" className={r.corner === c.id ? 'active' : ''} aria-pressed={r.corner === c.id} aria-label={c.id} onClick={() => useRecorderStore.setState({ corner: c.id })}>
                  <Icon name={c.icon} size={14} />
                </button>
              ))}
            </div>
          </div>
        </fieldset>
      )}

      <label className="rc-check">
        <input type="checkbox" checked={r.useCountdown} disabled={busy} onChange={(e) => useRecorderStore.setState({ useCountdown: e.target.checked })} />
        3-second countdown
      </label>

      <div className="rc-actions">
        {r.status === 'idle' && (
          <button type="button" className="btn btn-primary btn-large rc-go" onClick={() => void startRecording()} disabled={!r.sources.screen && !r.sources.camera}>
            <Icon name="record-dot" />
            Start recording
          </button>
        )}
        {r.status === 'recording' && (
          <button type="button" className="btn btn-danger-solid btn-large rc-go rc-stop" onClick={() => void stopRecording()}>
            <Icon name="stop" />
            Stop
          </button>
        )}
        {(r.status === 'recording' || r.status === 'countdown' || r.status === 'starting') && (
          <button type="button" className="btn btn-large" onClick={() => cancelRecording()}>
            Cancel
          </button>
        )}
      </div>
      {r.message && (
        <p className={`status-msg rc-status${r.message.kind === 'error' ? ' error' : ''}`}>
          <Icon name={r.message.kind === 'error' ? 'alert' : 'info'} size={14} />
          {r.message.text}
        </p>
      )}
      <p className="rc-msg rc-tip">Tip: to include sound from a video or tab, tick “Share audio” in the browser’s picker. The browser’s “Stop sharing” button also ends the recording.</p>
    </div>
  );
}
