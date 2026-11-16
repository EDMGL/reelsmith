import type { CSSProperties } from 'react';
import { CLIP_TEMPLATE_DRAG_MIME } from '../../core';
import { PLAIN_PRESET, TEXT_PRESETS, addTextAtPlayhead, clipFromPreset, type TextPreset } from './presets';
import './text.css';

/** CSS-only preview of a preset in the panel (the real picture is drawn on canvas by the renderer). */
function previewStyle(p: TextPreset): CSSProperties {
  const s = p.style;
  const css: CSSProperties = {
    fontFamily: s.fontFamily,
    fontWeight: s.fontWeight,
    fontStyle: s.italic ? 'italic' : undefined,
    color: s.color ?? '#ffffff',
  };
  if (s.stroke) css.WebkitTextStroke = `${Math.min(2, s.stroke.width / 4)}px ${s.stroke.color}`;
  if (s.shadow) css.textShadow = `${s.shadow.offsetX / 4}px ${s.shadow.offsetY / 4}px ${s.shadow.blur / 4}px ${s.shadow.color}`;
  if (s.background) {
    css.background = s.background.color;
    css.padding = '2px 6px';
    css.borderRadius = Math.min(8, s.background.radius / 2);
  }
  return css;
}

function PresetCard({ preset }: { preset: TextPreset }) {
  return (
    <li>
      <button
        type="button"
        className="p3-preset"
        draggable
        title={`Add "${preset.label}" at the playhead (or drag it onto the timeline)`}
        aria-label={`Add ${preset.label} text`}
        onClick={() => addTextAtPlayhead(preset)}
        onDragStart={(e) => {
          e.dataTransfer.setData(CLIP_TEMPLATE_DRAG_MIME, JSON.stringify(clipFromPreset(preset)));
          e.dataTransfer.setData('text/plain', preset.text);
          e.dataTransfer.effectAllowed = 'copy';
        }}
      >
        <span className="p3-preset-sample" style={previewStyle(preset)}>
          {preset.label}
        </span>
      </button>
    </li>
  );
}

export default function TextPanel() {
  return (
    <div className="p3-panel">
      <div className="p3-toolbar">
        <button
          type="button"
          className="btn btn-primary"
          draggable
          onClick={() => addTextAtPlayhead(PLAIN_PRESET)}
          onDragStart={(e) => e.dataTransfer.setData(CLIP_TEMPLATE_DRAG_MIME, JSON.stringify(clipFromPreset(PLAIN_PRESET)))}
        >
          + Add text
        </button>
      </div>
      <p className="muted small p3-hint">Click a style to add it at the playhead, or drag it onto a track.</p>
      <ul className="p3-preset-grid">
        {TEXT_PRESETS.map((p) => (
          <PresetCard key={p.id} preset={p} />
        ))}
      </ul>
    </div>
  );
}
