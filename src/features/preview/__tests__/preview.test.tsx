import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createProject, registerPreviewOverlay, useEditorStore, type PreviewOverlayProps, type Unregister } from '../../../core';
import Preview from '../Preview';

const S = () => useEditorStore.getState();
const protoW = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
const protoH = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
let offs: Unregister[] = [];
let seen: PreviewOverlayProps | null = null;

function Overlay(props: PreviewOverlayProps) {
  seen = props;
  return <button style={{ pointerEvents: 'auto' }}>handle</button>;
}

beforeAll(() => {
  // jsdom has no layout: give every element an 832 x 632 box (stage minus 2 x 16 padding = 800 x 600).
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 832 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 632 });
});
afterAll(() => {
  if (protoW) Object.defineProperty(HTMLElement.prototype, 'clientWidth', protoW);
  if (protoH) Object.defineProperty(HTMLElement.prototype, 'clientHeight', protoH);
});
beforeEach(() => {
  S().loadProject(createProject({ width: 1920, height: 1080, aspectPreset: '16:9' }));
  offs.push(registerPreviewOverlay(Overlay, { id: 'test-overlay' }));
  seen = null;
});
afterEach(() => {
  offs.forEach((f) => f());
  offs = [];
});

describe('Preview', () => {
  it('fits the canvas at the project aspect and mounts the overlay layer over the exact canvas rect', () => {
    render(<Preview />);
    const frame = screen.getByTestId('preview-frame');
    expect(frame.style.width).toBe('800px');
    expect(frame.style.height).toBe('450px');
    expect(frame.style.top).toBe(`${16 + 75}px`);
    const canvas = screen.getByTestId('preview-canvas') as HTMLCanvasElement;
    expect(canvas.width).toBe(Math.round(800 * Math.min(3, window.devicePixelRatio || 1)));
    expect(seen).toMatchObject({ displayWidth: 800, displayHeight: 450 });
    expect(seen!.scale).toBeCloseTo(800 / 1920);
    // The overlay layer lives inside the frame box.
    expect(frame.querySelector('[data-testid="preview-overlay-layer"]')).toBeTruthy();
  });

  it('reshapes when the aspect ratio changes', () => {
    render(<Preview />);
    act(() => S().setAspectPreset('9:16'));
    const frame = screen.getByTestId('preview-frame');
    expect(frame.style.height).toBe('600px');
    expect(parseFloat(frame.style.width)).toBeCloseTo(337.5);
    expect(screen.getByTestId('preview-placeholder').textContent).toContain('1080 × 1920');
  });

  it('clears the selection on an empty-canvas click but lets overlay pointer events through', () => {
    render(<Preview />);
    useEditorStore.setState({ selectedClipIds: ['x'] });
    fireEvent.pointerDown(screen.getByText('handle'), { button: 0 });
    expect(S().selectedClipIds).toEqual(['x']);
    fireEvent.pointerDown(screen.getByTestId('preview-canvas'), { button: 0 });
    expect(S().selectedClipIds).toEqual([]);
  });

  it('does not clear the selection when the pointerdown was already default-prevented', () => {
    render(<Preview />);
    useEditorStore.setState({ selectedClipIds: ['x'] });
    const canvas = screen.getByTestId('preview-canvas');
    // A native listener (like P3's transform overlay) handles the event first.
    const handler = (e: Event) => e.preventDefault();
    canvas.addEventListener('pointerdown', handler);
    fireEvent.pointerDown(canvas, { button: 0, cancelable: true });
    canvas.removeEventListener('pointerdown', handler);
    expect(S().selectedClipIds).toEqual(['x']);
  });

  it('steps one frame with the frame buttons', () => {
    render(<Preview />);
    useEditorStore.setState({ project: { ...S().project, clips: { c: { id: 'c', type: 'text', trackId: 't', start: 0, duration: 5 } as never } } });
    fireEvent.click(screen.getByRole('button', { name: 'Next frame' }));
    expect(S().currentTime).toBeCloseTo(1 / 30);
    fireEvent.click(screen.getByRole('button', { name: 'Previous frame' }));
    expect(S().currentTime).toBe(0);
  });
});
