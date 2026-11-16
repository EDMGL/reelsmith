import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createClipFromAsset, createProject, useEditorStore, type Project, type VideoClip } from '../../core';
import { makeAsset } from '../../core/__tests__/fixtures';
import { clipsInBox } from '../../features/timeline/geometry';
import { App } from '../App';
import { InspectorPanel } from '../InspectorPanel';
import { registerFeatures } from '../registerFeatures';
import { handleShortcut } from '../shortcuts';

const S = () => useEditorStore.getState();

/** Three pieces of one video (as left by silence removal) + one audio clip. */
function project(): Project {
  const base = createProject();
  const v = base.tracks.find((t) => t.kind === 'video')!.id;
  const a = base.tracks.find((t) => t.kind === 'audio')!.id;
  const vid = makeAsset('vid', 30);
  const mus = makeAsset('mus', 30, 'audio');
  const piece = (id: string, start: number, x: number): VideoClip => ({
    ...(createClipFromAsset(vid, { trackId: v, start }) as VideoClip),
    id,
    duration: 2,
    sourceIn: start * 2,
    sourceOut: start * 2 + 2,
    transform: { x, y: 0.5, scale: 1, rotation: 0, opacity: 1 },
  });
  const music = { ...createClipFromAsset(mus, { trackId: a, start: 0 }), id: 'm1', duration: 6 };
  return {
    ...base,
    assets: { vid, mus },
    clips: { p1: piece('p1', 0, 0.5), p2: piece('p2', 2, 0.3), p3: piece('p3', 4, 0.5), m1: music as Project['clips'][string] },
  };
}

beforeAll(() => registerFeatures());
beforeEach(() => {
  S().loadProject(project());
  useEditorStore.setState({ hydrated: true });
});

describe('store.updateClips', () => {
  it('patches several clips in ONE undo step and skips null patches', () => {
    const past = S().past.length;
    const n = S().updateClips(['p1', 'p2', 'm1', 'nope'], (c) => (c.type === 'video' ? { fadeIn: 0.05 } : null));
    expect(n).toBe(2);
    expect(S().project.clips.p1!.fadeIn).toBe(0.05);
    expect(S().project.clips.p2!.fadeIn).toBe(0.05);
    expect(S().project.clips.m1!.fadeIn).toBe(0);
    expect(S().past.length).toBe(past + 1);
    S().undo();
    expect(S().project.clips.p1!.fadeIn).toBe(0);
  });
});

describe('select all / box selection', () => {
  it('Cmd/Ctrl+A selects every clip in time order', () => {
    act(() => void handleShortcut(new KeyboardEvent('keydown', { key: 'a', metaKey: true })));
    expect(S().selectedClipIds).toEqual(['p1', 'm1', 'p2', 'p3']);
  });

  it('clipsInBox hits clips overlapping the time range on the covered tracks', () => {
    const p = S().project;
    const video = p.tracks.find((t) => t.kind === 'video')!.id;
    const audio = p.tracks.find((t) => t.kind === 'audio')!.id;
    const layout = [
      { trackId: video, top: 0, height: 64 },
      { trackId: audio, top: 64, height: 48 },
    ];
    expect(clipsInBox(p, layout, 1, 3, 10, 20)).toEqual(['p1', 'p2']);
    expect(clipsInBox(p, layout, 5, 1.5, 100, 10)).toEqual(['p1', 'm1', 'p2', 'p3']);
    expect(clipsInBox(p, layout, 2, 4, 70, 80)).toEqual(['m1']);
    // touching edges does not count
    expect(clipsInBox(p, layout, 6, 9, 0, 200)).toEqual([]);
  });

  it('dragging on empty lane space draws a box and selects the clips under it', async () => {
    const { container } = render(<App />);
    const lane = container.querySelector('.track-row.kind-video .lane') as HTMLElement;
    const rows = container.querySelector('.rows') as HTMLElement;
    rows.getBoundingClientRect = () => ({ left: 0, top: 0, right: 2000, bottom: 400, width: 2000, height: 400, x: 0, y: 0, toJSON() {} });
    const zoom = S().zoom;
    const x = (t: number) => 176 + t * zoom; // HEADER_WIDTH + time
    act(() => {
      fireEvent.pointerDown(lane, { button: 0, clientX: x(9), clientY: 10 });
    });
    act(() => {
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: x(2.5), clientY: 20 }) as PointerEvent);
    });
    expect(container.querySelector('[data-testid=select-box]')).toBeTruthy();
    expect(S().selectedClipIds).toEqual(['p2', 'p3']);
    act(() => {
      window.dispatchEvent(new MouseEvent('pointerup', { clientX: x(2.5), clientY: 20 }) as PointerEvent);
    });
    expect(container.querySelector('[data-testid=select-box]')).toBeNull();
    expect(S().selectedClipIds).toEqual(['p2', 'p3']);
  });

  it('a plain click on empty lane space still clears the selection and seeks', () => {
    S().selectClips(['p1']);
    const { container } = render(<App />);
    const lane = container.querySelector('.track-row.kind-video .lane') as HTMLElement;
    const rows = container.querySelector('.rows') as HTMLElement;
    rows.getBoundingClientRect = () => ({ left: 0, top: 0, right: 2000, bottom: 400, width: 2000, height: 400, x: 0, y: 0, toJSON() {} });
    const px = 176 + 7 * S().zoom;
    act(() => {
      fireEvent.pointerDown(lane, { button: 0, clientX: px, clientY: 10 });
      window.dispatchEvent(new MouseEvent('pointerup', { clientX: px, clientY: 10 }) as PointerEvent);
    });
    expect(S().selectedClipIds).toEqual([]);
    expect(S().currentTime).toBeCloseTo(7, 5);
  });
});

