import { useEffect, useRef, useState } from 'react';
import { ASPECT_PRESETS, useEditorStore } from '../core';
import { ToolbarActions } from './ToolbarActions';

function ProjectName() {
  const name = useEditorStore((s) => s.project.name);
  const setName = useEditorStore((s) => s.setProjectName);
  const [draft, setDraft] = useState(name);
  useEffect(() => setDraft(name), [name]);
  const commit = () => {
    const v = draft.trim();
    if (v && v !== name) setName(v);
    else setDraft(name);
  };
  return (
    <input
      className="project-name"
      aria-label="Project name"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setDraft(name);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

function AspectIcon({ w, h }: { w: number; h: number }) {
  const s = 14 / Math.max(w, h);
  return <span className="aspect-icon" style={{ width: Math.max(4, w * s), height: Math.max(4, h * s) }} />;
}

export function AspectSelector() {
  const { width, height, aspectPreset } = useEditorStore((s) => s.project);
  const setPreset = useEditorStore((s) => s.setAspectPreset);
  const setSize = useEditorStore((s) => s.setCanvasSize);
  const [open, setOpen] = useState(false);
  const [cw, setCw] = useState(String(width));
  const [ch, setCh] = useState(String(height));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCw(String(width));
    setCh(String(height));
  }, [width, height]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);

  return (
    <div className="aspect-selector" ref={ref}>
      <button type="button" className="btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <AspectIcon w={width} h={height} />
        {aspectPreset === 'custom' ? 'Custom' : aspectPreset}
        <span className="muted">
          {width}×{height}
        </span>
      </button>
      {open && (
        <div className="popover aspect-menu" role="menu">
          {ASPECT_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="menuitemradio"
              aria-checked={aspectPreset === p.id}
              className={aspectPreset === p.id ? 'menu-item active' : 'menu-item'}
              onClick={() => {
                setPreset(p.id);
                setOpen(false);
              }}
            >
              <AspectIcon w={p.width} h={p.height} />
              <span className="menu-label">{p.label}</span>
              <span className="muted">{p.hint}</span>
            </button>
          ))}
          <form
            className="custom-size"
            onSubmit={(e) => {
              e.preventDefault();
              const w = Number(cw);
              const h = Number(ch);
              if (w > 0 && h > 0) {
                setSize(w, h);
                setOpen(false);
              }
            }}
          >
            <span className="menu-label">Custom</span>
            <input aria-label="Custom width" type="number" min={16} max={7680} value={cw} onChange={(e) => setCw(e.target.value)} />
            <span className="muted">×</span>
            <input aria-label="Custom height" type="number" min={16} max={7680} value={ch} onChange={(e) => setCh(e.target.value)} />
            <button type="submit" className="btn btn-small">
              Apply
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

export function TopBar() {
  const canUndo = useEditorStore((s) => s.past.length > 0);
  const canRedo = useEditorStore((s) => s.future.length > 0);
  const undoLabel = useEditorStore((s) => s.past[s.past.length - 1]?.label);
  const redoLabel = useEditorStore((s) => s.future[s.future.length - 1]?.label);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  return (
    <header className="topbar">
      <div className="brand" aria-label="Erdemcut">
        <span className="brand-mark" aria-hidden>
          ◆
        </span>
        Erdemcut
      </div>
      <ProjectName />
      <div className="topbar-group">
        <button type="button" className="btn btn-icon-only" disabled={!canUndo} onClick={undo} title={undoLabel ? `Undo ${undoLabel} (⌘Z)` : 'Undo (⌘Z)'} aria-label="Undo">
          ↶
        </button>
        <button type="button" className="btn btn-icon-only" disabled={!canRedo} onClick={redo} title={redoLabel ? `Redo ${redoLabel} (⇧⌘Z)` : 'Redo (⇧⌘Z)'} aria-label="Redo">
          ↷
        </button>
      </div>
      <AspectSelector />
      <div className="topbar-spacer" />
      <ToolbarActions location="topbar" />
    </header>
  );
}
