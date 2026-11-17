/** Autosave scheduling (core/persistence.ts `startAutosave`): coalescing, never while playing or mid-transaction. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject, createTextClip, startAutosave, useEditorStore } from '../../core';

const S = () => useEditorStore.getState();
let stop: (() => void) | null = null;
let saves = 0;

function addText(start: number): void {
  const track = S().project.tracks.find((t) => t.kind === 'video')!.id;
  S().insertClip(createTextClip({ trackId: track, start, duration: 1 }));
}

beforeEach(() => {
  vi.useFakeTimers();
  S().loadProject(createProject());
  useEditorStore.setState({ hydrated: true });
  saves = 0;
  stop = startAutosave({ delayMs: 1000, save: () => void saves++, whenIdle: (cb) => cb() });
});
afterEach(() => {
  stop?.();
  stop = null;
  S().pause();
  vi.useRealTimers();
});

describe('autosave', () => {
  it('coalesces a burst of edits into one save after the idle delay', () => {
    for (let i = 0; i < 10; i++) {
      addText(i * 2);
      vi.advanceTimersByTime(300);
    }
    expect(saves).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(saves).toBe(1);
    vi.advanceTimersByTime(5000);
    expect(saves).toBe(1);
  });

  it('does not save during playback (time ticks are not changes) and saves pending edits after pause', () => {
    addText(0);
    S().play();
    for (let i = 0; i < 100; i++) {
      S().setPlaybackTime(i * 0.016);
      vi.advanceTimersByTime(50);
    }
    expect(saves).toBe(0);
    S().pause();
    vi.advanceTimersByTime(999);
    expect(saves).toBe(0);
    vi.advanceTimersByTime(1);
    expect(saves).toBe(1);
  });

  it('does not save while a transaction (drag) is open; saves once after commit', () => {
    addText(0);
    const id = Object.keys(S().project.clips)[0]!;
    S().beginTransaction('drag');
    for (let i = 1; i <= 30; i++) {
      S().moveClip(id, i * 0.1);
      vi.advanceTimersByTime(2000);
    }
    expect(saves).toBe(0);
    S().commitTransaction();
    vi.advanceTimersByTime(1000);
    expect(saves).toBe(1);
  });

  it('playhead / selection changes alone never trigger a save', () => {
    S().setCurrentTime(3);
    S().selectClips([]);
    vi.advanceTimersByTime(5000);
    expect(saves).toBe(0);
  });
});
