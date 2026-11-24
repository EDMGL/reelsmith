import { useEffect, useRef, useState } from 'react';
import { addSoundToTimeline, buildQuery, formatLength, MOODS, soundApi, type AddSoundOptions, type SoundResult } from './findSound';
import './findSound.css';

type Busy = { id: string; what: 'preview' | 'add' } | null;

/** Left panel "Find sound": search → preview → add to a music track. */
export default function FindSoundPanel() {
  const [text, setText] = useState('');
  const [freeOnly, setFreeOnly] = useState(true);
  const [results, setResults] = useState<SoundResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);
  /** 'server' = the local API did not answer (app server stopped or outdated), 'tools' = yt-dlp/ffmpeg missing. */
  const [problem, setProblem] = useState<'server' | 'tools' | null>(null);
  const [opts, setOpts] = useState<AddSoundOptions>({ startAt: 'zero', volume: 0.3 });
  /** MP3 downloads (in flight or done), shared by preview prefetch and Add. */
  const blobs = useRef(new Map<string, Promise<Blob>>());
  const audio = useRef<HTMLAudioElement | null>(null);
  const prepared = useRef(new Set<string>());
  const searchCtl = useRef<AbortController | null>(null);

  useEffect(() => {
    void soundApi.status().then((s) => setProblem(!s ? 'server' : s.ytdlp && s.ffmpeg ? null : 'tools'));
    return () => {
      audio.current?.pause();
      searchCtl.current?.abort();
    };
  }, []);

  const runSearch = async (raw: string) => {
    const q = buildQuery(raw, freeOnly);
    if (!q) return;
    searchCtl.current?.abort();
    const ctl = new AbortController();
    searchCtl.current = ctl;
    setSearching(true);
    setMessage(null);
    try {
      const r = await soundApi.search(q, ctl.signal);
      setResults(r);
      if (r.length === 0) setMessage({ kind: 'info', text: 'Nothing found. Try other words.' });
    } catch (e) {
      if (!ctl.signal.aborted) setMessage({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      if (searchCtl.current === ctl) setSearching(false);
    }
  };

  const getBlob = (r: SoundResult): Promise<Blob> => {
    let p = blobs.current.get(r.id);
    if (!p) {
      p = soundApi.audio(r.id);
      p.catch(() => blobs.current.delete(r.id)); // a failed download may be retried
      blobs.current.set(r.id, p);
    }
    return p;
  };

  const preview = async (r: SoundResult) => {
    if (playing === r.id) {
      audio.current?.pause();
      setPlaying(null);
      return;
    }
    setBusy({ id: r.id, what: 'preview' });
    setMessage(null);
    try {
      // Stream straight away; the MP3 for "Add" downloads meanwhile.
      void getBlob(r).catch(() => undefined);
      audio.current?.pause();
      const el = new Audio(soundApi.streamUrl(r.id));
      el.volume = 0.8;
      el.onended = () => setPlaying((p) => (p === r.id ? null : p));
      audio.current = el;
      await el.play();
      setPlaying(r.id);
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const add = async (r: SoundResult) => {
    setBusy({ id: r.id, what: 'add' });
    setMessage(null);
    try {
      const b = await getBlob(r);
      await addSoundToTimeline(r, b, opts);
      setMessage({ kind: 'info', text: `“${r.title}” added to the timeline. Undo removes it.` });
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="findsound">
      {problem === 'tools' && (
        <p className="fs-note fs-error">
          The sound finder needs <code>yt-dlp</code> and <code>ffmpeg</code> on this computer: <code>brew install yt-dlp ffmpeg</code>, then restart the app.
        </p>
      )}
      {problem === 'server' && (
        <p className="fs-note fs-error">
          The app’s local server is not answering. Close the ErdemCut terminal window and start ErdemCut again from the desktop.
        </p>
      )}
      <form
        className="fs-search"
        onSubmit={(e) => {
          e.preventDefault();
          void runSearch(text);
        }}
      >
        <input type="search" placeholder="Song, artist or mood…" value={text} onChange={(e) => setText(e.target.value)} aria-label="Search sounds" />
        <button type="submit" className="btn btn-small btn-primary" disabled={searching || !text.trim()}>
          {searching ? 'Searching…' : 'Search'}
        </button>
      </form>
      <div className="fs-moods" role="group" aria-label="Quick moods">
        {MOODS.map((m) => (
          <button
            key={m.label}
            type="button"
            className="btn btn-small btn-ghost fs-chip"
            onClick={() => {
              setText(m.query);
              void runSearch(m.query);
            }}
          >
            {m.label}
          </button>
        ))}
      </div>
      <label className="fs-check" title="Adds “no copyright music” to the search, to find tracks made for free use in videos">
        <input type="checkbox" checked={freeOnly} onChange={(e) => setFreeOnly(e.target.checked)} />
        Copyright-free only
      </label>
      <div className="fs-opts">
        <label>
          Start
          <select value={opts.startAt} onChange={(e) => setOpts({ ...opts, startAt: e.target.value as AddSoundOptions['startAt'] })}>
            <option value="zero">at 0:00</option>
            <option value="playhead">at playhead</option>
          </select>
        </label>
        <label>
          Volume {Math.round(opts.volume * 100)}%
          <input type="range" min={0} max={1} step={0.05} value={opts.volume} onChange={(e) => setOpts({ ...opts, volume: Number(e.target.value) })} />
        </label>
      </div>
      {message && (
        <p role="status" className={`fs-note${message.kind === 'error' ? ' fs-error' : ''}`}>
          {message.text}
        </p>
      )}
      <ul className="fs-results">
        {results.map((r) => {
          const b = busy?.id === r.id ? busy.what : null;
          return (
            <li
              key={r.id}
              className="fs-item"
              onPointerEnter={() => {
                if (prepared.current.has(r.id)) return;
                prepared.current.add(r.id);
                soundApi.prepare(r.id);
              }}
            >
              {r.thumbnail ? <img src={r.thumbnail} alt="" loading="lazy" /> : <span className="fs-thumb" />}
              <div className="fs-meta">
                <span className="fs-title" title={r.title}>
                  {r.title}
                </span>
                <span className="fs-sub">
                  {r.channel}
                  {r.duration !== null && ` · ${formatLength(r.duration)}`}
                </span>
              </div>
              <div className="fs-actions">
                <button type="button" className="btn btn-small btn-ghost" disabled={!!busy} onClick={() => void preview(r)} aria-label={`Preview ${r.title}`}>
                  {b === 'preview' ? '…' : playing === r.id ? '■' : '▶'}
                </button>
                <button type="button" className="btn btn-small" disabled={!!busy} onClick={() => void add(r)} aria-label={`Add ${r.title}`}>
                  {b === 'add' ? 'Adding…' : '+ Add'}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {results.length === 0 && !message && (
        <p className="fs-note">Search for a song or pick a mood. The audio is downloaded as MP3 and added to a music track.</p>
      )}
      <p className="fs-note fs-dim">Only use music you have the rights to. Copyrighted songs can get your video muted or taken down.</p>
    </div>
  );
}
