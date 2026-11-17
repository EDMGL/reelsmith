import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon, clipContainsTime, ops, useEditorStore, type Id, type IconName } from '../../core';
import { useTimelineUi, type ContextMenuState } from './timelineUi';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
/** Shortcut label, e.g. key('X') -> "⌘X" / "Ctrl+X". */
export const modKey = (k: string, shift = false) => (isMac ? `${shift ? '⇧' : ''}⌘${k}` : `Ctrl+${shift ? 'Shift+' : ''}${k}`);

interface Item {
  label: string;
  hint?: string;
  disabled?: boolean;
  run: () => void;
}

/** Splits the given clips at `time` (those containing it) as one undo step. */
export function splitClipsAt(ids: readonly Id[], time: number): Id[] {
  const s = useEditorStore.getState();
  const out: Id[] = [];
  s.transact('Split', () => {
    for (const id of ids) {
      const c = useEditorStore.getState().project.clips[id];
      if (!c || !clipContainsTime(c, time)) continue;
      const r = useEditorStore.getState().splitClip(id, time);
      if (r) out.push(r);
    }
  });
  return out;
}

function menuItems(menu: ContextMenuState): (Item | 'sep')[] {
  const s = useEditorStore.getState();
  const hasClipboard = !!s.clipboard?.clips.length;
  if (!menu.clipId) {
    return [
      { label: 'Paste here', hint: modKey('V'), disabled: !hasClipboard, run: () => s.pasteClips({ time: menu.time, trackId: menu.trackId }) },
      { label: 'Paste at playhead', disabled: !hasClipboard, run: () => s.pasteClips() },
    ];
  }
  const ids = s.selectedClipIds.includes(menu.clipId) ? s.selectedClipIds : [menu.clipId];
  const p = s.project;
  const editable = ids.some((id) => ops.isClipEditable(p, id));
  const splittable = ids.some((id) => {
    const c = p.clips[id];
    return !!c && ops.isClipEditable(p, id) && clipContainsTime(c, menu.time) && menu.time - c.start > 1 / p.fps;
  });
  const canDetach = ids.some((id) => ops.canDetachAudio(p, p.clips[id]));
  const canRestore = ids.some((id) => ops.canRestoreAudio(p, p.clips[id]));
  const linked = ops.linkedClipIds(p, ids).length > 0;
  const items: (Item | 'sep')[] = [
    { label: 'Cut', hint: modKey('X'), disabled: !editable, run: () => s.cutClips(ids) },
    { label: 'Copy', hint: modKey('C'), run: () => s.copyClips(ids) },
    { label: 'Paste', hint: modKey('V'), disabled: !hasClipboard, run: () => s.pasteClips() },
    { label: 'Duplicate', hint: modKey('D'), disabled: !editable, run: () => s.duplicateClips([...ids]) },
    'sep',
    { label: 'Split here', disabled: !splittable, run: () => splitClipsAt(ids, menu.time) },
    { label: 'Delete', hint: 'Del', disabled: !editable, run: () => s.removeClips([...ids]) },
    { label: 'Ripple delete', hint: '⇧Del', disabled: !editable, run: () => s.rippleDeleteClips([...ids]) },
    'sep',
  ];
  if (canRestore && !canDetach) items.push({ label: 'Restore audio', run: () => s.restoreAudio(ids) });
  else items.push({ label: 'Detach audio', hint: modKey('A', true), disabled: !canDetach, run: () => s.detachAudio(ids) });
  if (canRestore && canDetach) items.push({ label: 'Restore audio', run: () => s.restoreAudio(ids) });
  if (linked) items.push({ label: 'Select linked', run: () => s.selectLinkedClips(ids) });
  return items;
}

/** Presentation only: icon per menu label. */
const MENU_ICONS: Record<string, IconName> = {
  Cut: 'scissors',
  Copy: 'copy',
  Paste: 'paste',
  'Paste here': 'paste',
  'Paste at playhead': 'paste',
  Duplicate: 'duplicate',
  'Split here': 'split',
  Delete: 'trash',
  'Ripple delete': 'ripple-delete',
  'Detach audio': 'unlink',
  'Restore audio': 'link',
  'Select linked': 'link',
};

/** Right-click menu for clips (edit actions) and empty lanes (paste here). */
export function ContextMenu() {
  const menu = useTimelineUi((s) => s.menu);
  const close = useTimelineUi((s) => s.closeMenu);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: Event) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    window.addEventListener('wheel', close, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('wheel', close);
    };
  }, [menu, close]);

  // Keep the menu inside the viewport.
  useLayoutEffect(() => {
    if (!menu) return setPos(null);
    const el = ref.current;
    const w = el?.offsetWidth ?? 0;
    const h = el?.offsetHeight ?? 0;
    setPos({ x: Math.max(4, Math.min(menu.x, window.innerWidth - w - 4)), y: Math.max(4, Math.min(menu.y, window.innerHeight - h - 4)) });
  }, [menu]);

  if (!menu) return null;
  const items = menuItems(menu);
  return (
    <div
      ref={ref}
      className="timeline-menu"
      role="menu"
      aria-label={menu.clipId ? 'Clip actions' : 'Track actions'}
      style={{ left: pos?.x ?? menu.x, top: pos?.y ?? menu.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) =>
        it === 'sep' ? (
          <div key={`sep${i}`} className="timeline-menu-sep" role="separator" />
        ) : (
          <button
            key={it.label}
            type="button"
            role="menuitem"
            className="timeline-menu-item"
            disabled={it.disabled}
            onClick={() => {
              close();
              it.run();
            }}
          >
            <span className="timeline-menu-icon" aria-hidden>
              {MENU_ICONS[it.label] && <Icon name={MENU_ICONS[it.label]!} size={15} />}
            </span>
            <span className="timeline-menu-label">{it.label}</span>
            {it.hint && <span className="timeline-menu-hint">{it.hint}</span>}
          </button>
        ),
      )}
    </div>
  );
}
