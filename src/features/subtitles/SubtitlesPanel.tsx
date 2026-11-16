import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  DEFAULT_SUBTITLE_STYLE_ID,
  defaultSubtitleStyle,
  getEngine,
  getProjectDuration,
  useEditorStore,
  type Id,
  type SubtitleClip,
} from '../../core';
import { Slider, TextStyleEditor, useBurstTx } from '../text/controls';
import {
  addCueAt,
  clipsToCues,
  cueClips,
  importCues,
  mergeWithNext,
  setCueText,
  setCueTiming,
  shiftCueClips,
  splitCueAt,
  subtitleTracks,
  syncFromCue,
  updateSubtitleStyle,
  type ImportReport,
} from './cueActions';
import { formatClock, parseClock, parseSubtitles, serializeSubtitles, type SubtitleFormat } from './formats';
import { useTranscriptionProviders } from './transcription';
import '../text/text.css';
import './subtitles.css';

type Status = { kind: 'info' | 'error'; text: string } | null;

const S = () => useEditorStore.getState();

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function describeImport(r: ImportReport, warnings: string[] = []): Status {
  if (r.error) return { kind: 'error', text: r.error };
  const parts = [`Imported ${plural(r.added, 'cue')}`];
  if (r.replaced) parts.push(`replaced ${r.replaced}`);
  if (r.trimmed) parts.push(`${r.trimmed} trimmed to avoid overlaps`);
  if (r.skipped) parts.push(`${r.skipped} skipped (no room)`);
  if (warnings.length) parts.push(`${plural(warnings.length, 'malformed block')} ignored`);
  return { kind: 'info', text: parts.join(', ') + '.' };
}

function download(text: string, fileName: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'subtitles';
}

/** Time field committing on blur/Enter; reverts if invalid or rejected. */
function TimeInput({ label, value, onCommit }: { label: string; value: number; onCommit: (v: number) => boolean }) {
  const [draft, setDraft] = useState(formatClock(value));
  const [bad, setBad] = useState(false);
  useEffect(() => setDraft(formatClock(value)), [value]);
  const commit = () => {
    const v = parseClock(draft);
    if (v === null || (Math.abs(v - value) > 5e-4 && !onCommit(v))) {
      setBad(true);
      setTimeout(() => setBad(false), 900);
      setDraft(formatClock(value));
    }
  };
  return (
    <input
      type="text"
      className={`p3-time${bad ? ' bad' : ''}`}
      aria-label={label}
      title={`${label} (mm:ss.mmm)`}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

function CueText({ clip }: { clip: SubtitleClip }) {
  const { touch, end } = useBurstTx('Edit subtitle text');
  const [draft, setDraft] = useState(clip.text);
  useEffect(() => setDraft(clip.text), [clip.text]);
  return (
    <textarea
      className="p3-cue-text"
      aria-label="Cue text"
      rows={Math.min(4, Math.max(1, draft.split('\n').length))}
      value={draft}
      onBlur={end}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        touch();
        setDraft(e.target.value);
        setCueText(clip.id, e.target.value);
      }}
    />
  );
}

function CueRow({ clip, index, current, selected, locked, onStatus }: { clip: SubtitleClip; index: number; current: boolean; selected: boolean; locked: boolean; onStatus: (s: Status) => void }) {
  const ref = useRef<HTMLLIElement>(null);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  useEffect(() => {
    if (current && isPlaying) ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, [current, isPlaying]);
  const end = clip.start + clip.duration;
  const reject = (what: string) => onStatus({ kind: 'error', text: `${what}: would overlap a neighbouring cue or is invalid.` });
  return (
    <li
      ref={ref}
      className={`p3-cue${current ? ' current' : ''}${selected ? ' selected' : ''}`}
      data-testid="cue-row"
      aria-current={current ? 'true' : undefined}
      onClick={(e) => {
        const mode = e.shiftKey || e.metaKey || e.ctrlKey ? 'toggle' : 'replace';
        S().selectClips([clip.id], mode);
        if (mode === 'replace') S().setCurrentTime(clip.start);
      }}
    >
      <fieldset disabled={locked} className="p3-cue-fields">
        <div className="p3-cue-head">
          <span className="p3-cue-index muted small">{index + 1}</span>
          <TimeInput label="Start" value={clip.start} onCommit={(v) => setCueTiming(clip.id, v, end) || (reject('Start'), false)} />
          <span className="muted small">→</span>
          <TimeInput label="End" value={end} onCommit={(v) => setCueTiming(clip.id, clip.start, v) || (reject('End'), false)} />
          <span className="p3-cue-actions">
            <button
              type="button"
              className="btn btn-small btn-icon-only"
              title="Split at playhead (or in the middle)"
              aria-label="Split cue"
              onClick={(e) => {
                e.stopPropagation();
                if (!splitCueAt(clip.id, S().currentTime)) onStatus({ kind: 'error', text: 'Cue too short to split.' });
              }}
            >
              ✂
            </button>
            <button
              type="button"
              className="btn btn-small btn-icon-only"
              title="Merge with next cue"
              aria-label="Merge with next cue"
              onClick={(e) => {
                e.stopPropagation();
                if (!mergeWithNext(clip.id)) onStatus({ kind: 'error', text: 'No next cue to merge with.' });
              }}
            >
              ⤓
            </button>
            <button
              type="button"
              className="btn btn-small btn-icon-only btn-danger"
              title="Delete cue"
              aria-label="Delete cue"
              onClick={(e) => {
                e.stopPropagation();
                S().removeClips([clip.id]);
              }}
            >
              ×
            </button>
          </span>
        </div>
        <CueText clip={clip} />
      </fieldset>
    </li>
  );
}

function Section({ title, children, defaultOpen = false }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="p3-section" open={defaultOpen}>
      <summary>{title}</summary>
      <div className="p3-section-body">{children}</div>
    </details>
  );
}

