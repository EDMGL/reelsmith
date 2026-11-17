import { act, fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { createProject, createSubtitleClip, ops, useEditorStore, type Clip, type Project } from '../../../core';
import { makeAsset, videoClip } from '../../../core/__tests__/fixtures';
import { Timeline } from '../Timeline';
import { cancelActiveGesture } from '../interactions';
import { renderCounts, resetRenderCounts, useTimelineUi } from '../timelineUi';

const S = () => useEditorStore.getState();

/** 500 subtitle clips (0.8 s every second) + 2 video clips. */
function bigProject(): { project: Project; sub: string; v: string } {
  const r = ops.addTrack({ ...createProject(), assets: { asset1: makeAsset('asset1', 10) } }, 'subtitle');
  const p = r.project;
  const v = p.tracks.find((t) => t.kind === 'video')!.id;
  const clips: Clip[] = [videoClip(p, 'va', v, 0, 0, 4), videoClip(p, 'vb', v, 5, 0, 4)];
  for (let i = 0; i < 500; i++) clips.push({ ...createSubtitleClip({ trackId: r.trackId, start: i, duration: 0.8, text: `line ${i}` }), id: `s${i}` });
  return { project: { ...p, clips: Object.fromEntries(clips.map((c) => [c.id, c])) }, sub: r.trackId, v };
}

let ids: { sub: string; v: string };
beforeEach(() => {
  cancelActiveGesture();
  const b = bigProject();
  ids = { sub: b.sub, v: b.v };
  S().loadProject(b.project);
  S().setZoom(60);
  useTimelineUi.setState({ drag: null, draggingIds: null, snapLine: null, menu: null });
});

const mounted = (c: HTMLElement) => c.querySelectorAll('.lane .clip').length;

describe('timeline rendering performance', () => {
  it('virtualizes: only clips near the visible window are mounted', () => {
    const { container } = render(<Timeline />);
    const n = mounted(container);
    expect(n).toBeGreaterThan(5);
    expect(n).toBeLessThan(100); // jsdom viewport 800px -> ~3 chunks of ~10 s at 60 px/s
  });

  it('playback causes ZERO renders of Timeline, TrackRow and ClipView', () => {
    const { container } = render(<Timeline />);
    const line = container.querySelector('.playhead-line') as HTMLElement;
    act(() => S().play());
    resetRenderCounts();
    act(() => {
      for (let i = 1; i <= 300; i++) S().setPlaybackTime(i / 60); // 5 s at 60 fps
    });
    expect(renderCounts).toEqual({ timeline: 0, trackRow: 0, clipView: 0 });
    expect(line.style.transform).toContain(`${176 + 5 * 60}px`);
    act(() => S().pause());
  });

  it('editing one clip re-renders only its track row and that clip', () => {
    render(<Timeline />);
    resetRenderCounts();
    act(() => void S().updateClip('va', { name: 'renamed' }));
    expect(renderCounts.trackRow).toBe(1);
    expect(renderCounts.clipView).toBe(1);
  });

  it('selection changes re-render only the affected clips', () => {
    render(<Timeline />);
    resetRenderCounts();
    act(() => S().selectClips(['s3']));
    act(() => S().selectClips(['s4']));
    expect(renderCounts.trackRow).toBe(0);
    expect(renderCounts.clipView).toBe(3); // s3 on, s3 off + s4 on
  });

  it('a clip drag re-renders no rows or clips per pointer move (only the drag layer)', () => {
    const { container } = render(<Timeline />);
    const el = container.querySelector('[data-clip-id="s2"]') as HTMLElement;
    act(() => {
      fireEvent.pointerDown(el, { button: 0, clientX: 176 + 2 * 60 + 10, clientY: 30 });
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 176 + 2 * 60 + 30, clientY: 30 }) as PointerEvent);
    });
    resetRenderCounts();
    act(() => {
      for (let i = 0; i < 30; i++) window.dispatchEvent(new MouseEvent('pointermove', { clientX: 176 + 2 * 60 + 40 + i, clientY: 30 }) as PointerEvent);
    });
    expect(renderCounts).toEqual({ timeline: 0, trackRow: 0, clipView: 0 });
    expect(container.querySelectorAll('[data-testid=drag-ghost]').length).toBe(1);
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(container.querySelectorAll('[data-testid=drag-ghost]').length).toBe(0);
  });

  it('zoom/scroll keep rows memoized when the window does not change', () => {
    render(<Timeline />);
    resetRenderCounts();
    act(() => S().setCurrentTime(42)); // user seek
    expect(renderCounts).toEqual({ timeline: 0, trackRow: 0, clipView: 0 });
  });
});

