import { useState } from 'react';
import type { InspectorProps } from '../../core';
import { cancelNoiseReduction, clipsUsing, denoisedStrength, originalOf, reduceNoise, restoreOriginal, useDenoiseStore } from './denoiseStore';
import { DENOISE_STRENGTHS, type DenoiseStrength } from './spectralGate';
import './denoise.css';

const STRENGTHS = Object.keys(DENOISE_STRENGTHS) as DenoiseStrength[];

export default function DenoiseInspector({ clip, project }: InspectorProps<'video' | 'audio'>) {
  const asset = project.assets[clip.assetId];
  const source = asset ? originalOf(project, asset) : undefined;
  const job = useDenoiseStore((s) => (source ? s.jobs[source.id] : undefined));
  const message = useDenoiseStore((s) => (source ? s.messages[source.id] : undefined));
  const applied = asset ? denoisedStrength(asset) : null;
  const [strength, setStrength] = useState<DenoiseStrength>(applied ?? 'medium');

  if (!asset || !source) return null;
  if (!asset.hasAudio) return <p className="dn-msg">This clip has no audio.</p>;
  const clipCount = clipsUsing(project, asset.id).length;

  return (
    <div className="dn">
      <p className="dn-msg">Removes constant background noise (fan, hum, hiss, room tone) from this file's audio. Video is copied without re-encoding.</p>
      {applied && (
        <p className="dn-badge" data-testid="denoise-applied">
          ✓ Noise reduced · {DENOISE_STRENGTHS[applied].label}
        </p>
      )}
      <div className="segmented dn-strength" role="group" aria-label="Noise reduction strength">
        {STRENGTHS.map((k) => (
          <button key={k} type="button" className={strength === k ? 'active' : ''} aria-pressed={strength === k} title={DENOISE_STRENGTHS[k].hint} disabled={!!job} onClick={() => setStrength(k)}>
            {DENOISE_STRENGTHS[k].label}
          </button>
        ))}
      </div>
      <p className="dn-msg">{DENOISE_STRENGTHS[strength].hint}</p>
      {job ? (
        <div className="dn-progress" role="status">
          <div className="dn-bar">
            <div style={{ width: `${Math.round(job.fraction * 100)}%` }} />
          </div>
          <small>
            {job.label} {Math.round(job.fraction * 100)}%
          </small>
          <button type="button" className="btn btn-small" onClick={() => cancelNoiseReduction(source.id)}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="dn-actions">
          <button type="button" className="btn btn-primary" onClick={() => void reduceNoise(asset.id, strength)}>
            {applied ? 'Re-apply' : 'Reduce noise'}
          </button>
          {applied && (
            <button type="button" className="btn" onClick={() => restoreOriginal(asset.id)}>
              Restore original
            </button>
          )}
        </div>
      )}
      {clipCount > 1 && <p className="dn-msg">Applies to all {clipCount} clips from this file.</p>}
      {message && <p className={`dn-msg ${message.kind === 'error' ? 'dn-error' : ''}`}>{message.text}</p>}
    </div>
  );
}
