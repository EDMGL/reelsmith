import { useMemo, useRef, type DragEvent } from 'react';
import { CLIP_TEMPLATE_DRAG_MIME, formatDuration, Icon, openPanel, useEditorStore } from '../../core';
import { filterSfx, filterTracks, musicChips, sfxChips, type MusicTrackDef, type SfxDef } from './catalogue';
import { addMusic, addSfx, prepareDrag, previewKey, previewMusic, previewSfx, rerollVariation, seedOf, setOptions, setVariation, useMusicStore, type MusicTab } from './musicStore';
import { usePreviewStore } from './preview';
import { musicDragTemplate, planMusic, sfxDragTemplate, type MusicLength } from './timeline';
import './music.css';

const loopSecondsMemo = new Map<string, number>();
function loopSeconds(def: MusicTrackDef, seed: number): number {
  const k = `${def.id}:${seed}`;
  let s = loopSecondsMemo.get(k);
  if (s === undefined) loopSecondsMemo.set(k, (s = def.compose(seed).loopSeconds));
  return s;
}

function PlayButton({ pkey, onClick, label }: { pkey: string; onClick: () => void; label: string }) {
  const playing = usePreviewStore((s) => s.playingKey === pkey);
  const loading = usePreviewStore((s) => s.loadingKey === pkey);
  const progress = usePreviewStore((s) => (s.loadingKey === pkey ? s.loadProgress : 0));
  return (
    <button
      type="button"
      className={`mu-play${playing ? ' is-playing' : ''}${loading ? ' is-loading' : ''}`}
      onClick={onClick}
      aria-label={playing || loading ? `Stop preview of ${label}` : `Preview ${label}`}
      title={loading ? 'Generating…' : playing ? 'Stop preview' : 'Preview'}
      style={loading ? { ['--p' as string]: `${Math.round(progress * 100)}%` } : undefined}
    >
      {loading ? <span className="mu-spinner" aria-hidden /> : <Icon name={playing ? 'stop' : 'play'} size={14} />}
    </button>
  );
}

function Meter({ pkey }: { pkey: string }) {
  const playing = usePreviewStore((s) => s.playingKey === pkey);
  const level = usePreviewStore((s) => (s.playingKey === pkey ? s.level : 0));
  const pos = usePreviewStore((s) => (s.playingKey === pkey ? s.position : 0));
  if (!playing) return null;
  return (
    <div className="mu-meter" aria-hidden>
      <div className="mu-bars">
        {[0.6, 1, 0.8, 0.5].map((k, i) => (
          <span key={i} style={{ transform: `scaleY(${Math.max(0.12, Math.min(1, level * k * 1.6))})` }} />
        ))}
      </div>
      <div className="mu-progress">
        <div style={{ width: `${pos * 100}%` }} />
      </div>
    </div>
  );
}

function Variations({ def }: { def: { id: string; name: string; variations: { label: string; seed: number }[] } }) {
  const current = useMusicStore((s) => s.seeds[def.id] ?? def.variations[0]!.seed);
  return (
    <div className="mu-vars" role="group" aria-label={`Variation of ${def.name}`}>
      {def.variations.map((v) => (
        <button key={v.seed} type="button" className={`mu-var${v.seed === current ? ' active' : ''}`} aria-pressed={v.seed === current} onClick={() => setVariation(def, v.seed)} title={`Variation ${v.label}`}>
          {v.label}
        </button>
      ))}
      <button type="button" className="mu-var mu-reroll" onClick={() => rerollVariation(def)} title="Reroll: next variation" aria-label={`Reroll ${def.name}`}>
        <Icon name="refresh" size={12} />
      </button>
    </div>
  );
}

function useDrag(item: { kind: 'music'; def: MusicTrackDef } | { kind: 'sfx'; def: SfxDef }) {
  const hover = useRef<ReturnType<typeof setTimeout> | null>(null);
  return {
    draggable: true,
    onPointerEnter: () => {
      hover.current = setTimeout(() => void prepareDrag(item), item.kind === 'sfx' ? 150 : 600);
    },
    onPointerLeave: () => {
      if (hover.current) clearTimeout(hover.current);
    },
    onDragStart: (e: DragEvent) => {
      const st = useMusicStore.getState();
      const seed = seedOf(item.def);
      const tpl = item.kind === 'music' ? musicDragTemplate(item.def, seed, st.options) : sfxDragTemplate(item.def, seed, st.sfxVolume);
      if (!tpl) {
        e.preventDefault();
        void prepareDrag(item);
        useMusicStore.setState({ message: { kind: 'info', text: `Generating “${item.def.name}”… drag again in a moment, or use Add.` } });
        return;
      }
      e.dataTransfer.setData(CLIP_TEMPLATE_DRAG_MIME, JSON.stringify(tpl));
      e.dataTransfer.setData('text/plain', item.def.name);
      e.dataTransfer.effectAllowed = 'copy';
    },
  };
}