describe('timeline gestures always end cleanly (one undo step, no stuck transaction)', () => {
  it('moving a clip across tracks is one undo step', () => {
    const { container } = render(<Timeline />);
    const rows = container.querySelector('.rows') as HTMLElement;
    rows.getBoundingClientRect = () => ({ left: 0, top: 0, right: 2000, bottom: 400, width: 2000, height: 400, x: 0, y: 0, toJSON() {} });
    const before = S().past.length;
    const clip = container.querySelector('[data-clip-id="vb"]') as HTMLElement;
    // Layout: gutter 14, subtitle row 14..50, video row 50..114, audio 114..162, bottom zone below.
    act(() => {
      fireEvent.pointerDown(clip, { button: 0, clientX: 176 + 5 * 60 + 5, clientY: 80 });
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 176 + 12 * 60 + 5, clientY: 80 }) as PointerEvent);
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 176 + 12 * 60 + 5, clientY: 300 }) as PointerEvent); // below tracks
    });
    expect(container.querySelector('[data-testid=new-track-line]')).toBeTruthy();
    act(() => window.dispatchEvent(new MouseEvent('pointerup', { clientX: 176 + 12 * 60 + 5, clientY: 300 }) as PointerEvent));
    const moved = S().project.clips.vb!;
    expect(moved.start).toBeCloseTo(12);
    expect(moved.trackId).not.toBe(ids.v);
    expect(S().project.tracks.find((t) => t.id === moved.trackId)!.kind).toBe('video');
    expect(S().past.length).toBe(before + 1);
    expect(S().transaction).toBeNull();
    S().undo();
    expect(S().project.clips.vb!.trackId).toBe(ids.v);
    expect(S().project.tracks).toHaveLength(3);
  });

  it('a trim interrupted by window blur is cancelled (no open transaction)', () => {
    const { container } = render(<Timeline />);
    const handle = container.querySelector('[data-clip-id="va"] .trim-end') as HTMLElement;
    act(() => {
      fireEvent.pointerDown(handle, { button: 0, clientX: 176 + 4 * 60, clientY: 80 });
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 176 + 3 * 60, clientY: 80 }) as PointerEvent);
    });
    expect(S().transaction).not.toBeNull();
    expect(S().project.clips.va!.duration).toBeCloseTo(3);
    act(() => window.dispatchEvent(new Event('blur')));
    expect(S().transaction).toBeNull();
    expect(S().project.clips.va!.duration).toBeCloseTo(4);
  });

  it('a completed trim is exactly one undo step; a click on a handle adds none', () => {
    const { container } = render(<Timeline />);
    const handle = () => container.querySelector('[data-clip-id="va"] .trim-end') as HTMLElement;
    const before = S().past.length;
    act(() => {
      fireEvent.pointerDown(handle(), { button: 0, clientX: 176 + 240, clientY: 80 });
      window.dispatchEvent(new MouseEvent('pointerup', { clientX: 176 + 240, clientY: 80 }) as PointerEvent);
    });
    expect(S().past.length).toBe(before);
    act(() => {
      fireEvent.pointerDown(handle(), { button: 0, clientX: 176 + 240, clientY: 80 });
      for (const x of [230, 220, 210, 200]) window.dispatchEvent(new MouseEvent('pointermove', { clientX: 176 + x, clientY: 80 }) as PointerEvent);
      window.dispatchEvent(new MouseEvent('pointerup', { clientX: 176 + 200, clientY: 80 }) as PointerEvent);
    });
    expect(S().past.length).toBe(before + 1);
    expect(S().transaction).toBeNull();
  });

  it('right-click opens the clip menu; Copy + "Paste here" on a lane works', () => {
    const { container, getByRole } = render(<Timeline />);
    const clip = container.querySelector('[data-clip-id="va"]') as HTMLElement;
    act(() => void fireEvent.contextMenu(clip, { clientX: 200, clientY: 80 }));
    expect(S().selectedClipIds).toEqual(['va']);
    act(() => void fireEvent.click(getByRole('menuitem', { name: /^Copy/ })));
    expect(S().clipboard!.clips.map((c) => c.id)).toEqual(['va']);
    const lane = container.querySelector(`[data-lane-track-id="${ids.v}"]`) as HTMLElement;
    act(() => void fireEvent.contextMenu(lane, { clientX: 176 + 20 * 60, clientY: 80 }));
    act(() => void fireEvent.click(getByRole('menuitem', { name: /Paste here/ })));
    const pasted = S().project.clips[S().selectedClipIds[0]!]!;
    expect(pasted.start).toBeCloseTo(20);
    expect(pasted.trackId).toBe(ids.v);
  });
});
