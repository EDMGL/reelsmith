import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  DEFAULT_SUBTITLE_STYLE_ID,
  defaultSubtitleStyle,
  getEngine,
  getProjectDuration,
  getTrackClipsAt,
  Icon,
  useEditorStore,
  type Project,
  type Id,
  type SubtitleClip,
  type SubtitleStyle,
  type WordHighlight,
  type WordHighlightMode,
} from '../../core';
import { ColorInput, Field, Slider, TextStyleEditor, useBurstTx } from '../text/controls';
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

interface CueRowProps {
  clip: SubtitleClip;
  index: number;
  current: boolean;
  selected: boolean;
  locked: boolean;
  onStatus: (s: Status) => void;
}

/**
 * One cue. Memoized: it re-renders only when its own clip object (immutable),
 * index, current/selected/locked flags change, never on playback ticks.
 */
const CueRow = memo(function CueRow({ clip, index, current, selected, locked, onStatus }: CueRowProps) {
  const end = clip.start + clip.duration;
  const reject = (what: string) => onStatus({ kind: 'error', text: `${what}: would overlap a neighbouring cue or is invalid.` });
  return (
    <li
      data-cue-id={clip.id}
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
              <Icon name="scissors" size={14} />
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
              <Icon name="arrow-down" size={14} />
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
              <Icon name="close" size={14} />
            </button>
          </span>
        </div>
        <CueText clip={clip} />
      </fieldset>
    </li>
  );
});

function Section({ title, children, defaultOpen = false }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="p3-section" open={defaultOpen}>
      <summary>{title}</summary>
      <div className="p3-section-body">{children}</div>
    </details>
  );
}

const HIGHLIGHT_MODES: readonly { mode: WordHighlightMode; label: string; color: string; hint: string }[] = [
  { mode: 'none', label: 'None', color: '#FFE600', hint: 'Plain subtitles.' },
  { mode: 'color', label: 'Color', color: '#FFE600', hint: 'The word being spoken changes color (TikTok style).' },
  { mode: 'box', label: 'Box', color: '#7C3AED', hint: 'A colored box moves from word to word.' },
  { mode: 'karaoke', label: 'Karaoke', color: '#22D3EE', hint: 'Words fill with color as they are spoken.' },
];

export const DEFAULT_HIGHLIGHT: WordHighlight = { mode: 'none', color: '#FFE600', pop: 1 };
const POP_SCALE = 1.15;