function TrackRow({ def }: { def: MusicTrackDef }) {
  const seed = useMusicStore((s) => s.seeds[def.id] ?? def.variations[0]!.seed);
  const adding = useMusicStore((s) => s.adding[def.id]);
  const pkey = previewKey('music', def.id, seed);
  const drag = useDrag({ kind: 'music', def });
  return (
    <li className="mu-item" {...drag}>
      <PlayButton pkey={pkey} label={def.name} onClick={() => void previewMusic(def)} />
      <div className="mu-info">
        <div className="mu-name">{def.name}</div>
        <div className="mu-meta">
          {def.genre} · {def.bpm} BPM · {def.key} · loop {formatDuration(loopSeconds(def, seed))}
        </div>
        <div className="mu-tags">
          {def.moods.map((m) => (
            <span key={m} className="mu-tag">
              {m}
            </span>
          ))}
        </div>
        <Meter pkey={pkey} />
      </div>
      <div className="mu-side">
        <Variations def={def} />
        <button type="button" className="btn btn-small mu-add" disabled={adding !== undefined} onClick={() => void addMusic(def)} title="Add to the timeline">
          {adding !== undefined ? (
            `${Math.round(adding * 100)} %`
          ) : (
            <>
              <Icon name="plus" size={14} />
              Add
            </>
          )}
        </button>
      </div>
    </li>
  );
}

function SfxRow({ def }: { def: SfxDef }) {
  const seed = useMusicStore((s) => s.seeds[def.id] ?? def.variations[0]!.seed);
  const adding = useMusicStore((s) => s.adding[def.id]);
  const pkey = previewKey('sfx', def.id, seed);
  const drag = useDrag({ kind: 'sfx', def });
  return (
    <li className="mu-item mu-sfx" {...drag}>
      <PlayButton pkey={pkey} label={def.name} onClick={() => void previewSfx(def)} />
      <div className="mu-info">
        <div className="mu-name">{def.name}</div>
        <div className="mu-tags">
          <span className="mu-tag mu-cat">{def.category}</span>
          {def.tags.slice(0, 3).map((m) => (
            <span key={m} className="mu-tag">
              {m}
            </span>
          ))}
        </div>
        <Meter pkey={pkey} />
      </div>
      <div className="mu-side">
        <Variations def={def} />
        <button type="button" className="btn btn-small mu-add" disabled={adding !== undefined} onClick={() => void addSfx(def)} title="Add at the playhead">
          {adding !== undefined ? (
            '…'
          ) : (
            <>
              <Icon name="plus" size={14} />
              Add
            </>
          )}
        </button>
      </div>
    </li>
  );
}

const LENGTHS: { value: MusicLength; label: string }[] = [
  { value: 'fit', label: 'Fit project' },
  { value: 15, label: '15 s' },
  { value: 30, label: '30 s' },
  { value: 60, label: '60 s' },
];

function MusicOptions() {
  const o = useMusicStore((s) => s.options);
  const project = useEditorStore((s) => s.project);
  const playhead = useEditorStore((s) => s.currentTime);
  const plan = planMusic(project, playhead, o);
  return (
    <details className="mu-options">
      <summary>
        Add as: {o.length === 'fit' ? 'fit to project' : `${o.length} s`}, from {o.startAt === 'zero' ? '0:00' : 'playhead'}, {Math.round(o.volume * 100)} % volume
      </summary>
      <div className="mu-opt-grid">
        <span>Length</span>
        <div className="segmented mu-seg" role="radiogroup" aria-label="Length">
          {LENGTHS.map((l) => (
            <button key={String(l.value)} type="button" role="radio" aria-checked={o.length === l.value} className={o.length === l.value ? 'active' : ''} onClick={() => setOptions({ length: l.value })}>
              {l.label}
            </button>
          ))}
        </div>
        <span>Start</span>
        <div className="segmented mu-seg" role="radiogroup" aria-label="Start">
          <button type="button" role="radio" aria-checked={o.startAt === 'zero'} className={o.startAt === 'zero' ? 'active' : ''} onClick={() => setOptions({ startAt: 'zero' })}>
            At 0:00
          </button>
          <button type="button" role="radio" aria-checked={o.startAt === 'playhead'} className={o.startAt === 'playhead' ? 'active' : ''} onClick={() => setOptions({ startAt: 'playhead' })}>
            At playhead
          </button>
        </div>
        <label htmlFor="mu-vol">Volume</label>
        <div className="mu-row">
          <input id="mu-vol" type="range" min={0} max={100} value={Math.round(o.volume * 100)} onChange={(e) => setOptions({ volume: Number(e.target.value) / 100 })} />
          <span className="mu-num">{Math.round(o.volume * 100)} %</span>
        </div>
        <span>Fades</span>
        <div className="mu-row">
          <label className="mu-inline">
            in
            <input type="number" min={0} max={10} step={0.1} value={o.fadeIn} onChange={(e) => setOptions({ fadeIn: Math.max(0, Number(e.target.value) || 0) })} />
          </label>
          <label className="mu-inline">
            out
            <input type="number" min={0} max={10} step={0.1} value={o.fadeOut} onChange={(e) => setOptions({ fadeOut: Math.max(0, Number(e.target.value) || 0) })} />
          </label>
          <span className="mu-num">s</span>
        </div>
      </div>
      <p className="mu-hint">
        Next add: {formatDuration(plan.duration)} starting at {formatDuration(plan.start)}
        {o.length === 'fit' ? ' (loops to cover the project, then trimmed)' : ''}.
      </p>
    </details>
  );
}

