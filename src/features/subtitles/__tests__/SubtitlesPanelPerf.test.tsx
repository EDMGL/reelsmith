/**
 * Render-cost guarantees of the Subtitles panel: playback ticks inside one cue
 * re-render no row, a cue change re-renders only the two affected rows, typing
 * in a cue re-renders only that row, and long lists are windowed.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject, useEditorStore } from '../../../core';
import { importCues } from '../cueActions';

// Every CueRow renders one CueText, which calls useBurstTx on each render: counting
// those calls measures row re-renders without shipping a counter. (React may render
// a re-rendered CueText more than once per commit, so bounds allow a factor of 2;
// before the fix every tick re-rendered ALL rows.)
const rowRenders = vi.hoisted(() => ({ n: 0 }));
vi.mock('../../text/controls', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../text/controls')>();
  return {
    ...mod,
    useBurstTx: (label: string, idleMs?: number) => {
      if (label === 'Edit subtitle text') rowRenders.n++;
      return mod.useBurstTx(label, idleMs);
    },
  };
});

const { default: SubtitlesPanel } = await import('../SubtitlesPanel');
const S = () => useEditorStore.getState();

function loadCues(n: number): void {
  S().loadProject(createProject());
  importCues(Array.from({ length: n }, (_, i) => ({ start: i, end: i + 0.9, text: `Cue number ${i}` })));
}

beforeEach(() => {
  rowRenders.n = 0;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SubtitlesPanel render cost', () => {
  it('playback ticks inside the same cue re-render no cue row; a cue change re-renders only two', () => {
    loadCues(10);
    render(<SubtitlesPanel />);
    expect(screen.getAllByTestId('cue-row')).toHaveLength(10);
    act(() => S().setCurrentTime(2.05));
    expect(screen.getAllByTestId('cue-row')[2]!.getAttribute('aria-current')).toBe('true');
    rowRenders.n = 0;
    act(() => S().play());
    for (let i = 1; i < 30; i++) act(() => S().setPlaybackTime(2.05 + i * 0.025)); // stays in cue 2 (2.0 .. 2.9)
    expect(rowRenders.n).toBe(0);
    act(() => S().setPlaybackTime(3.1)); // cue 2 -> cue 3: only those two rows
    expect(rowRenders.n).toBeGreaterThanOrEqual(2);
    expect(rowRenders.n).toBeLessThanOrEqual(4);
    const afterChange = rowRenders.n;
    expect(screen.getAllByTestId('cue-row')[3]!.getAttribute('aria-current')).toBe('true');
    expect(screen.getAllByTestId('cue-row')[2]!.getAttribute('aria-current')).toBeNull();
    act(() => S().setPlaybackTime(3.95)); // gap between cues: one row loses "current"
    expect(rowRenders.n - afterChange).toBeGreaterThanOrEqual(1);
    expect(rowRenders.n - afterChange).toBeLessThanOrEqual(2);
    act(() => S().pause());
  });

  it('typing in one cue re-renders only that row', () => {
    loadCues(20);
    render(<SubtitlesPanel />);
    rowRenders.n = 0;
    const ta = screen.getAllByLabelText('Cue text')[7] as HTMLTextAreaElement;
    fireEvent.focus(ta);
    fireEvent.change(ta, { target: { value: 'Edited a' } });
    fireEvent.change(ta, { target: { value: 'Edited ab' } });
    fireEvent.blur(ta);
    expect(rowRenders.n).toBeLessThanOrEqual(4); // 2 keystrokes x the edited row only (20 rows)
    expect(Object.values(S().project.clips).some((c) => c.type === 'subtitle' && c.text === 'Edited ab')).toBe(true);
  });

  it('selection and unrelated store changes do not re-render every row', () => {
    loadCues(20);
    render(<SubtitlesPanel />);
    rowRenders.n = 0;
    const id = Object.values(S().project.clips).find((c) => c.start === 5)!.id;
    act(() => S().selectClips([id]));
    expect(rowRenders.n).toBeGreaterThanOrEqual(1);
    expect(rowRenders.n).toBeLessThanOrEqual(2);
    const n = rowRenders.n;
    act(() => S().setZoom(S().zoom * 2));
    expect(rowRenders.n).toBe(n);
  });

  it('windows long lists when the panel has a viewport', async () => {
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(function (this: Element) {
      return this.classList.contains('p3-panel') ? 500 : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.dataset.cueId ? 60 : 0;
    });
    // Fake layout: the list starts 300px into the panel content and moves up as the panel scrolls.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const panel = this.closest('.p3-panel') as HTMLElement | null;
      const top = this.classList.contains('p3-cue-list') && panel ? 300 - panel.scrollTop : 0;
      return { top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    });
    loadCues(300);
    render(<SubtitlesPanel />);
    const rows = screen.getAllByTestId('cue-row');
    expect(rows.length).toBeGreaterThan(5);
    expect(rows.length).toBeLessThan(60);
    expect(screen.getByText(/300 cues/)).toBeTruthy();
    // Scrolling far down mounts the rows there.
    const panel = document.querySelector('.p3-panel') as HTMLElement;
    Object.defineProperty(panel, 'scrollTop', { configurable: true, value: 150 * 60 }); // jsdom has no scrolling
    fireEvent.scroll(panel);
    await waitFor(() => expect(screen.getAllByTestId('cue-row').some((r) => r.textContent?.includes('Cue number 150'))).toBe(true));
    expect(screen.getAllByTestId('cue-row').length).toBeLessThan(60);
  });
});