/** Word-by-word highlight settings of a subtitle style. */
export function HighlightEditor({ style }: { style: SubtitleStyle }) {
  const hl = style.highlight ?? DEFAULT_HIGHLIGHT;
  const set = (patch: Partial<WordHighlight>) => updateSubtitleStyle(style.id, { highlight: { ...hl, ...patch } });
  const info = HIGHLIGHT_MODES.find((m) => m.mode === hl.mode) ?? HIGHLIGHT_MODES[0]!;
  return (
    <>
      <Field label="Highlight">
        <div className="segmented p3-hl-modes" role="group" aria-label="Word highlight">
          {HIGHLIGHT_MODES.map((m) => (
            <button
              key={m.mode}
              type="button"
              className={hl.mode === m.mode ? 'active' : ''}
              aria-pressed={hl.mode === m.mode}
              title={m.hint}
              onClick={() => {
                const wasDefault = HIGHLIGHT_MODES.some((x) => x.color.toLowerCase() === hl.color.toLowerCase());
                set({ mode: m.mode, ...(wasDefault ? { color: m.color } : {}) });
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
      </Field>
      {hl.mode !== 'none' && (
        <>
          <ColorInput label={hl.mode === 'box' ? 'Box color' : 'Highlight color'} value={hl.color} onChange={(color) => set({ color })} />
          <label className="field">
            <span className="field-label">Pop</span>
            <span className="field-input">
              <input type="checkbox" aria-label="Pop active word" checked={hl.pop > 1} onChange={(e) => set({ pop: e.target.checked ? POP_SCALE : 1 })} />
              <span className="muted small">Active word grows slightly</span>
            </span>
          </label>
        </>
      )}
      <p className="muted small p3-hl-hint">
        {info.hint}
        {hl.mode !== 'none' && ' Auto captions give exact word timing; other subtitles are timed by estimate.'}
      </p>
    </>
  );
}

const StyleEditor = memo(function StyleEditor() {
  const style = useEditorStore((s) => s.project.subtitleStyles[DEFAULT_SUBTITLE_STYLE_ID]) ?? defaultSubtitleStyle();
  return (
    <div className="inspector-fields p3-inspector">
      <HighlightEditor style={style} />
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
      <button type="button" className="btn btn-small" onClick={() => updateSubtitleStyle(style.id, { ...defaultSubtitleStyle(), id: style.id, name: style.name, highlight: undefined })}>
        Reset style
      </button>
    </div>
  );
});

/** Whisper language hints ('' = auto-detect). */
const CAPTION_LANGUAGES: readonly [code: string, label: string][] = [
  ['', 'Auto language'],
  ['tr', 'Turkish'],
  ['en', 'English'],
  ['de', 'German'],
  ['fr', 'French'],
  ['es', 'Spanish'],
  ['it', 'Italian'],
  ['pt', 'Portuguese'],
  ['ru', 'Russian'],
  ['ar', 'Arabic'],
  ['nl', 'Dutch'],
  ['ja', 'Japanese'],
];

const PREFS_KEY = 'erdemcut:autoCaptions';

function readPrefs(): { provider?: string; language?: string } {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

function writePrefs(prefs: { provider?: string; language?: string }): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* storage unavailable: preference just isn't remembered */
  }
}

const AutoCaptions = memo(function AutoCaptions({ trackId, onStatus }: { trackId: Id | null; onStatus: (s: Status) => void }) {
  const providers = useTranscriptionProviders();
  const [progress, setProgress] = useState<number | null>(null);
  const [phase, setPhase] = useState('');
  const [prefs, setPrefs] = useState(readPrefs);
  const abortRef = useRef<AbortController | null>(null);
  const provider = providers.find((p) => p.id === prefs.provider) ?? providers[0];
  const language = prefs.language ?? '';
  const updatePrefs = (patch: { provider?: string; language?: string }) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    writePrefs(next);
  };
  const run = async () => {
    if (!provider) return;
    const engine = getEngine();
    const duration = getProjectDuration(S().project);
    if (!engine) return onStatus({ kind: 'error', text: 'The playback engine is not available, so audio cannot be extracted.' });
    if (duration <= 0) return onStatus({ kind: 'error', text: 'The timeline is empty.' });
    const ac = new AbortController();
    abortRef.current = ac;
    setProgress(0);
    setPhase('Extracting audio…');
    try {
      const audio = await engine.mixAudio({ start: 0, end: duration, sampleRate: 16000, channels: 1 });
      const cues = await provider.transcribe(audio, {
        signal: ac.signal,
        language: language || undefined,
        onProgress: (f) => setProgress(f),
        onStatus: setPhase,
      });
      if (cues.length === 0) return onStatus({ kind: 'info', text: 'Auto captions found no speech.' });
      onStatus(describeImport(importCues(cues, { trackId, label: 'Auto captions' })));
    } catch (e) {
      const aborted = e instanceof DOMException && e.name === 'AbortError';
      onStatus({ kind: aborted ? 'info' : 'error', text: aborted ? 'Auto captions cancelled.' : `Auto captions failed: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      abortRef.current = null;
      setProgress(null);
      setPhase('');
    }
  };
  if (progress !== null) {
    return (
      <span className="p3-progress">
        <progress max={1} value={progress} aria-label="Transcription progress" /> {Math.round(progress * 100)}%
        <button type="button" className="btn btn-small" onClick={() => abortRef.current?.abort()}>
          Cancel
        </button>
        {phase && <span className="p3-phase">{phase}</span>}
      </span>
    );
  }
  return (
    <>
      {providers.length > 1 && (
        <select aria-label="Speech-to-text model" value={provider?.id} onChange={(e) => updatePrefs({ provider: e.target.value })}>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      )}
      {provider && (
        <select aria-label="Caption language" value={language} onChange={(e) => updatePrefs({ language: e.target.value })}>
          {CAPTION_LANGUAGES.map(([code, label]) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </select>
      )}
      {/* Wrapper carries the tooltip: disabled buttons do not fire hover events in every browser. */}
      <span title={provider ? `Generate captions with ${provider.label}` : 'Auto captions need a speech-to-text provider, and none is installed in this build.'}>
        <button type="button" className="btn" disabled={!provider} onClick={run}>
          Auto captions
        </button>
      </span>
    </>
  );
});

/** Returns the previous array object while `next` has the same items (shallow). */
function useStableArray<T>(next: T[]): T[] {
  const ref = useRef(next);
  const prev = ref.current;
  if (prev !== next && (prev.length !== next.length || prev.some((x, i) => x !== next[i]))) ref.current = next;
  return ref.current;
}

/** Id of the subtitle cue on `trackId` under `t` (null if none). O(log n): safe in a per-tick selector. */
export function currentCueId(project: Project, trackId: Id | null, t: number): Id | null {
  if (!trackId) return null;
  for (const c of getTrackClipsAt(project, trackId, t)) if (c.type === 'subtitle') return c.id;
  return null;
}

/** Lists with at least this many cues render only the rows near the viewport. */
export const CUE_WINDOW_MIN = 60;
const OVERSCAN_PX = 600;
const DEFAULT_ROW_PX = 76;
/** A focused row stays mounted while it is at most this many rows outside the window. */
const KEEP_FOCUSED_ROWS = 200;

interface CueListProps {
  cues: SubtitleClip[];
  trackId: Id | null;
  locked: boolean;
  selectedIds: Id[];
  onStatus: (s: Status) => void;
  /** The scrolling element containing the list (the panel root). */
  scrollerRef: RefObject<HTMLElement | null>;
}

/**
 * The cue list. Playback only changes the derived current-cue id (re-rendering
 * at most the two affected rows), and long lists are windowed: only rows near
 * the viewport of the scrolling panel are mounted, with measured row heights
 * (estimated until measured) padding the rest. Without layout (jsdom, hidden
 * panel) every row is rendered.
 */
const CueList = memo(function CueList({ cues, trackId, locked, selectedIds, onStatus, scrollerRef }: CueListProps) {
  const currentId = useEditorStore((s) => currentCueId(s.project, trackId, s.currentTime));
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const listRef = useRef<HTMLUListElement>(null);
  const heights = useRef(new Map<Id, number>());
  const [win, setWin] = useState<{ first: number; last: number } | null>(null);
  const [focusedId, setFocusedId] = useState<Id | null>(null);
  const n = cues.length;
  // The parent's ref is not attached yet while our layout effects run on mount: fall back to the list's parent.
  const scroller = useCallback((): HTMLElement | null => scrollerRef.current ?? listRef.current?.parentElement ?? null, [scrollerRef]);

  const offsetsOf = useCallback((): Float64Array => {
    const h = heights.current;
    let sum = 0;
    let cnt = 0;
    for (const v of h.values()) {
      sum += v;
      cnt++;
    }
    const est = cnt ? sum / cnt : DEFAULT_ROW_PX;
    const off = new Float64Array(cues.length + 1);
    for (let i = 0; i < cues.length; i++) off[i + 1] = off[i]! + (h.get(cues[i]!.id) ?? est);
    return off;
  }, [cues]);

  const canWindow = () => {
    const sc = scroller();
    return !!sc && sc.clientHeight > 0 && n >= CUE_WINDOW_MIN;
  };

  const update = useCallback(() => {
    const sc = scroller();
    const list = listRef.current;
    if (!sc || !list || sc.clientHeight <= 0 || cues.length < CUE_WINDOW_MIN) {
      setWin((w) => (w === null ? w : null));
      return;
    }
    const listTop = list.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
    const top = sc.scrollTop - listTop - OVERSCAN_PX;
    const bottom = sc.scrollTop + sc.clientHeight - listTop + OVERSCAN_PX;
    const off = offsetsOf();
    let first = 0;
    while (first < cues.length - 1 && off[first + 1]! < top) first++;
    let last = first;
    while (last < cues.length - 1 && off[last + 1]! < bottom) last++;
    setWin((w) => (w && w.first === first && w.last === last ? w : { first, last }));
  }, [cues, offsetsOf, scroller]);

  // Re-window on scroll / resize (one update per animation frame).
  useEffect(() => {
    const sc = scroller();
    if (!sc) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        update();
      });
    };
    sc.addEventListener('scroll', onScroll, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onScroll) : null;
    ro?.observe(sc);
    return () => {
      sc.removeEventListener('scroll', onScroll);
      ro?.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [scroller, update]);

  // Measure mounted rows; re-window when the list or a measured height changes.
  useLayoutEffect(() => {
    const list = listRef.current;
    let changed = false;
    if (list) {
      let gap: number | null = null;
      for (const el of Array.from(list.children) as HTMLElement[]) {
        const id = el.dataset.cueId;
        if (!id) continue;
        const hh = el.offsetHeight;
        if (!(hh > 0)) continue;
        gap ??= parseFloat(getComputedStyle(el).marginBottom) || 0;
        const v = hh + gap;
        if (Math.abs((heights.current.get(id) ?? -1) - v) > 0.5) {
          heights.current.set(id, v);
          changed = true;
        }
      }
    }
    if (heights.current.size > cues.length * 2 + 64) {
      const live = new Set(cues.map((c) => c.id));
      for (const id of [...heights.current.keys()]) if (!live.has(id)) heights.current.delete(id);
    }
    if (changed || win === null) update();
  });

  // Keep the current cue in view while playing.
  useEffect(() => {
    if (!isPlaying || !currentId) return;
    const list = listRef.current;
    const el = list ? (Array.from(list.children) as HTMLElement[]).find((x) => x.dataset.cueId === currentId) : undefined;
    if (el) {
      el.scrollIntoView?.({ block: 'nearest' });
      return;
    }
    const sc = scroller();
    const i = cues.findIndex((c) => c.id === currentId);
    if (!sc || !list || i < 0) return;
    const off = offsetsOf();
    const listTop = list.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
    const rowTop = listTop + off[i]!;
    const rowBottom = listTop + off[i + 1]!;
    if (rowTop < sc.scrollTop) sc.scrollTop = rowTop;
    else if (rowBottom > sc.scrollTop + sc.clientHeight) sc.scrollTop = rowBottom - sc.clientHeight;
  }, [currentId, isPlaying, cues, offsetsOf, scroller]);

  // Visible range: the measured window, or (before the first measurement of a long
  // list) just the first rows, or everything when the list cannot be windowed.
  let first = 0;
  let last = n - 1;
  const windowed = win !== null || canWindow();
  if (windowed && n > 0) {
    first = Math.min(win?.first ?? 0, n - 1);
    last = Math.min(win?.last ?? 30, n - 1);
    const fi = focusedId ? cues.findIndex((c) => c.id === focusedId) : -1;
    if (fi >= 0 && fi >= first - KEEP_FOCUSED_ROWS && fi <= last + KEEP_FOCUSED_ROWS) {
      first = Math.min(first, fi);
      last = Math.max(last, fi);
    }
  }
  let style: { paddingTop: number; paddingBottom: number } | undefined;
  if (windowed && n > 0) {
    const off = offsetsOf();
    style = { paddingTop: off[first]!, paddingBottom: off[n]! - off[last + 1]! };
  }
  const rows: ReactNode[] = [];
  for (let i = first; i <= last && i < n; i++) {
    const c = cues[i]!;
    rows.push(<CueRow key={c.id} clip={c} index={i} current={c.id === currentId} selected={selected.has(c.id)} locked={locked} onStatus={onStatus} />);
  }
  return (
    <ul
      ref={listRef}
      className="p3-cue-list"
      style={style}
      onFocus={(e) => {
        const id = (e.target as HTMLElement).closest<HTMLElement>('[data-cue-id]')?.dataset.cueId;
        if (id) setFocusedId(id);
      }}
      onBlur={(e) => {
        const next = e.relatedTarget as HTMLElement | null;
        if (!next || !e.currentTarget.contains(next)) setFocusedId(null);
      }}
    >
      {rows}
    </ul>
  );
});

export default function SubtitlesPanel() {
  const project = useEditorStore((s) => s.project);
  const selectedIds = useEditorStore((s) => s.selectedClipIds);
  const tracks = subtitleTracks(project);
  const [trackChoice, setTrackChoice] = useState<Id | null>(null);
  const trackId = tracks.find((t) => t.id === trackChoice)?.id ?? tracks[0]?.id ?? null;
  const track = tracks.find((t) => t.id === trackId);
  // Same array object while no cue of the track changed (edits elsewhere keep the list untouched).
  const cues = useStableArray(useMemo(() => cueClips(project, trackId), [project, trackId]));
  const selectedCues = useMemo(() => {
    const sel = new Set(selectedIds);
    return cues.filter((c) => sel.has(c.id));
  }, [cues, selectedIds]);
  const rootRef = useRef<HTMLDivElement>(null);
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
    <div className="p3-panel p3-subs" ref={rootRef}>
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
          Start selected at playhead, shift following
        </button>
      </Section>

      <Section title="Style (all subtitles)">
        <StyleEditor />
      </Section>

      <div className="p3-cue-list-head muted small">
        {track ? `${track.name}: ${plural(cues.length, 'cue')}` : 'No subtitle track yet — add or import cues.'}
        {track?.locked && ' (locked)'}
      </div>
      <CueList cues={cues} trackId={trackId} locked={!!track?.locked} selectedIds={selectedIds} onStatus={setStatus} scrollerRef={rootRef} />
    </div>
  );
}
