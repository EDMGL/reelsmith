import { useMemo, useRef, useState, type DragEvent } from 'react';
import { formatDuration, Icon, isFileDrag, useEditorStore, type MediaAsset } from '../../core';
import { findTrack } from '../music/catalogue';
import { resolveAssignments } from './builder';
import { builtinTemplates, FEATURED_CATEGORY, filterTemplates, templateCategories } from './catalogue';
import {
  applySelected,
  assignFromLibrary,
  backToGallery,
  clearAllSlots,
  clearSlot,
  clickSlot,
  deleteUserTemplate,
  exportTemplate,
  fillFromLibrary,
  importIntoSlots,
  importTemplateFile,
  moveSlot,
  openTemplate,
  saveTimelineAsTemplate,
  selectedTemplate,
  setApplyOptions,
  setTextValue,
  useTemplatesStore,
  type Message,
} from './templatesStore';
import { TemplatePreview, useNearViewport } from './TemplatePreview';
import type { TemplateAspect, VideoTemplate } from './types';
import { USER_CATEGORY } from './userTemplates';
import './templates.css';

const ASPECTS: TemplateAspect[] = ['9:16', '1:1', '16:9', '4:5'];

function MessageView({ m }: { m: Message | null }) {
  if (!m) return null;
  const cls = m.kind === 'error' ? ' error' : m.kind === 'warning' ? ' warning' : m.kind === 'success' ? ' success' : '';
  return (
    <div className={`status-msg tp-msg${cls}`} role={m.kind === 'error' ? 'alert' : 'status'}>
      <Icon name={m.kind === 'error' || m.kind === 'warning' ? 'alert' : m.kind === 'success' ? 'check' : 'info'} size={14} />
      <div>
        <div>{m.text}</div>
        {m.details && m.details.length > 0 && (
          <ul className="tp-details">
            {m.details.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gallery
// ---------------------------------------------------------------------------

function TemplateCard({ t, user }: { t: VideoTemplate; user: boolean }) {
  const [ref, near] = useNearViewport<HTMLLIElement>();
  const [hover, setHover] = useState(false);
  return (
    <li ref={ref} className="tp-card" onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}>
      <button type="button" className="tp-card-open" onClick={() => openTemplate(t.id)} onFocus={() => setHover(true)} onBlur={() => setHover(false)} aria-label={`Open template ${t.name}`}>
        <div className="tp-card-thumb">{near ? <TemplatePreview template={t} playing={hover} /> : <div className="tp-preview tp-placeholder" />}</div>
        <div className="tp-card-name">{t.name}</div>
        <div className="tp-card-meta">
          <span className="tp-aspect">{t.aspect}</span>
          <span>{formatDuration(t.duration)}</span>
          <span>
            {t.slots.length} slot{t.slots.length === 1 ? '' : 's'}
          </span>
          {t.music && (
            <span title="Includes music" aria-label="Includes music">
              ♫
            </span>
          )}
        </div>
      </button>
      {user && (
        <div className="tp-card-actions">
          <button type="button" className="btn btn-small btn-icon-only" title="Export .json" aria-label={`Export ${t.name}`} onClick={() => exportTemplate(t)}>
            <Icon name="export" size={12} />
          </button>
          <button
            type="button"
            className="btn btn-small btn-icon-only btn-danger"
            title="Delete"
            aria-label={`Delete ${t.name}`}
            onClick={() => {
              if (window.confirm(`Delete the template “${t.name}”?`)) deleteUserTemplate(t.id);
            }}
          >
            <Icon name="trash" size={12} />
          </button>
        </div>
      )}
    </li>
  );
}

function SaveForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState(() => `${useEditorStore.getState().project.name} template`);
  return (
    <form
      className="tp-save-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (saveTimelineAsTemplate(name)) onDone();
      }}
    >
      <label className="tp-field-label" htmlFor="tp-save-name">
        Template name
      </label>
      <input id="tp-save-name" type="text" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} autoFocus />
      <p className="tp-hint">Every video/photo clip becomes a slot (keeping timing, placement, motion and effects); text clips become editable texts.</p>
      <div className="tp-row">
        <button type="submit" className="btn btn-primary btn-small" disabled={!name.trim()}>
          Save
        </button>
        <button type="button" className="btn btn-small" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function Gallery() {
  const query = useTemplatesStore((s) => s.query);
  const category = useTemplatesStore((s) => s.category);
  const aspect = useTemplatesStore((s) => s.aspect);
  const userTemplates = useTemplatesStore((s) => s.userTemplates);
  const message = useTemplatesStore((s) => s.galleryMessage);
  const hasClips = useEditorStore((s) => Object.keys(s.project.clips).length > 0);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const categories = useMemo(() => templateCategories(builtinTemplates()), []);
  const list = useMemo(() => {
    const source = category === USER_CATEGORY ? userTemplates : [...builtinTemplates(), ...userTemplates];
    return filterTemplates(source, { query, category: category === USER_CATEGORY ? null : category, aspect });
  }, [query, category, aspect, userTemplates]);
  const userIds = useMemo(() => new Set(userTemplates.map((t) => t.id)), [userTemplates]);
  const chips = [FEATURED_CATEGORY, USER_CATEGORY, ...categories];

  return (
    <div className="tp-panel">
      <div className="tp-head">
        <h3 className="section-title">Templates</h3>
        <p className="tp-badge">Pick a template, add your photos and videos — cuts, motion, text and music are done for you.</p>
      </div>
      <div className="tp-row">
        <button type="button" className="btn btn-small" disabled={!hasClips} title={hasClips ? 'Save the current timeline as a reusable template' : 'Add clips to the timeline first'} onClick={() => setSaving((v) => !v)}>
          <Icon name="plus" size={14} />
          Save as template
        </button>
        <button type="button" className="btn btn-small" onClick={() => fileRef.current?.click()} title="Import a template .json file">
          <Icon name="upload" size={14} />
          Import
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          data-testid="template-file-input"
          onChange={(e) => {
            void importTemplateFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>
      {saving && <SaveForm onDone={() => setSaving(false)} />}
      <MessageView m={message} />
      <input type="search" className="tp-search" placeholder="Search templates (travel, beat, quote…)" aria-label="Search templates" value={query} onChange={(e) => useTemplatesStore.setState({ query: e.target.value })} />
      <div className="segmented tp-aspects" role="radiogroup" aria-label="Aspect ratio">
        <button type="button" role="radio" aria-checked={aspect === null} className={aspect === null ? 'active' : ''} onClick={() => useTemplatesStore.setState({ aspect: null })}>
          All
        </button>
        {ASPECTS.map((a) => (
          <button key={a} type="button" role="radio" aria-checked={aspect === a} className={aspect === a ? 'active' : ''} onClick={() => useTemplatesStore.setState({ aspect: a })}>
            {a}
          </button>
        ))}
      </div>
      <div className="tp-chips" role="tablist" aria-label="Categories">
        <button type="button" role="tab" aria-selected={category === null} className={`tp-chip${category === null ? ' active' : ''}`} onClick={() => useTemplatesStore.setState({ category: null })}>
          All
        </button>
        {chips.map((c) => (
          <button key={c} type="button" role="tab" aria-selected={category === c} className={`tp-chip${category === c ? ' active' : ''}`} onClick={() => useTemplatesStore.setState({ category: category === c ? null : c })}>
            {c}
            {c === USER_CATEGORY && userTemplates.length > 0 ? ` (${userTemplates.length})` : ''}
          </button>
        ))}
      </div>
      <p className="tp-count muted small" aria-live="polite">
        {list.length} template{list.length === 1 ? '' : 's'}
      </p>
      {list.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon">
            <Icon name="layers" size={20} />
          </span>
          <span className="empty-state-title">{category === USER_CATEGORY && userTemplates.length === 0 ? 'No saved templates yet' : 'Nothing matches'}</span>
          <span className="empty-state-text">
            {category === USER_CATEGORY && userTemplates.length === 0 ? 'Use “Save as template” or import a .json file.' : 'Try another search or clear the filters.'}
          </span>
        </div>
      ) : (
        <ul className="tp-grid" aria-label="Templates">
          {list.map((t) => (
            <TemplateCard key={t.id} t={t} user={userIds.has(t.id)} />
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fill view
// ---------------------------------------------------------------------------

function Thumb({ asset }: { asset: MediaAsset | undefined }) {
  if (!asset) return null;
  if (asset.thumbnail) return <img src={asset.thumbnail} alt="" draggable={false} />;
  return (
    <span className="tp-thumb-icon">
      <Icon name={asset.kind === 'video' ? 'film' : 'image'} size={18} />
    </span>
  );
}

function FillView({ t }: { t: VideoTemplate }) {
  const assignments = useTemplatesStore((s) => s.assignments);
  const texts = useTemplatesStore((s) => s.texts);
  const activeSlot = useTemplatesStore((s) => s.activeSlot);
  const importing = useTemplatesStore((s) => s.importing);
  const applying = useTemplatesStore((s) => s.applying);
  const message = useTemplatesStore((s) => s.message);
  const mode = useTemplatesStore((s) => s.mode);
  const switchAspect = useTemplatesStore((s) => s.switchAspect);
  const project = useEditorStore((s) => s.project);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const timelineEmpty = Object.keys(project.clips).length === 0;
  const resolved = useMemo(() => resolveAssignments(t, assignments, project), [t, assignments, project]);
  const library = useMemo(() => Object.values(project.assets).filter((a) => a.status === 'ready' && (a.kind === 'image' || a.kind === 'video')), [project.assets]);
  const filled = t.slots.filter((s) => assignments[s.id] && project.assets[assignments[s.id]!]).length;
  const music = t.music ? findTrack(t.music.trackId) : undefined;
  const editable = t.texts.filter((x) => x.editable);
  const end = useMemo(() => Math.max(0, ...Object.values(project.clips).map((c) => c.start + c.duration)), [project.clips]);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    void importIntoSlots(e.dataTransfer.files);
  };

  return (
    <div className="tp-panel">
      <div className="tp-fill-head">
        <button type="button" className="btn btn-small btn-ghost" onClick={backToGallery}>
          <Icon name="chevron-left" size={14} />
          All templates
        </button>
      </div>
      <div className="tp-fill-hero">
        <div className="tp-fill-preview">
          <TemplatePreview template={t} playing />
        </div>
        <div className="tp-fill-info">
          <h3 className="tp-fill-title">{t.name}</h3>
          <div className="tp-card-meta">
            <span className="tp-aspect">{t.aspect}</span>
            <span>{formatDuration(t.duration)}</span>
            <span>{t.slots.length} slots</span>
          </div>
          <p className="tp-desc">{t.description}</p>
          {music && (
            <p className="tp-music">
              ♫ {music.name} · {music.bpm} BPM
            </p>
          )}
        </div>
      </div>

      <div
        className={`tp-drop${dragOver ? ' drag-over' : ''}`}
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
        {importing ? (
          <div className="tp-progress" role="status">
            <span className="spinner" aria-hidden />
            Importing {importing.done} / {importing.total}…
            <div className="progress">
              <span style={{ width: `${(importing.done / Math.max(1, importing.total)) * 100}%` }} />
            </div>
          </div>
        ) : (
          <>
            <button type="button" className="btn btn-primary" onClick={() => fileRef.current?.click()}>
              <Icon name="upload" size={14} />
              Add photos &amp; videos
            </button>
            <span className="tp-hint">or drop files here — they fill the slots in order</span>
          </>
        )}
        <input
          ref={fileRef}
          type="file"
          multiple
          accept="video/*,image/*"
          hidden
          data-testid="template-media-input"
          onChange={(e) => {
            void importIntoSlots(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      <div className="tp-section-head">
        <span className="section-title">
          Slots · {filled} / {t.slots.length} filled
        </span>
        {filled > 0 && (
          <button type="button" className="btn btn-small btn-ghost" onClick={clearAllSlots}>
            Clear all
          </button>
        )}
      </div>
      {activeSlot && <p className="tp-hint">Slot {t.slots.findIndex((s) => s.id === activeSlot) + 1} selected: click another slot to swap, or a library item below to replace it.</p>}
      <ol className="tp-slots" aria-label="Slots">
        {t.slots.map((s, i) => {
          const r = resolved[i]!;
          const asset = r.assetId ? project.assets[r.assetId] : undefined;
          const own = !!assignments[s.id] && !!asset;
          return (
            <li key={s.id} className={`tp-slot${activeSlot === s.id ? ' active' : ''}${own ? ' filled' : r.cycled ? ' cycled' : ''}`}>
              <button
                type="button"
                className="tp-slot-main"
                onClick={() => clickSlot(s.id)}
                aria-pressed={activeSlot === s.id}
                aria-label={`Slot ${i + 1}, ${s.duration.toFixed(1)} s${own ? `, ${asset!.name}` : r.cycled ? `, repeats ${asset?.name}` : ', empty'}`}
                title={s.label ?? (s.accepts === 'any' ? 'Photo or video' : s.accepts === 'image' ? 'Photo' : 'Video')}
              >
                <span className="tp-slot-thumb">{(own || r.cycled) && <Thumb asset={asset} />}</span>
                <span className="tp-slot-no">{i + 1}</span>
                <span className="tp-slot-dur">{s.duration.toFixed(1)}s</span>
                {s.accepts !== 'any' && <span className="tp-slot-kind">{s.accepts === 'image' ? 'photo' : 'video'}</span>}
                {!own && r.cycled && <span className="tp-slot-repeat">repeat</span>}
              </button>
              {own && (
                <div className="tp-slot-tools">
                  <button type="button" disabled={i === 0} onClick={() => moveSlot(s.id, -1)} aria-label={`Move slot ${i + 1} media earlier`} title="Move earlier">
                    ‹
                  </button>
                  <button type="button" onClick={() => clearSlot(s.id)} aria-label={`Clear slot ${i + 1}`} title="Clear">
                    ×
                  </button>
                  <button type="button" disabled={i === t.slots.length - 1} onClick={() => moveSlot(s.id, 1)} aria-label={`Move slot ${i + 1} media later`} title="Move later">
                    ›
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {filled > 0 && filled < t.slots.length && <p className="tp-hint">Empty slots repeat your media in order.</p>}

      <div className="tp-section-head">
        <span className="section-title">From your media library</span>
        {library.length > 0 && (
          <button type="button" className="btn btn-small btn-ghost" onClick={fillFromLibrary}>
            Use all
          </button>
        )}
      </div>
      {library.length === 0 ? (
        <p className="tp-hint">Imported photos and videos appear here.</p>
      ) : (
        <ul className="tp-library" aria-label="Media library">
          {library.map((a) => (
            <li key={a.id}>
              <button type="button" className="tp-lib-item" onClick={() => assignFromLibrary(a.id)} title={`Use ${a.name}`} aria-label={`Use ${a.name}`}>
                <Thumb asset={a} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {editable.length > 0 && (
        <>
          <div className="tp-section-head">
            <span className="section-title">Text</span>
          </div>
          <div className="tp-texts">
            {editable.map((x) => (
              <label key={x.id} className="tp-text-field">
                <span className="tp-field-label">{x.label}</span>
                {x.text.includes('\n') || x.text.length > 40 ? (
                  <textarea rows={2} value={texts[x.id] ?? ''} onChange={(e) => setTextValue(x.id, e.target.value)} maxLength={500} />
                ) : (
                  <input type="text" value={texts[x.id] ?? ''} onChange={(e) => setTextValue(x.id, e.target.value)} maxLength={500} placeholder="(leave empty to hide)" />
                )}
              </label>
            ))}
          </div>
        </>
      )}

      <div className="tp-apply">
        {!timelineEmpty && (
          <div className="tp-apply-options">
            <div className="segmented tp-mode" role="radiogroup" aria-label="Where to put the template">
              <button type="button" role="radio" aria-checked={mode === 'append'} className={mode === 'append' ? 'active' : ''} onClick={() => setApplyOptions({ mode: 'append' })}>
                Append at {formatDuration(end)}
              </button>
              <button type="button" role="radio" aria-checked={mode === 'replace'} className={mode === 'replace' ? 'active' : ''} onClick={() => setApplyOptions({ mode: 'replace' })}>
                Replace timeline
              </button>
            </div>
            {mode === 'replace' && <p className="tp-hint tp-warn">Replaces every clip on the timeline (undo brings them back).</p>}
            {project.aspectPreset !== t.aspect && (
              <label className="tp-check">
                <input type="checkbox" checked={switchAspect} onChange={(e) => setApplyOptions({ switchAspect: e.target.checked })} />
                Switch canvas to {t.aspect} (now {project.aspectPreset === 'custom' ? `${project.width}×${project.height}` : project.aspectPreset})
              </label>
            )}
          </div>
        )}
        {timelineEmpty && project.aspectPreset !== t.aspect && <p className="tp-hint">The canvas switches to {t.aspect}.</p>}
        <button type="button" className="btn btn-primary tp-apply-btn" disabled={filled === 0 || !!applying || !!importing} onClick={() => void applySelected()}>
          {applying ? (
            <>
              <span className="spinner" aria-hidden />
              {applying.label}… {Math.round(applying.fraction * 100)} %
            </>
          ) : (
            <>
              <Icon name="check" size={14} />
              Apply template
            </>
          )}
        </button>
        {filled === 0 && <p className="tp-hint">Add at least one photo or video to apply.</p>}
      </div>
      <MessageView m={message} />
    </div>
  );
}

export default function TemplatesPanel() {
  const view = useTemplatesStore((s) => s.view);
  const selectedId = useTemplatesStore((s) => s.selectedId);
  useTemplatesStore((s) => s.userTemplates);
  const t = view === 'fill' && selectedId ? selectedTemplate() : undefined;
  if (t) return <FillView t={t} />;
  return <Gallery />;
}
