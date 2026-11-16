import { useEffect } from 'react';
import { useEditorStore } from '../core';

/** True when the key event targets a text field (shortcuts must not fire there). */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type;
    return !['button', 'checkbox', 'radio', 'range', 'color', 'submit', 'reset'].includes(type);
  }
  return false;
}

const ZOOM_STEP = 1.25;

/**
 * Global keyboard shortcuts:
 * Space play/pause · S split at playhead · Del/Backspace delete · Shift+Del ripple delete ·
 * Cmd/Ctrl+Z undo · Shift+Cmd/Ctrl+Z or Cmd/Ctrl+Y redo · Cmd/Ctrl+D duplicate · Cmd/Ctrl+A select all ·
 * ←/→ one frame (Shift: one second) · Home/End · +/- zoom · Esc clear selection.
 */
export function handleShortcut(e: KeyboardEvent): boolean {
  if (isTypingTarget(e.target)) return false;
  const s = useEditorStore.getState();
  const mod = e.metaKey || e.ctrlKey;
  const key = e.key;
  if (mod && key.toLowerCase() === 'z') {
    if (e.shiftKey) s.redo();
    else s.undo();
    return true;
  }
  if (mod && key.toLowerCase() === 'y') {
    s.redo();
    return true;
  }
  if (mod && key.toLowerCase() === 'a') {
    s.selectClips(Object.values(s.project.clips).sort((a, b) => a.start - b.start).map((c) => c.id));
    return true;
  }
  if (mod && key.toLowerCase() === 'd') {
    if (s.selectedClipIds.length) s.duplicateClips(s.selectedClipIds);
    return true;
  }
  if (mod || e.altKey) return false;
  switch (key) {
    case ' ':
      s.togglePlay();
      return true;
    case 's':
    case 'S':
      s.splitAtPlayhead();
      return true;
    case 'Delete':
    case 'Backspace':
      if (s.selectedClipIds.length === 0) return false;
      if (e.shiftKey) s.rippleDeleteClips(s.selectedClipIds);
      else s.removeClips(s.selectedClipIds);
      return true;
    case 'ArrowLeft':
    case 'ArrowRight': {
      const step = e.shiftKey ? 1 : 1 / s.project.fps;
      const dir = key === 'ArrowLeft' ? -1 : 1;
      // Quantize to frames so repeated nudges stay on frame boundaries.
      const frame = Math.round(s.currentTime * s.project.fps) / s.project.fps;
      s.setCurrentTime(frame + dir * step);
      return true;
    }
    case 'Home':
      s.setCurrentTime(0);
      return true;
    case '+':
    case '=':
      s.setZoom(s.zoom * ZOOM_STEP);
      return true;
    case '-':
    case '_':
      s.setZoom(s.zoom / ZOOM_STEP);
      return true;
    case 'Escape':
      s.clearSelection();
      return true;
    default:
      return false;
  }
}

export function useGlobalShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (handleShortcut(e)) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
