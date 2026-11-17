import { useEffect, useRef } from 'react';
import { Icon } from '../core';
import { isTypingTarget } from './shortcuts';

export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const MOD = IS_MAC ? '⌘' : 'Ctrl';
const SHIFT = IS_MAC ? '⇧' : 'Shift';
const ALT = IS_MAC ? '⌥' : 'Alt';

/** One shortcut row: alternatives are separate key combos, each combo a list of keys. */
export interface ShortcutRow {
  action: string;
  keys: string[][];
}

/**
 * Every shortcut the editor supports (mirrors `handleShortcut` in shortcuts.ts,
 * the timeline interactions and the README). Display only.
 */
export const SHORTCUT_GROUPS: { title: string; rows: ShortcutRow[] }[] = [
  {
    title: 'Playback',
    rows: [
      { action: 'Play / pause', keys: [['Space']] },
      { action: 'Previous / next frame', keys: [['←'], ['→']] },
      { action: 'Back / forward 1 second', keys: [[SHIFT, '←'], [SHIFT, '→']] },
      { action: 'Go to start', keys: [['Home']] },
    ],
  },
  {
    title: 'Editing',
    rows: [
      { action: 'Split at playhead', keys: [['S']] },
      { action: 'Delete selection', keys: [['Del'], ['Backspace']] },
      { action: 'Ripple delete (close the gap)', keys: [[SHIFT, 'Del']] },
      { action: 'Duplicate', keys: [[MOD, 'D']] },
      { action: 'Select all clips', keys: [[MOD, 'A']] },
      { action: 'Add to selection', keys: [[SHIFT, 'Click'], [MOD, 'Click']] },
      { action: 'Clear selection / cancel a drag', keys: [['Esc']] },
    ],
  },
  {
    title: 'Clipboard & audio',
    rows: [
      { action: 'Copy', keys: [[MOD, 'C']] },
      { action: 'Cut', keys: [[MOD, 'X']] },
      { action: 'Ripple cut', keys: [[SHIFT, MOD, 'X']] },
      { action: 'Paste at playhead', keys: [[MOD, 'V']] },
      { action: 'Detach / restore audio', keys: [[SHIFT, MOD, 'A'], [ALT, SHIFT, 'A']] },
    ],
  },
  {
    title: 'History',
    rows: [
      { action: 'Undo', keys: [[MOD, 'Z']] },
      { action: 'Redo', keys: [[SHIFT, MOD, 'Z'], [MOD, 'Y']] },
    ],
  },
  {
    title: 'Timeline',
    rows: [
      { action: 'Zoom in / out', keys: [['+'], ['-']] },
      { action: 'Zoom at cursor', keys: [[MOD, 'Scroll']] },
      { action: 'Toggle snapping while dragging', keys: [[ALT]] },
      { action: 'Clip / lane actions menu', keys: [['Right-click']] },
      { action: 'Box select', keys: [['Drag on empty space']] },
    ],
  },
  {
    title: 'Help',
    rows: [{ action: 'Show keyboard shortcuts', keys: [['?']] }],
  },
];

/** Opens/closes the dialog with "?" (never while typing in a field). */
export function useShortcutsHelpKey(toggle: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.key !== '?' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);
}

function Keys({ combo }: { combo: string[] }) {
  return (
    <span className="sc-combo">
      {combo.map((k, i) => (
        <kbd key={i}>{k}</kbd>
      ))}
    </span>
  );
}

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    // Capture: Esc closes the dialog instead of clearing the clip selection.
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog sc-dialog" role="dialog" aria-modal="true" aria-labelledby="sc-title">
        <header className="dialog-head">
          <span className="sc-head-icon" aria-hidden>
            <Icon name="keyboard" size={18} />
          </span>
          <h2 id="sc-title">Keyboard shortcuts</h2>
          <button ref={closeRef} type="button" className="btn btn-ghost btn-icon-only" aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        <div className="dialog-body sc-body">
          {SHORTCUT_GROUPS.map((g) => (
            <section key={g.title} className="sc-group">
              <h3 className="section-title">{g.title}</h3>
              <dl>
                {g.rows.map((r) => (
                  <div key={r.action} className="sc-row">
                    <dt>{r.action}</dt>
                    <dd>
                      {r.keys.map((combo, i) => (
                        <span key={i} className="sc-alt">
                          {i > 0 && <span className="sc-or">or</span>}
                          <Keys combo={combo} />
                        </span>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <footer className="dialog-foot sc-foot">
          <span className="muted small">Shortcuts never fire while you type in a text field.</span>
        </footer>
      </div>
    </div>
  );
}
