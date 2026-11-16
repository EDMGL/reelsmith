import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  PreviewOverlayLayer,
  createProject,
  createTextClip,
  defaultTextStyle,
  ops,
  registerPreviewOverlay,
  resetRegistries,
  useEditorStore,
  type Project,
  type TextClip,
} from '../../../core';
import { fakeMeasureWidth } from '../../text/__tests__/fakeCanvas';
import { setSharedMeasure } from '../../text/textLayout';
import TransformOverlay from '../TransformOverlay';

const S = () => useEditorStore.getState();
const DISPLAY_W = 500; // project 1000x500 shown at 0.5
const DISPLAY_H = 250;

function Host() {
  const project = useEditorStore((s) => s.project);
  return (
    <div data-testid="host" style={{ position: 'relative', width: DISPLAY_W, height: DISPLAY_H }}>
      <canvas data-testid="canvas" />
      <PreviewOverlayLayer project={project} displayWidth={DISPLAY_W} displayHeight={DISPLAY_H} />
    </div>
  );
}

const origRect = HTMLElement.prototype.getBoundingClientRect;
beforeAll(() => {
  setSharedMeasure(fakeMeasureWidth);
  HTMLElement.prototype.getBoundingClientRect = function () {
    return { left: 0, top: 0, x: 0, y: 0, width: DISPLAY_W, height: DISPLAY_H, right: DISPLAY_W, bottom: DISPLAY_H, toJSON() {} } as DOMRect;
  };
});
afterAll(() => {
  setSharedMeasure(null);
  HTMLElement.prototype.getBoundingClientRect = origRect;
});

let textTrack = '';
beforeEach(() => {
  resetRegistries();
  registerPreviewOverlay(TransformOverlay, { id: 'overlays:transform' });
  let p: Project = { ...createProject(), width: 1000, height: 500 };
  const r = ops.addTrack(p, 'text');
  p = r.project;
  textTrack = r.trackId;
  const text: TextClip = {
    ...createTextClip({ trackId: textTrack, start: 0, text: 'abcd', style: { ...defaultTextStyle(), fontSize: 20, lineHeight: 1, shadow: null } }),
    id: 'text',
  };
  p = ops.addClip(p, text)!; // 40x20 box at canvas center (500,250) → display (250,125)
  S().loadProject(p);
  S().setCurrentTime(1);
});
afterEach(() => {
  cleanup();
  resetRegistries();
});

const tf = () => (S().project.clips.text as TextClip).transform;

describe('TransformOverlay', () => {
  it('click selects the clip under the pointer, drag moves it as ONE undo step', () => {
    render(<Host />);
    const canvas = screen.getByTestId('canvas');
    expect(screen.queryByTestId('transform-box')).toBeNull();
    fireEvent.pointerDown(canvas, { button: 0, clientX: 250, clientY: 125 });
    expect(S().selectedClipIds).toEqual(['text']);
    fireEvent.pointerMove(window, { clientX: 275, clientY: 125 });
    fireEvent.pointerMove(window, { clientX: 300, clientY: 140 });
    fireEvent.pointerUp(window, { clientX: 300, clientY: 140 });
    expect(tf().x).toBeCloseTo(0.6);
    expect(tf().y).toBeCloseTo(0.56);
    expect(S().past).toHaveLength(1);
    act(() => S().undo());
    expect(tf().x).toBe(0.5);
    expect(tf().y).toBe(0.5);
  });

  it('shows a box matching the text layout, and clicking empty space deselects', () => {
    render(<Host />);
    act(() => S().selectClips(['text']));
    const box = screen.getByTestId('transform-box');
    expect(box.style.width).toBe('20px'); // 40 project px * 0.5
    expect(box.style.height).toBe('10px');
    expect(box.style.left).toBe('250px');
    fireEvent.pointerDown(screen.getByTestId('canvas'), { button: 0, clientX: 20, clientY: 20 });
    expect(S().selectedClipIds).toEqual([]);
    expect(S().past).toHaveLength(0);
  });

  it('corner handle scales about the center (one undo step)', () => {
    render(<Host />);
    act(() => S().selectClips(['text']));
    fireEvent.pointerDown(screen.getByTestId('handle-se'), { button: 0, clientX: 260, clientY: 130 });
    fireEvent.pointerMove(window, { clientX: 270, clientY: 135 });
    fireEvent.pointerUp(window, {});
    expect(tf().scale).toBeCloseTo(2);
    expect(tf().x).toBe(0.5);
    expect(S().past).toHaveLength(1);
    act(() => S().undo());
    expect(tf().scale).toBe(1);
  });

  it('rotate handle rotates by the swept angle; Escape cancels a drag', () => {
    render(<Host />);
    act(() => S().selectClips(['text']));
    fireEvent.pointerDown(screen.getByTestId('handle-rotate'), { button: 0, clientX: 250, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 275, clientY: 125 });
    fireEvent.pointerUp(window, {});
    expect(tf().rotation).toBeCloseTo(90);
    expect(S().past).toHaveLength(1);

    fireEvent.pointerDown(screen.getByTestId('handle-rotate'), { button: 0, clientX: 250, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 225, clientY: 125 });
    expect(tf().rotation).not.toBeCloseTo(90);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(tf().rotation).toBeCloseTo(90);
    expect(S().past).toHaveLength(1);
  });

  it('arrow keys nudge after interacting with the preview (and stop the frame-step shortcut)', () => {
    render(<Host />);
    fireEvent.pointerDown(screen.getByTestId('canvas'), { button: 0, clientX: 250, clientY: 125 });
    fireEvent.pointerUp(window, {});
    const ev = new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true, cancelable: true });
    act(() => void window.dispatchEvent(ev));
    expect(ev.defaultPrevented).toBe(true);
    expect(tf().x * 1000).toBeCloseTo(510);
    // clicking elsewhere hands arrows back to the timeline
    fireEvent.pointerDown(document.body, { button: 0 });
    const ev2 = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
    act(() => void window.dispatchEvent(ev2));
    expect(ev2.defaultPrevented).toBe(false);
  });

  it('locked tracks: not selectable by click, no handles when selected elsewhere', () => {
    act(() => S().updateTrack(textTrack, { locked: true }));
    render(<Host />);
    fireEvent.pointerDown(screen.getByTestId('canvas'), { button: 0, clientX: 250, clientY: 125 });
    expect(S().selectedClipIds).toEqual([]);
    act(() => S().selectClips(['text']));
    expect(screen.getByTestId('transform-box').className).toContain('locked');
    expect(screen.queryByTestId('handle-se')).toBeNull();
  });

  it('overlay root does not capture pointer events', () => {
    render(<Host />);
    expect(screen.getByTestId('transform-overlay').className).toBe('p3-xf-root');
  });
});
