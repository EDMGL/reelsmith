import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject, useEditorStore, type MediaAsset, type VideoClip } from '../../../core';
import { bubbleLayout } from '../layout';
import { cancelRecording, recorderDeps, startRecording, stopRecording, useRecorderStore } from '../recorderStore';

const E = () => useEditorStore.getState();

describe('bubbleLayout', () => {
  it('circle: diameter is a share of the short side, placed in the corner above the caption zone', () => {
    const { transform, shape } = bubbleLayout(1280, 720, 1920, 1080, { corner: 'bottom-left', size: 'medium', shape: 'circle' });
    // camera contained in 1920x1080 = 1920x1080 -> circle diameter 1080 at scale 1; want 0.3 * 1080
    expect(transform.scale).toBeCloseTo(0.3);
    const r = (0.3 * 1080) / 2;
    expect(transform.x * 1920).toBeCloseTo(0.05 * 1080 + r);
    expect(transform.y * 1080).toBeCloseTo(1080 - 0.05 * 1080 - r);
    expect(shape.kind).toBe('circle');
    expect(shape.border).toBeGreaterThan(0);
  });

  it('rounded keeps the camera aspect; top-right corner; tall canvases keep clear of captions', () => {
    const r = bubbleLayout(1280, 720, 1920, 1080, { corner: 'top-right', size: 'small', shape: 'rounded' });
    const w = 0.22 * 1.4 * 1080;
    expect(r.transform.scale * 1920).toBeCloseTo(w);
    expect(r.transform.x * 1920).toBeCloseTo(1920 - 0.05 * 1080 - w / 2);
    const tall = bubbleLayout(1280, 720, 1080, 1920, { corner: 'bottom-right', size: 'small', shape: 'circle' });
    expect(tall.transform.y * 1920).toBeLessThan(1920 * 0.82);
  });
});

describe('recording flow', () => {
  const track = (kind: string, settings = {}) => {
    const listeners: Record<string, () => void> = {};
    return {
      kind,
      stop: vi.fn(),
      getSettings: () => settings,
      addEventListener: (ev: string, fn: () => void) => (listeners[ev] = fn),
      fire: (ev: string) => listeners[ev]?.(),
    };
  };
  const stream = (tracks: ReturnType<typeof track>[]) =>
    ({
      getTracks: () => tracks,
      getVideoTracks: () => tracks.filter((t) => t.kind === 'video'),
      getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
    }) as unknown as MediaStream;

  let screenVideo: ReturnType<typeof track>;
  let recorded: string[][];

  beforeEach(() => {
    E().loadProject(createProject());
    useRecorderStore.setState({ status: 'idle', sources: { screen: true, camera: true, mic: true }, useCountdown: false, preview: null, screenPreview: null, takes: 0, message: null, corner: 'bottom-right', size: 'medium', shape: 'circle' });
    screenVideo = track('video', { width: 1920, height: 1080 });
    recorded = [];
    recorderDeps.openScreen = vi.fn(async () => stream([screenVideo, track('audio')]));
    recorderDeps.openCamera = vi.fn(async () => stream([track('video')]));
    recorderDeps.openMic = vi.fn(async () => stream([track('audio')]));
    recorderDeps.record = vi.fn((tracks: MediaStreamTrack[]) => {
      recorded.push(tracks.map((t) => t.kind));
      return { start: vi.fn(), stop: vi.fn(async () => new Blob(['x'], { type: 'video/webm' })) };
    });
    recorderDeps.makeSeekable = vi.fn(async (b: Blob) => ({ blob: b, ext: '.webm' }));
    recorderDeps.tick = () => () => undefined;
    recorderDeps.wait = vi.fn(async () => undefined);
    let n = 0;
    recorderDeps.importFile = vi.fn(async (file: File) => {
      const cam = file.name.startsWith('Camera');
      const a: MediaAsset = { id: `a${++n}`, kind: 'video', name: file.name, mimeType: file.type, size: 1, duration: 5, width: cam ? 1280 : 1920, height: cam ? 720 : 1080, hasAudio: true, status: 'ready', objectURL: 'blob:x' };
      E().addAsset(a);
      return a.id;
    });
  });

  it('screen + camera + mic: two takes (mic with the camera), placed together as screen + camera bubble', async () => {
    await startRecording();
    expect(useRecorderStore.getState().status).toBe('recording');
    expect(recorded).toEqual([
      ['video', 'audio'], // screen video + screen audio
      ['video', 'audio'], // camera video + mic
    ]);
    const past = E().past.length;
    expect(await stopRecording()).toBe(true);
    const p = E().project;
    expect([p.width, p.height]).toEqual([1920, 1080]); // empty project took the screen's shape
    const clips = Object.values(p.clips) as VideoClip[];
    expect(clips).toHaveLength(2);
    const screenClip = clips.find((c) => p.assets[c.assetId]!.name.startsWith('Screen'))!;
    const camClip = clips.find((c) => p.assets[c.assetId]!.name.startsWith('Camera'))!;
    expect(p.tracks.find((t) => t.id === screenClip.trackId)!.kind).toBe('video');
    expect(p.tracks.find((t) => t.id === camClip.trackId)!.kind).toBe('overlay');
    expect(screenClip.start).toBe(0);
    expect(camClip.start).toBe(0);
    expect(camClip.shape?.kind).toBe('circle');
    expect(camClip.transform.x).toBeGreaterThan(0.5); // bottom-right
    expect(E().past.length).toBe(past + 1);
    expect(E().selectedClipIds).toHaveLength(2);
    expect(useRecorderStore.getState()).toMatchObject({ status: 'idle', takes: 1, preview: null });
  });

  it('screen + mic without camera: the mic is mixed into the screen take', async () => {
    useRecorderStore.setState({ sources: { screen: true, camera: false, mic: true } });
    const mixed = track('audio');
    recorderDeps.mixAudio = vi.fn(() => ({ track: mixed as unknown as MediaStreamTrack, close: vi.fn() }));
    await startRecording();
    expect(recorderDeps.mixAudio).toHaveBeenCalled();
    expect(recorded).toEqual([['video', 'audio']]);
    await stopRecording();
    expect(Object.values(E().project.clips)).toHaveLength(1);
  });

  it('camera only goes full frame on the main video track', async () => {
    useRecorderStore.setState({ sources: { screen: false, camera: true, mic: true } });
    await startRecording();
    await stopRecording();
    const [clip] = Object.values(E().project.clips) as VideoClip[];
    expect(E().project.tracks.find((t) => t.id === clip!.trackId)!.kind).toBe('video');
    expect(clip!.shape).toBeUndefined();
  });

  it("the browser's Stop sharing ends the take; a cancelled picker reports nicely", async () => {
    await startRecording();
    screenVideo.fire('ended');
    await vi.waitFor(() => expect(useRecorderStore.getState().takes).toBe(1));

    recorderDeps.openScreen = vi.fn(async () => {
      throw new DOMException('no', 'NotAllowedError');
    });
    await startRecording();
    expect(useRecorderStore.getState()).toMatchObject({ status: 'idle', message: { kind: 'error', text: 'Screen sharing was cancelled.' } });
  });

  it('cancel discards everything', async () => {
    await startRecording();
    cancelRecording();
    expect(useRecorderStore.getState().status).toBe('idle');
    expect(recorderDeps.importFile).not.toHaveBeenCalled();
    expect(Object.keys(E().project.clips)).toHaveLength(0);
  });
});
