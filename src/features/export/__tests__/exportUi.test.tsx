import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createClipFromAsset,
  createProject,
  setEngine,
  useEditorStore,
  type MediaAsset,
  type PlaybackEngine,
  type Project,
  type VideoClip,
} from '../../../core';
import ExportDialog from '../ExportDialog';
import { exportDeps, useExportStore } from '../exportStore';
import { makeWorld } from './fakes';

function projectWithClip(): Project {
  const p = createProject({ fps: 30 });
  const v = p.tracks.find((t) => t.kind === 'video')!.id;
  const asset: MediaAsset = {
    id: 'a',
    kind: 'video',
    name: 'a.webm',
    mimeType: 'video/webm',
    size: 1,
    duration: 0.5,
    width: 64,
    height: 36,
    hasAudio: true,
    status: 'ready',
    objectURL: 'blob:a',
  };
  const c = { ...(createClipFromAsset(asset, { trackId: v, start: 0 }) as VideoClip), id: 'c' };
  return { ...p, assets: { a: asset }, clips: { c } };
}

const allSupported = { video: async () => true, audio: async () => true };

describe('export dialog + controller', () => {
  beforeEach(() => {
    exportDeps.codecApi = allSupported;
    exportDeps.pickSaveHandle = async () => null;
    exportDeps.download = vi.fn();
    URL.createObjectURL = vi.fn(() => 'blob:out');
    URL.revokeObjectURL = vi.fn();
    useExportStore.setState({ open: false, settings: null, status: 'idle', error: null, result: null, progress: null });
  });
  afterEach(() => {
    cleanup();
    setEngine(null);
  });

  it('without an engine the dialog says so and disables Export (no crash)', async () => {
    setEngine(null);
    useEditorStore.getState().loadProject(projectWithClip());
    await act(async () => useExportStore.getState().openDialog());
    render(<ExportDialog />);
    expect(screen.getByText(/render engine is not loaded/)).toBeTruthy();
    const btn = screen.getAllByRole('button', { name: 'Export' }).at(-1)! as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    await act(async () => useExportStore.getState().start());
    expect(useExportStore.getState().error).toMatch(/engine is not loaded/);
  });

  it('empty project is reported', async () => {
    setEngine({ play() {}, pause() {}, seek() {}, dispose() {}, renderFrame: async () => {}, mixAudio: async () => ({}) as AudioBuffer });
    useEditorStore.getState().loadProject(createProject());
    await act(async () => useExportStore.getState().openDialog());
    render(<ExportDialog />);
    expect(screen.getByText(/Nothing to export/)).toBeTruthy();
  });

  it('start(): pauses playback, runs the pipeline with the engine and downloads the file', async () => {
    const world = makeWorld();
    const engine: PlaybackEngine = { play() {}, pause() {}, seek() {}, dispose() {}, ...world.deps.engine };
    setEngine(engine);
    exportDeps.makeDeps = (e) => ({ ...world.deps, engine: e });
    useEditorStore.getState().loadProject(projectWithClip());
    useEditorStore.setState({ isPlaying: true });
    await act(async () => useExportStore.getState().openDialog());
    await act(async () => useExportStore.getState().start());
    const s = useExportStore.getState();
    expect(s.error).toBeNull();
    expect(s.status).toBe('done');
    expect(useEditorStore.getState().isPlaying).toBe(false);
    expect(world.renders).toHaveLength(15); // 0.5 s at 30 fps
    expect(exportDeps.download).toHaveBeenCalledWith('blob:out', 'Untitled project.mp4');
    expect(s.result).toMatchObject({ fileName: 'Untitled project.mp4', savedTo: 'download' });
  });

  it('dismissing the save picker does not start the export', async () => {
    const world = makeWorld();
    setEngine({ play() {}, pause() {}, seek() {}, dispose() {}, ...world.deps.engine });
    exportDeps.makeDeps = (e) => ({ ...world.deps, engine: e });
    exportDeps.pickSaveHandle = async () => {
      const e = new Error('dismissed');
      e.name = 'AbortError';
      throw e;
    };
    useEditorStore.getState().loadProject(projectWithClip());
    await act(async () => useExportStore.getState().openDialog());
    await act(async () => useExportStore.getState().start());
    expect(world.renders).toHaveLength(0);
    expect(useExportStore.getState().status).toBe('idle');
  });
});
