import { useEffect, useState } from 'react';
import {
  MAX_SPEED,
  MAX_VOLUME,
  MIN_SPEED,
  formatTimecode,
  inspectorTargets,
  isMediaClip,
  isVisualClip,
  ops,
  useEditorStore,
  type ClipPatch,
  type InspectorProps,
  type Transform,
} from '../../core';

/** Numeric input that commits on blur / Enter (one undo step per commit). */
export function NumberField({
  label,
  value,
  onCommit,
  step = 0.1,
  min,
  max,
  suffix,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
}) {
  const [draft, setDraft] = useState(String(round(value)));
  useEffect(() => setDraft(String(round(value))), [value]);
  const commit = () => {
    const v = Number(draft);
    if (Number.isFinite(v) && v !== round(value)) onCommit(v);
    else setDraft(String(round(value)));
  };
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="field-input">
        <input
          type="number"
          value={draft}
          step={step}
          min={min}
          max={max}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        {suffix && <span className="muted small">{suffix}</span>}
      </span>
    </label>
  );
}

/** Range slider; a whole drag is one undo step (transaction). */
export function RangeField({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  const begin = () => useEditorStore.getState().beginTransaction(label);
  const end = () => useEditorStore.getState().commitTransaction();
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="field-input">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onPointerDown={begin}
          onPointerUp={end}
          onPointerCancel={end}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span className="muted small range-value">{format ? format(value) : round(value)}</span>
      </span>
    </label>
  );
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** "Detach audio" / "Restore audio" buttons for the given clips (one undo step each). */
function DetachAudioControls({ ids, project }: { ids: readonly string[]; project: InspectorProps['project'] }) {
  const S = useEditorStore.getState;
  const detachable = ids.filter((id) => ops.canDetachAudio(project, project.clips[id]));
  const restorable = ids.filter((id) => ops.canRestoreAudio(project, project.clips[id]));
  const linked = ops.linkedClipIds(project, ids);
  if (!detachable.length && !restorable.length && !linked.length) return null;
  const n = (k: number) => (ids.length > 1 ? ` (${k})` : '');
  return (
    <div className="field-row" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {detachable.length > 0 && (
        <button type="button" className="btn btn-small" onClick={() => S().detachAudio(detachable)} title="Move the audio to its own clip on an audio track">
          Detach audio{n(detachable.length)}
        </button>
      )}
      {restorable.length > 0 && (
        <button type="button" className="btn btn-small" onClick={() => S().restoreAudio(restorable)} title="Remove the detached audio clip and unmute the video">
          Restore audio{n(restorable.length)}
        </button>
      )}
      {linked.length > 0 && (
        <button type="button" className="btn btn-small" onClick={() => S().selectLinkedClips(ids)} title="Also select the linked video/audio clip">
          Select linked
        </button>
      )}
    </div>
  );
}

/**
 * Several clips: only the settings that make sense for all of them at once
 * (volume, fades). Timing stays per clip.
 */
function MultiClipInspector({ clip, project, targets }: InspectorProps & { targets: readonly string[] }) {
  const S = useEditorStore.getState;
  // Detached video clips stay silent (their sound lives in the detached audio clip).
  const media = targets.map((id) => project.clips[id]).filter((c) => c && isMediaClip(c) && !(c.type === 'video' && c.audioDetached));
  const firstMedia = media[0];
  return (
    <fieldset className="inspector-fields">
      {firstMedia && isMediaClip(firstMedia) && (
        <RangeField
          label="Volume"
          value={firstMedia.volume}
          min={0}
          max={MAX_VOLUME}
          step={0.01}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(volume) => S().updateClips(media.map((c) => c!.id), { volume }, 'Volume')}
        />
      )}
      <DetachAudioControls ids={targets} project={project} />
      <NumberField label="Fade in" value={clip.fadeIn} min={0} step={0.05} suffix="s" onCommit={(fadeIn) => S().updateClips(targets, { fadeIn }, 'Fade in')} />
      <NumberField label="Fade out" value={clip.fadeOut} min={0} step={0.05} suffix="s" onCommit={(fadeOut) => S().updateClips(targets, { fadeOut }, 'Fade out')} />
      <p className="muted small">Tip: a 0.05 s fade in/out on every piece softens clicks at silence cuts. Start, duration and speed are edited per clip.</p>
    </fieldset>
  );
}