export default function MusicPanel() {
  const tab = useMusicStore((s) => s.tab);
  const query = useMusicStore((s) => s.query);
  const chip = useMusicStore((s) => s.chip);
  const message = useMusicStore((s) => s.message);
  const previewError = usePreviewStore((s) => s.error);
  const chips = useMemo(() => (tab === 'music' ? musicChips() : sfxChips()), [tab]);
  const tracks = tab === 'music' ? filterTracks(query, chip) : [];
  const effects = tab === 'sfx' ? filterSfx(query, chip) : [];
  const setTab = (t: MusicTab) => useMusicStore.setState({ tab: t, chip: null });

  return (
    <div className="mu-panel">
      <div className="mu-head">
        <h3 className="section-title mu-title">Music &amp; sounds</h3>
        <p className="mu-badge">Built-in, original music and sounds generated right in your browser — free to use in your videos.</p>
      </div>
      <div className="segmented mu-tabs" role="tablist" aria-label="Library">
        <button type="button" role="tab" aria-selected={tab === 'music'} className={tab === 'music' ? 'active' : ''} onClick={() => setTab('music')}>
          Music
        </button>
        <button type="button" role="tab" aria-selected={tab === 'sfx'} className={tab === 'sfx' ? 'active' : ''} onClick={() => setTab('sfx')}>
          Sound effects
        </button>
      </div>
      <input type="text" className="mu-search" placeholder={tab === 'music' ? 'Search music (mood, genre…)' : 'Search sounds'} aria-label="Search" value={query} onChange={(e) => useMusicStore.setState({ query: e.target.value })} />
      <div className="mu-chips" role="group" aria-label="Filter">
        <button type="button" className={`mu-chip${chip === null ? ' active' : ''}`} aria-pressed={chip === null} onClick={() => useMusicStore.setState({ chip: null })}>
          All
        </button>
        {chips.map((c) => (
          <button key={c} type="button" className={`mu-chip${chip === c ? ' active' : ''}`} aria-pressed={chip === c} onClick={() => useMusicStore.setState({ chip: chip === c ? null : c })}>
            {c}
          </button>
        ))}
      </div>
      {tab === 'music' && <MusicOptions />}
      {message && (
        <p className={`status-msg mu-msg${message.kind === 'error' ? ' error' : ''}`} role="status">
          <Icon name={message.kind === 'error' ? 'alert' : 'info'} size={14} />
          {message.text}
        </p>
      )}
      {previewError && (
        <p className="status-msg error mu-msg">
          <Icon name="alert" size={14} />
          {previewError}
        </p>
      )}
      <ul className="mu-list" aria-label={tab === 'music' ? 'Music tracks' : 'Sound effects'}>
        {tab === 'music' && tracks.map((t) => <TrackRow key={t.id} def={t} />)}
        {tab === 'sfx' && effects.map((s) => <SfxRow key={s.id} def={s} />)}
        {(tab === 'music' ? tracks.length : effects.length) === 0 && (
          <li className="empty-state mu-empty">
            <span className="empty-state-icon">
              <Icon name={tab === 'music' ? 'music' : 'waveform'} size={20} />
            </span>
            <span className="empty-state-title">Nothing matches</span>
            <span className="empty-state-text">Try another search or clear the filter.</span>
          </li>
        )}
      </ul>
      <p className="mu-hint">
        {tab === 'music' ? 'Drag a track onto the timeline or press Add. ' : 'Sounds are added at the playhead on a free audio track. '}
        Have your own audio?{' '}
        <button type="button" className="mu-link" onClick={() => openPanel('media')}>
          Import it in the Media tab
        </button>
        .
      </p>
    </div>
  );
}