function StyleEditor() {
  const style = useEditorStore((s) => s.project.subtitleStyles[DEFAULT_SUBTITLE_STYLE_ID]) ?? defaultSubtitleStyle();
  return (
    <div className="inspector-fields p3-inspector">
      <TextStyleEditor style={style} onChange={(next) => updateSubtitleStyle(style.id, next)} />
      <Slider
        label="Bottom"
        value={style.bottomMargin}
        min={0}
        max={0.9}
        step={0.005}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(bottomMargin) => updateSubtitleStyle(style.id, { bottomMargin })}
      />
      <Slider
        label="Max width"
        value={style.maxWidth}
        min={0.2}
        max={1}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(maxWidth) => updateSubtitleStyle(style.id, { maxWidth })}
      />
      <button type="button" className="btn btn-small" onClick={() => updateSubtitleStyle(style.id, { ...defaultSubtitleStyle(), id: style.id, name: style.name })}>
        Reset style
      </button>
    </div>
  );
}

function AutoCaptions({ trackId, onStatus }: { trackId: Id | null; onStatus: (s: Status) => void }) {
  const providers = useTranscriptionProviders();
  const [progress, setProgress] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const provider = providers[0];
  const run = async () => {
    if (!provider) return;
    const engine = getEngine();
    const duration = getProjectDuration(S().project);
    if (!engine) return onStatus({ kind: 'error', text: 'The playback engine is not available, so audio cannot be extracted.' });
    if (duration <= 0) return onStatus({ kind: 'error', text: 'The timeline is empty.' });
    const ac = new AbortController();
    abortRef.current = ac;
    setProgress(0);
    try {
      const audio = await engine.mixAudio({ start: 0, end: duration, sampleRate: 16000, channels: 1 });
      const cues = await provider.transcribe(audio, { signal: ac.signal, onProgress: (f) => setProgress(f) });
      onStatus(describeImport(importCues(cues, { trackId, label: 'Auto captions' })));
    } catch (e) {
      const aborted = e instanceof DOMException && e.name === 'AbortError';
      onStatus({ kind: aborted ? 'info' : 'error', text: aborted ? 'Auto captions cancelled.' : `Auto captions failed: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      abortRef.current = null;
      setProgress(null);
    }
  };
  if (progress !== null) {
    return (
      <span className="p3-progress">
        <progress max={1} value={progress} aria-label="Transcription progress" /> {Math.round(progress * 100)}%
        <button type="button" className="btn btn-small" onClick={() => abortRef.current?.abort()}>
          Cancel
        </button>
      </span>
    );
  }
  return (
    // Wrapper carries the tooltip: disabled buttons do not fire hover events in every browser.
    <span title={provider ? `Generate captions with ${provider.label}` : 'Auto captions need a speech-to-text provider, and none is installed in this build.'}>
      <button type="button" className="btn" disabled={!provider} onClick={run}>
        Auto captions
      </button>
    </span>
  );
}

export default function SubtitlesPanel() {
  const project = useEditorStore((s) => s.project);
  const currentTime = useEditorStore((s) => s.currentTime);
  const selectedIds = useEditorStore((s) => s.selectedClipIds);
  const tracks = subtitleTracks(project);
  const [trackChoice, setTrackChoice] = useState<Id | null>(null);
  const trackId = tracks.find((t) => t.id === trackChoice)?.id ?? tracks[0]?.id ?? null;
  const track = tracks.find((t) => t.id === trackId);
  const cues = useMemo(() => cueClips(project, trackId), [project, trackId]);
  const selectedCues = cues.filter((c) => selectedIds.includes(c.id));
  const [status, setStatus] = useState<Status>(null);
  const [replace, setReplace] = useState(false);
  const [shiftMs, setShiftMs] = useState(100);
  const fileRef = useRef<HTMLInputElement>(null);

  const onImport = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = parseSubtitles(text, file.name);
      if (parsed.cues.length === 0) return setStatus({ kind: 'error', text: `No cues found in ${file.name}.` });
      const r = importCues(parsed.cues, { trackId, replace });
      if (r.trackId) setTrackChoice(r.trackId);
      setStatus(describeImport(r, parsed.warnings));
    } catch (e) {
      setStatus({ kind: 'error', text: `Could not read ${file.name}: ${e instanceof Error ? e.message : String(e)}` });
    }
  };

  const onExport = (format: SubtitleFormat) => {
    if (cues.length === 0) return setStatus({ kind: 'error', text: 'No cues to export.' });
    const text = serializeSubtitles(clipsToCues(cues), format);
    download(text, `${safeFileName(project.name)}.${format}`, format === 'vtt' ? 'text/vtt' : 'application/x-subrip');
    setStatus({ kind: 'info', text: `Exported ${plural(cues.length, 'cue')} as ${format.toUpperCase()}.` });
  };

  const shift = (ids: Id[], sign: 1 | -1) => {
    const ok = shiftCueClips(ids, (sign * shiftMs) / 1000);
    setStatus(ok ? { kind: 'info', text: `Shifted ${plural(ids.length, 'cue')} by ${sign > 0 ? '+' : '−'}${shiftMs} ms.` } : { kind: 'error', text: 'Shift rejected (overlap with other cues, locked track, or already at 0).' });
  };

  return (
    <div className="p3-panel p3-subs">
      <div className="p3-toolbar">
        <button type="button" className="btn btn-primary" disabled={!!track?.locked} onClick={() => addCueAt(trackId, S().currentTime) || setStatus({ kind: 'error', text: 'No room for a cue at the playhead.' })}>
          + Add cue
        </button>
        <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
          Import…
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".srt,.vtt,text/vtt,application/x-subrip"
          hidden
          data-testid="subtitle-file-input"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void onImport(f);
          }}
        />
        <button type="button" className="btn" onClick={() => onExport('srt')}>
          Export SRT
        </button>
        <button type="button" className="btn" onClick={() => onExport('vtt')}>
          Export VTT
        </button>
        <AutoCaptions trackId={trackId} onStatus={setStatus} />
      </div>
      <div className="p3-row">
        {tracks.length > 1 && (
          <select aria-label="Subtitle track" value={trackId ?? ''} onChange={(e) => setTrackChoice(e.target.value)}>
            {tracks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.locked ? ' (locked)' : ''}
              </option>
            ))}
          </select>
        )}
        <label className="p3-check" title="Remove the track's existing cues before importing">
          <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> Replace on import
        </label>
      </div>
      {status && (
        <p className={`small p3-status ${status.kind}`} role="status">
          {status.text}
        </p>
      )}

      <Section title="Sync" defaultOpen>
        <div className="p3-row">
          <label className="p3-check">
            Offset
            <input type="number" aria-label="Shift amount in ms" className="p3-ms" value={shiftMs} min={1} step={10} onChange={(e) => setShiftMs(Math.max(1, Math.abs(Number(e.target.value) || 0)))} />
            ms
          </label>
        </div>
        <div className="p3-row">
          <span className="muted small p3-row-label">All</span>
          <button type="button" className="btn btn-small" disabled={!cues.length} onClick={() => shift(cues.map((c) => c.id), -1)}>
            − Earlier
          </button>
          <button type="button" className="btn btn-small" disabled={!cues.length} onClick={() => shift(cues.map((c) => c.id), 1)}>
            + Later
          </button>
        </div>
        <div className="p3-row">
          <span className="muted small p3-row-label">Selected</span>
          <button type="button" className="btn btn-small" disabled={!selectedCues.length} onClick={() => shift(selectedCues.map((c) => c.id), -1)}>
            − Earlier
          </button>
          <button type="button" className="btn btn-small" disabled={!selectedCues.length} onClick={() => shift(selectedCues.map((c) => c.id), 1)}>
            + Later
          </button>
        </div>
        <button
          type="button"
          className="btn btn-small"
          disabled={selectedCues.length !== 1}
          title="Moves the selected cue's start to the playhead and shifts every following cue by the same amount"
          onClick={() => {
            const ok = syncFromCue(selectedCues[0]!.id, S().currentTime);
            setStatus(ok ? { kind: 'info', text: 'Cue start set to playhead; following cues shifted.' } : { kind: 'error', text: 'Sync rejected (would overlap the previous cue, or track locked).' });
          }}
        >
          Start selected at playhead ⇢ shift following
        </button>
      </Section>

      <Section title="Style (all subtitles)">
        <StyleEditor />
      </Section>

      <div className="p3-cue-list-head muted small">
        {track ? `${track.name}: ${plural(cues.length, 'cue')}` : 'No subtitle track yet — add or import cues.'}
        {track?.locked && ' (locked)'}
      </div>
      <ul className="p3-cue-list">
        {cues.map((c, i) => (
          <CueRow
            key={c.id}
            clip={c}
            index={i}
            current={currentTime >= c.start - 1e-6 && currentTime < c.start + c.duration - 1e-6}
            selected={selectedIds.includes(c.id)}
            locked={!!track?.locked}
            onStatus={setStatus}
          />
        ))}
      </ul>
    </div>
  );
}
