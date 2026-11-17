import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore, type VideoClip } from '../../../core';
import { makeProject, videoClip, withClips } from '../../../core/__tests__/fixtures';
import { handleShortcut } from '../../../app/shortcuts';

const S = () => useEditorStore.getState();
const key = (k: string, opts: KeyboardEventInit = {}, target?: EventTarget) => {
  const e = new KeyboardEvent('keydown', { key: k, code: k.length === 1 ? `Key${k.toUpperCase()}` : k, bubbles: true, ...opts });
  if (target) Object.defineProperty(e, 'target', { value: target });
  return handleShortcut(e);
};

beforeEach(() => {
  const { project, v } = makeProject();
  S().loadProject(withClips(project, videoClip(project, 'a', v, 0, 0, 2), videoClip(project, 'b', v, 3, 0, 2)));
  useEditorStore.setState({ clipboard: null });
  window.getSelection()?.removeAllRanges();
});

describe('clipboard shortcuts', () => {
  it('Cmd/Ctrl+C copies, Cmd/Ctrl+V pastes at the playhead', () => {
    S().selectClips(['b']);
    expect(key('c', { metaKey: true })).toBe(true);
    S().setCurrentTime(10);
    expect(key('v', { ctrlKey: true })).toBe(true);
    const id = S().selectedClipIds[0]!;
    expect(id).not.toBe('b');
    expect(S().project.clips[id]!.start).toBe(10);
  });

  it('Cmd/Ctrl+X cuts; Shift+Cmd/Ctrl+X ripple-cuts', () => {
    S().selectClips(['a']);
    key('x', { metaKey: true });
    expect(S().project.clips.a).toBeUndefined();
    expect(S().project.clips.b!.start).toBe(3);
    S().undo();
    S().selectClips(['a']);
    key('X', { metaKey: true, shiftKey: true });
    expect(S().project.clips.b!.start).toBe(1);
  });

  it('does not fire in text fields (native copy/paste stays intact)', () => {
    S().selectClips(['a']);
    const input = document.createElement('input');
    input.type = 'text';
    expect(key('c', { metaKey: true }, input)).toBe(false);
    expect(key('x', { metaKey: true }, input)).toBe(false);
    expect(key('v', { metaKey: true }, input)).toBe(false);
    expect(S().clipboard).toBeNull();
    expect(S().project.clips.a).toBeDefined();
    const area = document.createElement('textarea');
    expect(key('v', { metaKey: true }, area)).toBe(false);
  });

  it('leaves Cmd+C to the browser when page text is selected, and Cmd+V when the clipboard is empty', () => {
    S().selectClips(['a']);
    const p = document.createElement('p');
    p.textContent = 'some label';
    document.body.appendChild(p);
    const range = document.createRange();
    range.selectNodeContents(p);
    window.getSelection()!.addRange(range);
    expect(key('c', { metaKey: true })).toBe(false);
    window.getSelection()!.removeAllRanges();
    p.remove();
    expect(key('v', { metaKey: true })).toBe(false);
  });

  it('Shift+Cmd/Ctrl+A detaches audio, pressing it again restores; Cmd+A still selects all', () => {
    S().selectClips(['a']);
    expect(key('A', { metaKey: true, shiftKey: true })).toBe(true);
    expect((S().project.clips.a as VideoClip).audioDetached).toBe(true);
    expect(Object.values(S().project.clips).filter((c) => c.type === 'audio')).toHaveLength(1);
    expect(key('A', { altKey: true, shiftKey: true })).toBe(true);
    expect((S().project.clips.a as VideoClip).audioDetached).toBeUndefined();
    expect(Object.values(S().project.clips).filter((c) => c.type === 'audio')).toHaveLength(0);
    key('a', { metaKey: true });
    expect(S().selectedClipIds).toEqual(['a', 'b']);
  });
});
