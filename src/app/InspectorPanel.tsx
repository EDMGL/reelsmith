import {
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
  type Project,
} from '../core';

function ProjectInfo() {
  const project = useEditorStore((s) => s.project);
  const setBg = useEditorStore((s) => s.setBackgroundColor);
  const setFps = useEditorStore((s) => s.setFps);
  return (
    <div className="inspector-section">
      <h3>Project</h3>
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
      <p className="muted small">Select a clip on the timeline to edit its properties.</p>
    </div>
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
        <ProjectInfo />
      </div>
    );
  }
  const track = project.tracks.find((t) => t.id === clip.trackId)!;
  const matching = sections.filter((d) => d.clipTypes === '*' || d.clipTypes.includes(clip.type));
  const props: InspectorProps = { clip, track, project, targets: [clip.id] };
  return (
    <div className="inspector">
      {matching.length === 0 && <p className="muted small">No inspector for {clip.type} clips.</p>}
      {matching.map((d) => (
        <section key={d.id} className="inspector-section">
          <h3>{d.title}</h3>
          <Slot name={d.id} component={d.component} props={props} />
        </section>
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
        <section key={d.id} className="inspector-section">
          <h3>
            {d.title}
            {targets.length < clips.length && <span className="multi-count"> · {targets.length} of {clips.length}</span>}
          </h3>
          <Slot name={d.id} component={d.component} props={props} />
        </section>
      );
    });
  return (
    <div className="inspector" data-testid="multi-inspector">
      <div className="inspector-section">
        <h3>{clips.length} clips selected</h3>
        <p className="muted small">Changes below apply to all selected clips. You can also move, delete or duplicate them together.</p>
      </div>
      {rendered}
    </div>
  );
}