/** Core "Clip" section: name, timing, speed, volume, fades. Applies to every clip type. */
export function ClipInspector(props: InspectorProps) {
  const targets = inspectorTargets(props);
  if (targets.length > 1) return <MultiClipInspector {...props} targets={targets} />;
  const { clip, track, project } = props;
  const update = (patch: ClipPatch) => useEditorStore.getState().updateClip(clip.id, patch);
  const locked = track.locked;
  return (
    <fieldset className="inspector-fields" disabled={locked}>
      {locked && <p className="muted small">Track is locked.</p>}
      <label className="field">
        <span className="field-label">Name</span>
        <input
          type="text"
          defaultValue={clip.name}
          key={clip.id + clip.name}
          onBlur={(e) => e.target.value !== clip.name && update({ name: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </label>
      <NumberField label="Start" value={clip.start} min={0} suffix="s" onCommit={(v) => update({ start: Math.max(0, v) })} />
      <NumberField label="Duration" value={clip.duration} min={0.01} suffix="s" onCommit={(v) => update({ duration: Math.max(1 / project.fps, v) })} />
      <p className="muted small mono">
        {formatTimecode(clip.start, project.fps)} → {formatTimecode(clip.start + clip.duration, project.fps)}
      </p>
      {isMediaClip(clip) && (
        <>
          <NumberField label="Speed" value={clip.speed} step={0.05} min={MIN_SPEED} max={MAX_SPEED} suffix="×" onCommit={(v) => update({ speed: v })} />
          {clip.type === 'video' && clip.audioDetached ? (
            <p className="muted small">Audio detached — the video clip is silent; its sound is a separate audio clip.</p>
          ) : (
            <RangeField label="Volume" value={clip.volume} min={0} max={MAX_VOLUME} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => update({ volume: v })} />
          )}
          <DetachAudioControls ids={[clip.id]} project={project} />
          <p className="muted small">
            Source {round(clip.sourceIn)}s – {round(clip.sourceOut)}s
          </p>
        </>
      )}
      <NumberField label="Fade in" value={clip.fadeIn} min={0} step={0.1} suffix="s" onCommit={(v) => update({ fadeIn: v })} />
      <NumberField label="Fade out" value={clip.fadeOut} min={0} step={0.1} suffix="s" onCommit={(v) => update({ fadeOut: v })} />
    </fieldset>
  );
}

/**
 * Basic numeric transform editor for visual clips (id 'core:transform').
 * Feature packages may replace it by registering an inspector with the same id.
 */
export function TransformInspector(props: InspectorProps<'video' | 'image' | 'text'>) {
  const { clip, track } = props;
  if (!isVisualClip(clip)) return null;
  const tf = clip.transform;
  const targets = inspectorTargets(props);
  // Only the changed fields are written, so clips keep their other transform values.
  const set = (patch: Partial<Transform>) =>
    useEditorStore.getState().updateClips(targets, (c) => (isVisualClip(c) ? ({ transform: { ...c.transform, ...patch } } as ClipPatch) : null), 'Transform');
  return (
    <fieldset className="inspector-fields" disabled={track.locked}>
      <RangeField label="Position X" value={tf.x} min={-0.5} max={1.5} step={0.001} format={(v) => `${Math.round(v * 100)}%`} onChange={(x) => set({ x })} />
      <RangeField label="Position Y" value={tf.y} min={-0.5} max={1.5} step={0.001} format={(v) => `${Math.round(v * 100)}%`} onChange={(y) => set({ y })} />
      <RangeField label="Scale" value={tf.scale} min={0.05} max={5} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(scale) => set({ scale })} />
      <RangeField label="Rotation" value={tf.rotation} min={-180} max={180} step={1} format={(v) => `${Math.round(v)}°`} onChange={(rotation) => set({ rotation })} />
      <RangeField label="Opacity" value={tf.opacity} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(opacity) => set({ opacity })} />
      <button type="button" className="btn btn-small" onClick={() => set({ x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 })}>
        Reset transform
      </button>
    </fieldset>
  );
}
