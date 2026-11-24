import { useEffect } from 'react';
import { formatDuration, Icon, useEditorStore } from '../../core';
import { cancelVoiceover, refreshMics, startVoiceover, stopVoiceover, useVoiceoverStore } from './voiceoverStore';
import './voiceover.css';

function fmt(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

export default function VoiceoverPanel() {
  const v = useVoiceoverStore();
  const playhead = useEditorStore((s) => s.currentTime);
  useEffect(() => void refreshMics(), []);
  const busy = v.status !== 'idle';

  return (
    <div className="vo-panel">
      <h3 className="section-title vo-title">Voiceover</h3>
      <p className="vo-msg">Record your voice while the video plays. The recording starts at the playhead and lands on a “Voiceover” audio track.</p>

      <fieldset className="vo-group" disabled={busy}>
        <label className="vo-field">
          <span>Microphone</span>
          <select aria-label="Microphone" value={v.deviceId} onChange={(e) => useVoiceoverStore.setState({ deviceId: e.target.value })}>
            <option value="">System default</option>
            {v.devices
              .filter((d) => d.id && d.id !== 'default')
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
          </select>
        </label>
        <label className="vo-check" title="The video plays silently so your microphone does not pick it up. Turn off if you use headphones and want to hear it.">
          <input type="checkbox" checked={v.muteTimeline} onChange={(e) => useVoiceoverStore.setState({ muteTimeline: e.target.checked })} />
          Mute the video while recording
        </label>
        <label className="vo-check" title="Removes room echo, low rumble and background hiss, and evens out the level of each take">
          <input type="checkbox" checked={v.cleanVoice} onChange={(e) => useVoiceoverStore.setState({ cleanVoice: e.target.checked })} />
          Clean up voice (less echo &amp; noise)
        </label>
        <label className="vo-check">
          <input type="checkbox" checked={v.useCountdown} onChange={(e) => useVoiceoverStore.setState({ useCountdown: e.target.checked })} />
          3-second countdown
        </label>
      </fieldset>

      <div className="vo-stage" data-status={v.status}>
        {v.status === 'countdown' && (
          <div className="vo-countdown" aria-live="assertive">
            {v.countdown}
          </div>
        )}
        {v.status === 'recording' && (
          <div className="vo-live" role="status">
            <span className="vo-dot" aria-hidden /> REC <span className="vo-time">{fmt(v.elapsed)}</span>
          </div>
        )}
        {v.status === 'saving' && <div className="vo-live">Saving…</div>}
        {v.status === 'idle' && (
          <div className="vo-idle">
            <Icon name="mic" size={20} />
            <span>Starts at {formatDuration(playhead)}</span>
          </div>
        )}
        {(v.status === 'countdown' || v.status === 'recording') && (
          <div className="progress vo-meter" aria-label="Microphone level">
            <span style={{ width: `${Math.round(v.level * 100)}%` }} />
          </div>
        )}
      </div>

      <div className="vo-actions">
        {v.status === 'idle' && (
          <button type="button" className="btn btn-primary btn-large vo-rec" onClick={() => void startVoiceover()}>
            <Icon name="record-dot" />
            Record
          </button>
        )}
        {v.status === 'recording' && (
          <button type="button" className="btn btn-danger-solid btn-large vo-rec" onClick={() => void stopVoiceover()}>
            <Icon name="stop" />
            Stop
          </button>
        )}
        {(v.status === 'countdown' || v.status === 'recording') && (
          <button type="button" className="btn btn-large" onClick={() => cancelVoiceover()}>
            Cancel
          </button>
        )}
      </div>
      {v.message && (
        <p className={`status-msg vo-status${v.message.kind === 'error' ? ' error' : ''}`}>
          <Icon name={v.message.kind === 'error' ? 'alert' : 'info'} size={14} />
          {v.message.text}
        </p>
      )}
      <p className="vo-msg vo-tip">Tips: Space also stops the recording. Headphones avoid echo. Afterwards you can trim, move, change the volume or run “Audio cleanup” on the take like any clip.</p>
    </div>
  );
}
