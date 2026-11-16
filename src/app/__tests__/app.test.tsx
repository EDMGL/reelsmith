import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createProject, panelRegistry, toolbarRegistry, inspectorRegistry, useEditorStore } from '../../core';
import { makeAsset } from '../../core/__tests__/fixtures';
import { App } from '../App';
import { featureModulePaths, registerFeatures } from '../registerFeatures';
import { handleShortcut } from '../shortcuts';

const S = () => useEditorStore.getState();

beforeAll(() => registerFeatures());
beforeEach(() => {
  S().loadProject(createProject());
  useEditorStore.setState({ hydrated: true });
});

describe('feature discovery', () => {
  it('finds every feature index and registers media + timeline contributions', () => {
    expect(featureModulePaths).toEqual(
      expect.arrayContaining(['../engine/index.ts', '../features/media/index.ts', '../features/timeline/index.ts', '../features/export/index.ts']),
    );
    expect(panelRegistry.get('media')).toBeDefined();
    expect(inspectorRegistry.get('core:clip')).toBeDefined();
  });
});

describe('App shell', () => {
  it('renders the shell with the lazy media panel and the aspect selector', async () => {
    render(<App />);
    expect(await screen.findByText('Import media')).toBeTruthy();
    expect(document.querySelector('.aspect-selector > button')!.textContent).toContain('1080×1920');
  });

  it('changing aspect ratio updates the project canvas size', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /9:16/ }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /16:9/ }));
    expect([S().project.width, S().project.height]).toEqual([1920, 1080]);
    expect(document.querySelector('.aspect-selector > button')!.textContent).toContain('1920×1080');
  });

  it('renders registered toolbar actions in the top bar', () => {
    let clicked = 0;
    const off = toolbarRegistry.register({ id: 'test-export', location: 'topbar', label: 'Export test', variant: 'primary', run: () => void clicked++ });
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Export test' }));
    expect(clicked).toBe(1);
    off();
  });

  it('shows clips on the timeline and the clip inspector when selected', () => {
    S().addAsset(makeAsset('a1', 8));
    const id = S().addAssetClip('a1')!;
    render(<App />);
    expect(document.querySelector(`[data-clip-id="${id}"]`)).toBeTruthy();
    expect(screen.getByText('Clip')).toBeTruthy(); // inspector section heading (clip is selected after insert)
  });
});

describe('keyboard shortcuts', () => {
  const key = (k: string, extra: Partial<KeyboardEventInit> = {}) =>
    act(() => {
      handleShortcut(new KeyboardEvent('keydown', { key: k, ...extra }));
    });

  it('space / S / delete / undo / redo / arrows / zoom', () => {
    S().addAsset(makeAsset('a1', 8));
    const id = S().addAssetClip('a1')!;
    key(' ');
    expect(S().isPlaying).toBe(true);
    key(' ');
    S().setCurrentTime(2);
    key('s');
    expect(Object.keys(S().project.clips)).toHaveLength(2);
    S().selectClips([id]);
    key('Delete');
    expect(S().project.clips[id]).toBeUndefined();
    key('z', { metaKey: true });
    expect(S().project.clips[id]).toBeDefined();
    key('z', { metaKey: true, shiftKey: true });
    expect(S().project.clips[id]).toBeUndefined();
    key('ArrowRight');
    expect(S().currentTime).toBeCloseTo(2 + 1 / 30);
    const z = S().zoom;
    key('+');
    expect(S().zoom).toBeGreaterThan(z);
  });
});