describe('multi-clip inspector', () => {
  it('shows only multi-capable sections and applies edits to every selected clip', async () => {
    S().selectClips(['p1', 'p2', 'p3']);
    render(<InspectorPanel />);
    const panel = screen.getByTestId('multi-inspector');
    expect(within(panel).getByText('3 clips selected')).toBeTruthy();
    await waitFor(() => expect(within(panel).getByText('Effects')).toBeTruthy());
    expect(within(panel).queryByText('Audio cleanup')).toBeNull(); // per-file section, not multi
    expect(within(panel).queryByText('Start')).toBeNull(); // timing stays per clip

    // Volume
    fireEvent.change(within(panel).getByRole('slider', { name: /Volume/ }), { target: { value: '0.4' } });
    expect(['p1', 'p2', 'p3'].map((id) => (S().project.clips[id] as VideoClip).volume)).toEqual([0.4, 0.4, 0.4]);

    // Transform: only the edited field changes, each clip keeps its own X
    fireEvent.change(within(panel).getByRole('slider', { name: /Scale/ }), { target: { value: '1.5' } });
    expect(['p1', 'p2', 'p3'].map((id) => (S().project.clips[id] as VideoClip).transform)).toEqual([
      { x: 0.5, y: 0.5, scale: 1.5, rotation: 0, opacity: 1 },
      { x: 0.3, y: 0.5, scale: 1.5, rotation: 0, opacity: 1 },
      { x: 0.5, y: 0.5, scale: 1.5, rotation: 0, opacity: 1 },
    ]);

    // Effects: filter preset + an effect param edit reach all three, one undo step each
    const fx = await within(panel).findByTestId('effects-inspector');
    const presetSelect = within(fx).getByRole('combobox', { name: 'Filter preset' }) as HTMLSelectElement;
    const presetId = Array.from(presetSelect.options).find((o) => o.value)!.value;
    fireEvent.change(presetSelect, { target: { value: presetId } });
    const stacks = ['p1', 'p2', 'p3'].map((id) => S().project.clips[id]!.effects.map((e) => [e.effectType, e.params]));
    expect(stacks[0]!.length).toBeGreaterThan(0);
    expect(stacks[1]).toEqual(stacks[0]);
    expect(stacks[2]).toEqual(stacks[0]);

    const past = S().past.length;
    const firstSlider = within(fx).getAllByRole('slider')[0] as HTMLInputElement;
    fireEvent.change(firstSlider, { target: { value: String(Number(firstSlider.min) + (Number(firstSlider.max) - Number(firstSlider.min)) * 0.25) } });
    const after = ['p1', 'p2', 'p3'].map((id) => JSON.stringify(S().project.clips[id]!.effects.map((e) => e.params)));
    expect(after[0]).not.toEqual(JSON.stringify(stacks[0]!.map((s) => s[1])));
    expect(new Set(after).size).toBe(1);
    expect(S().past.length).toBe(past + 1);
  });

  it('mixed selection: sections say how many clips they apply to', async () => {
    S().selectClips(['p1', 'm1']);
    render(<InspectorPanel />);
    const panel = screen.getByTestId('multi-inspector');
    await waitFor(() => expect(within(panel).getByText('Effects')).toBeTruthy());
    expect(within(panel).getAllByText(/· 1 of 2/).length).toBeGreaterThan(0);
    fireEvent.change(within(panel).getByRole('slider', { name: /Volume/ }), { target: { value: '0.2' } });
    expect((S().project.clips.p1 as VideoClip).volume).toBe(0.2);
    expect((S().project.clips.m1 as { volume: number }).volume).toBe(0.2);
  });
});
