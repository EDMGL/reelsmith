import { useState, type ReactNode } from 'react';
import {
  Icon,
  Slot,
  formatDuration,
  getProjectDuration,
  inspectorRegistry,
  selectSingleSelectedClip,
  useEditorStore,
  useRegistry,
  type Clip,
  type Id,
  type InspectorDefinition,
  type InspectorProps,
  type IconName,
  type Project,
} from '../core';

const COLLAPSE_KEY = 'erdemcut:inspector-collapsed';

function loadCollapsed(): Set<string> {
  try {
    const v: unknown = JSON.parse(window.localStorage.getItem(COLLAPSE_KEY) ?? '[]');
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}
/** Shared across sections so every section reads the same remembered state. */
const collapsed = loadCollapsed();

/** Inspector card with a clickable header that collapses its body (remembered per section id). */
export function InspectorSection({ id, title, extra, children }: { id: string; title: ReactNode; extra?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(() => !collapsed.has(id));
  const toggle = () => {
    const next = !open;
    if (next) collapsed.delete(id);
    else collapsed.add(id);
    try {
      window.localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...collapsed]));
    } catch {
      /* not remembered */
    }
    setOpen(next);
  };
  const bodyId = `insp-body-${id.replace(/[^a-z0-9_-]/gi, '-')}`;
  return (
    <section className={open ? 'inspector-section' : 'inspector-section collapsed'}>
      <h3 className="inspector-section-head">
        <button type="button" className="inspector-toggle" aria-expanded={open} aria-controls={bodyId} onClick={toggle}>
          <Icon name="chevron-right" size={14} className="inspector-chevron" />
          <span className="inspector-title">{title}</span>
          {extra}
        </button>
      </h3>
      {open && (
        <div className="inspector-body" id={bodyId}>
          {children}
        </div>
      )}
    </section>
  );
}

const TYPE_META: Record<Clip['type'], { label: string; icon: IconName }> = {
  video: { label: 'Video clip', icon: 'film' },
  audio: { label: 'Audio clip', icon: 'waveform' },
  image: { label: 'Image clip', icon: 'image' },
  text: { label: 'Text clip', icon: 'text' },
  subtitle: { label: 'Subtitle', icon: 'subtitles' },
};

function InspectorHeader({ icon, kind, title, typeClass }: { icon: IconName; kind: string; title: string; typeClass?: string }) {
  return (
    <div className="inspector-header">
      <span className={`inspector-type-icon${typeClass ? ` ${typeClass}` : ''}`} aria-hidden>
        <Icon name={icon} size={16} />
      </span>
      <div className="inspector-header-text">
        <span className="inspector-kind">{kind}</span>
        <span className="inspector-name" title={title}>
          {title}
        </span>
      </div>
    </div>
  );
}

function ProjectInfo() {
  const project = useEditorStore((s) => s.project);
  const setBg = useEditorStore((s) => s.setBackgroundColor);
  const setFps = useEditorStore((s) => s.setFps);
  return (
    <>
    <InspectorSection id="shell:project" title="Project">
      <dl className="kv">
        <dt>Canvas</dt>
        <dd>
          {project.width} × {project.height}
        </dd>
        <dt>Duration</dt>
        <dd>{formatDuration(getProjectDuration(project))}</dd>
        <dt>Clips</dt>
        <dd>{Object.keys(project.clips).length}</dd>
        <dt>
          <label htmlFor="proj-fps">Frame rate</label>
        </dt>
        <dd>
          <select id="proj-fps" value={project.fps} onChange={(e) => setFps(Number(e.target.value))}>
            {[24, 25, 30, 50, 60].map((f) => (
              <option key={f} value={f}>
                {f} fps
              </option>
            ))}
            {![24, 25, 30, 50, 60].includes(project.fps) && <option value={project.fps}>{project.fps} fps</option>}
          </select>
        </dd>
        <dt>
          <label htmlFor="proj-bg">Background</label>
        </dt>
        <dd>
          <input id="proj-bg" type="color" value={project.backgroundColor} onChange={(e) => setBg(e.target.value)} />
        </dd>
      </dl>
    </InspectorSection>
    <div className="empty-state inspector-empty">
      <span className="empty-state-icon" aria-hidden>
        <Icon name="pointer" size={20} />
      </span>
      <span className="empty-state-title">Nothing selected</span>
      <span className="empty-state-text">Select a clip on the timeline to edit its properties.</span>
    </div>
    </>
  );
}

/** Right panel: stacked inspector sections registered for the selected clip's type. */
export function InspectorPanel() {
  const clip = useEditorStore(selectSingleSelectedClip);
  const selectedIds = useEditorStore((s) => s.selectedClipIds);
  const project = useEditorStore((s) => s.project);
  const sections = useRegistry(inspectorRegistry);
  if (!clip) {
    if (selectedIds.length > 1) return <MultiInspector ids={selectedIds} project={project} sections={sections} />;
    return (
      <div className="inspector">
        <InspectorHeader icon="sliders" kind="Project settings" title={project.name} />
        <ProjectInfo />
      </div>
    );
  }
  const track = project.tracks.find((t) => t.id === clip.trackId)!;
  const matching = sections.filter((d) => d.clipTypes === '*' || d.clipTypes.includes(clip.type));
  const props: InspectorProps = { clip, track, project, targets: [clip.id] };
  return (
    <div className="inspector">
      <InspectorHeader icon={TYPE_META[clip.type].icon} kind={TYPE_META[clip.type].label} title={clip.name} typeClass={`type-${clip.type}`} />
      {matching.length === 0 && <p className="muted small inspector-note">No inspector for {clip.type} clips.</p>}
      {matching.map((d) => (
        <InspectorSection key={d.id} id={d.id} title={d.title ?? d.id}>
          <Slot name={d.id} component={d.component} props={props} />
        </InspectorSection>
      ))}
    </div>
  );
}

/**
 * Several clips selected: sections registered with `multi: true` are shown for
 * the clips they apply to (the first such clip provides the displayed values);
 * edits apply to every one of them.
 */
function MultiInspector({ ids, project, sections }: { ids: readonly Id[]; project: Project; sections: readonly InspectorDefinition[] }) {
  const clips = ids.map((id) => project.clips[id]).filter((c): c is Clip => !!c);
  const rendered = sections
    .filter((d) => d.multi)
    .map((d) => {
      const targets = clips.filter((c) => d.clipTypes === '*' || d.clipTypes.includes(c.type));
      const anchor = targets[0];
      if (!anchor) return null;
      const track = project.tracks.find((t) => t.id === anchor.trackId);
      if (!track) return null;
      const props: InspectorProps = { clip: anchor, track, project, targets: targets.map((c) => c.id) };
      return (
        <InspectorSection
          key={d.id}
          id={d.id}
          title={d.title ?? d.id}
          extra={targets.length < clips.length && <span className="multi-count"> · {targets.length} of {clips.length}</span>}
        >
          <Slot name={d.id} component={d.component} props={props} />
        </InspectorSection>
      );
    });
  return (
    <div className="inspector" data-testid="multi-inspector">
      <div className="inspector-header">
        <span className="inspector-type-icon" aria-hidden>
          <Icon name="layers" size={16} />
        </span>
        <div className="inspector-header-text">
          <h3 className="inspector-name">{clips.length} clips selected</h3>
          <span className="inspector-kind">Changes apply to every selected clip; move, delete or duplicate them together.</span>
        </div>
      </div>
      {rendered}
    </div>
  );
}
