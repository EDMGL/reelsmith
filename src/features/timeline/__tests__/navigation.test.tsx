import { act, fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { adjacentEditPoint, createSubtitleClip, editPoints, ops, useEditorStore } from '../../../core';
import { makeProject, videoClip, withClips } from '../../../core/__tests__/fixtures';
import { handleShortcut } from '../../../app/shortcuts';
import { overviewBlocks } from '../Navigator';
import { Timeline, revealScrollLeft } from '../Timeline';
import { cancelActiveGesture } from '../interactions';
import { useTimelineUi } from '../timelineUi';

const S = () => useEditorStore.getState();
const key = (k: string, target?: EventTarget) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true });
  if (target) Object.defineProperty(e, 'target', { value: target });
  return handleShortcut(e);
};

beforeEach(() => {
  cancelActiveGesture();
  const { project, v } = makeProject();
  // Cuts at 0, 2, 3, 5, 8 (gap 2..3); a subtitle at 1..1.5 must not count as a cut.
  const r = ops.addTrack(withClips(project, videoClip(project, 'a', v, 0, 0, 2), videoClip(project, 'b', v, 3, 0, 2), videoClip(project, 'c', v, 5, 1, 4)), 'subtitle');
  const sub = { ...createSubtitleClip({ trackId: r.trackId, start: 1, duration: 0.5, text: 'hi' }), id: 's1' };
  S().loadProject({ ...r.project, clips: { ...r.project.clips, s1: sub } });
  useTimelineUi.setState({ drag: null, draggingIds: null, snapLine: null, menu: null });
});

describe('cut points', () => {
  it('lists clip starts/ends (not captions), 0 and the end', () => {
    expect(editPoints(S().project)).toEqual([0, 2, 3, 5, 8]);
    expect(adjacentEditPoint(S().project, 2.5, 1)).toBe(3);
    expect(adjacentEditPoint(S().project, 3, -1)).toBe(2);
    expect(adjacentEditPoint(S().project, 8, 1)).toBe(8);
    expect(adjacentEditPoint(S().project, 0, -1)).toBe(0);
  });
});

describe('navigation shortcuts', () => {
  it('End jumps to the end, Home back to the start', () => {
    expect(key('End')).toBe(true);
    expect(S().currentTime).toBe(8);
    expect(key('Home')).toBe(true);
    expect(S().currentTime).toBe(0);
  });

  it('Up / Down step through the cuts', () => {
    key('ArrowDown');
    expect(S().currentTime).toBe(2);
    key('ArrowDown');
    expect(S().currentTime).toBe(3);
    key('ArrowUp');
    expect(S().currentTime).toBe(2);
  });

  it('Up / Down leave sliders alone', () => {
    const range = document.createElement('input');
    range.type = 'range';
    expect(key('ArrowDown', range)).toBe(false);
    expect(S().currentTime).toBe(0);
  });
});

describe('revealScrollLeft', () => {
  it('scrolls only when the playhead is out of view, landing it a third in', () => {
    expect(revealScrollLeft(0, 600, 300)).toBeNull();
    expect(revealScrollLeft(5000, 600, 0)).toBe(0);
    expect(revealScrollLeft(0, 600, 3000)).toBe(2800);
  });
});

describe('overview strip', () => {
  it('merges clip blocks per row (picture / sound / captions)', () => {
    const blocks = overviewBlocks(S().project, 8);
    expect(blocks.filter((b) => b.row === 0)).toEqual([
      { row: 0, a: 0, b: 0.25 },
      { row: 0, a: 3 / 8, b: 1 },
    ]);
    expect(blocks.filter((b) => b.row === 2)).toHaveLength(1);
  });

  it('click jumps the playhead there; buttons jump to start / end / cuts', () => {
    const { getByTestId, getByLabelText } = render(<Timeline />);
    const strip = getByTestId('timeline-navigator');
    strip.getBoundingClientRect = () => ({ left: 100, width: 400, top: 0, height: 22, right: 500, bottom: 22, x: 100, y: 0, toJSON: () => ({}) });
    act(() => {
      fireEvent.pointerDown(strip, { button: 0, clientX: 300, pointerId: 1 });
    });
    expect(S().currentTime).toBeCloseTo(4); // halfway through 8 s
    act(() => {
      fireEvent.pointerMove(window, { clientX: 400, pointerId: 1 });
      fireEvent.pointerUp(window, { pointerId: 1 });
    });
    expect(S().currentTime).toBeCloseTo(6);
    fireEvent.click(getByLabelText('Go to start'));
    expect(S().currentTime).toBe(0);
    fireEvent.click(getByLabelText('Go to end'));
    expect(S().currentTime).toBe(8);
    fireEvent.click(getByLabelText('Previous cut'));
    expect(S().currentTime).toBe(5);
    fireEvent.click(getByLabelText('Next cut'));
    expect(S().currentTime).toBe(8);
  });
});
