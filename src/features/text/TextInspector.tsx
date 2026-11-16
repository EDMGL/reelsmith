import { useEffect, useState } from 'react';
import { useEditorStore, type ClipPatch, type InspectorProps, type TextStyle } from '../../core';
import { TextStyleEditor, useBurstTx } from './controls';
import './text.css';

/** Inspector section for text clips: content + every style control. Transform stays in 'core:transform'. */
export default function TextInspector({ clip, track }: InspectorProps<'text'>) {
  const { touch, end } = useBurstTx('Edit text');
  const [draft, setDraft] = useState(clip.text);
  useEffect(() => setDraft(clip.text), [clip.text, clip.id]);
  if (clip.type !== 'text') return null;
  const update = (patch: ClipPatch) => useEditorStore.getState().updateClip(clip.id, patch);
  return (
    <fieldset className="inspector-fields p3-inspector" disabled={track.locked}>
      {track.locked && <p className="muted small">Track is locked.</p>}
      <textarea
        aria-label="Text content"
        className="p3-textarea"
        rows={3}
        value={draft}
        onBlur={end}
        onChange={(e) => {
          touch();
          setDraft(e.target.value);
          update({ text: e.target.value, name: e.target.value.split('\n')[0]!.slice(0, 40) || 'Text' });
        }}
      />
      <TextStyleEditor style={clip.style} onChange={(style: TextStyle) => update({ style })} />
    </fieldset>
  );
}
