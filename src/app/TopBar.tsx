import { useEffect, useRef, useState } from 'react';
import { ASPECT_PRESETS, Icon, useEditorStore } from '../core';
import { IS_MAC } from './ShortcutsDialog';
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
      <button type="button" className="btn btn-ghost aspect-button" title="Canvas size" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <AspectIcon w={width} h={height} />
        <span className="aspect-name">{aspectPreset === 'custom' ? 'Custom' : aspectPreset}</span>
        <span className="muted aspect-size">
          {width}×{height}
        </span>
        <Icon name="chevron-down" size={14} className="aspect-chevron" />
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

const UNDO_KEY = IS_MAC ? '⌘Z' : 'Ctrl+Z';
const REDO_KEY = IS_MAC ? '⇧⌘Z' : 'Ctrl+Shift+Z';

interface TopBarProps {
  onShowShortcuts?: () => void;
  inspectorHidden?: boolean;
  onToggleInspector?: () => void;
}

export function TopBar({ onShowShortcuts, inspectorHidden = false, onToggleInspector }: TopBarProps = {}) {
  const canUndo = useEditorStore((s) => s.past.length > 0);
  const canRedo = useEditorStore((s) => s.future.length > 0);
  const undoLabel = useEditorStore((s) => s.past[s.past.length - 1]?.label);
  const redoLabel = useEditorStore((s) => s.future[s.future.length - 1]?.label);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="brand" aria-label="Erdemcut">
          <span className="brand-mark" aria-hidden>
            <svg viewBox="0 0 16 16" fill="none">
              <path d="M5 3.2v9.6L12.6 8z" fill="#fff" />
              <path d="M2.5 5.5h2M2.5 10.5h2" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" opacity="0.75" />
            </svg>
          </span>
          <span className="brand-name">Erdemcut</span>
        </div>
        <span className="topbar-divider" aria-hidden />
        <ProjectName />
        <div className="topbar-group" role="group" aria-label="History">
          <button
            type="button"
            className="btn btn-ghost btn-icon-only"
            disabled={!canUndo}
            onClick={undo}
            title={undoLabel ? `Undo ${undoLabel} (${UNDO_KEY})` : `Undo (${UNDO_KEY})`}
            aria-label="Undo"
          >
            <Icon name="undo" size={18} />
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-icon-only"
            disabled={!canRedo}
            onClick={redo}
            title={redoLabel ? `Redo ${redoLabel} (${REDO_KEY})` : `Redo (${REDO_KEY})`}
            aria-label="Redo"
          >
            <Icon name="redo" size={18} />
          </button>
        </div>
      </div>
      <div className="topbar-center">
        <AspectSelector />
      </div>
      <div className="topbar-right">
        {onShowShortcuts && (
          <button type="button" className="btn btn-ghost btn-icon-only" onClick={onShowShortcuts} title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">
            <Icon name="keyboard" size={18} />
          </button>
        )}
        {onToggleInspector && (
          <button
            type="button"
            className={`btn btn-ghost btn-icon-only${inspectorHidden ? '' : ' is-on'}`}
            onClick={onToggleInspector}
            title={inspectorHidden ? 'Show inspector' : 'Hide inspector'}
            aria-label={inspectorHidden ? 'Show inspector' : 'Hide inspector'}
            aria-pressed={!inspectorHidden}
          >
            <Icon name="panel-right" size={18} />
          </button>
        )}
        <span className="topbar-divider" aria-hidden />
        <ToolbarActions location="topbar" />
      </div>
    </header>
  );
}
