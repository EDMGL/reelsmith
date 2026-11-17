import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createProject, formatTimecode, useEditorStore } from '../../core';
import { makeAsset } from '../../core/__tests__/fixtures';
import { App } from '../App';
import { Transport, transportRenderCount } from '../PreviewArea';
import { SHORTCUT_GROUPS } from '../ShortcutsDialog';
import { splitTooltip } from '../Tooltip';
import { DEFAULT_LAYOUT, LAYOUT_STORAGE_KEY, loadLayout } from '../layout';
import { registerFeatures } from '../registerFeatures';

const S = () => useEditorStore.getState();

beforeAll(() => registerFeatures());
beforeEach(() => {
  S().loadProject(createProject());
  useEditorStore.setState({ hydrated: true });
});
afterEach(() => window.localStorage.clear());

describe('Transport', () => {
  it('playback ticks update the timecode without re-rendering the transport', () => {
    S().addAsset(makeAsset('a1', 8));
    S().addAssetClip('a1');
    render(<Transport />);
    const time = screen.getByTestId('transport-time');
    expect(time.textContent).toBe(formatTimecode(0, 30));
    expect(screen.getByTestId('transport-duration').textContent).toBe(formatTimecode(8, 30));
    act(() => S().play());
    const before = transportRenderCount.current;
    act(() => {
      for (let i = 1; i <= 120; i++) S().setPlaybackTime(i / 60);
    });
    expect(transportRenderCount.current - before).toBe(0);
    expect(time.textContent).toBe(formatTimecode(2, 30));
    act(() => S().setCurrentTime(5));
    expect(time.textContent).toBe(formatTimecode(5, 30));
    act(() => S().pause());
    // Pausing re-renders once (play/pause icon) and keeps the imperatively written time.
    expect(time.textContent).toBe(formatTimecode(5, 30));
  });

  it('re-renders when the project changes (duration) but not per tick', () => {
    render(<Transport />);
    const before = transportRenderCount.current;
    act(() => {
      S().addAsset(makeAsset('a2', 4));
      S().addAssetClip('a2');
    });
    expect(transportRenderCount.current).toBeGreaterThan(before);
    expect(screen.getByTestId('transport-duration').textContent).toBe(formatTimecode(4, 30));
  });
});

describe('shortcuts help', () => {
  it('opens with "?" and the top-bar button, closes with Escape', () => {
    render(<App />);
    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).toBeNull();
    fireEvent.keyDown(window, { key: '?' });
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy();
    // Esc closes the dialog and does not reach the editor's "clear selection".
    S().addAsset(makeAsset('a1', 8));
    act(() => {
      S().addAssetClip('a1');
    });
    expect(S().selectedClipIds.length).toBe(1);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).toBeNull();
    expect(S().selectedClipIds.length).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }));
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy();
  });

  it('"?" typed in a text field does not open it', () => {
    render(<App />);
    const input = screen.getByLabelText('Project name');
    fireEvent.keyDown(input, { key: '?' });
    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).toBeNull();
  });

  it('lists the clipboard and detach-audio shortcuts', () => {
    const actions = SHORTCUT_GROUPS.flatMap((g) => g.rows.map((r) => r.action));
    for (const a of ['Copy', 'Cut', 'Ripple cut', 'Paste at playhead', 'Detach / restore audio', 'Split at playhead', 'Undo', 'Redo']) {
      expect(actions).toContain(a);
    }
  });
});

describe('layout', () => {
  it('restores remembered sizes, clamped to limits', () => {
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ left: 9999, right: 10, timeline: 333, rightCollapsed: true }));
    const l = loadLayout();
    expect(l.left).toBe(560);
    expect(l.right).toBe(250);
    expect(l.timeline).toBe(333);
    expect(l.rightCollapsed).toBe(true);
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, 'not json');
    expect(loadLayout()).toEqual(DEFAULT_LAYOUT);
  });

  it('keyboard resizing of the timeline is remembered', () => {
    render(<App />);
    const handle = screen.getByRole('separator', { name: 'Resize timeline' });
    fireEvent.keyDown(handle, { key: 'ArrowUp' });
    expect(JSON.parse(window.localStorage.getItem(LAYOUT_STORAGE_KEY)!).timeline).toBe(DEFAULT_LAYOUT.timeline + 16);
    expect(S().currentTime).toBe(0);
  });

  it('inspector sections collapse and stay collapsed', () => {
    S().addAsset(makeAsset('a1', 8));
    S().addAssetClip('a1');
    const { unmount } = render(<App />);
    const toggle = screen.getByText('Clip').closest('button')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    unmount();
    render(<App />);
    expect(screen.getByText('Clip').closest('button')!.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(screen.getByText('Clip').closest('button')!);
  });
});

describe('tooltip text', () => {
  it('splits trailing key hints only', () => {
    expect(splitTooltip('Split at playhead (S)')).toEqual({ text: 'Split at playhead', keys: 'S' });
    expect(splitTooltip('Undo Split (⌘Z)')).toEqual({ text: 'Undo Split', keys: '⌘Z' });
    expect(splitTooltip('Ripple delete: delete and close the gap (Shift+Del)')).toEqual({
      text: 'Ripple delete: delete and close the gap',
      keys: 'Shift+Del',
    });
    expect(splitTooltip('Record your screen (and camera)').keys).toBeNull();
    expect(splitTooltip('Media').keys).toBeNull();
  });
});
