import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject, useEditorStore } from '../../../core';
import { previewDeps, resetPreview, stopPreview, togglePreview, usePreviewStore } from '../preview';
import type { Pcm } from '../synth/master';

const pcm: Pcm = { sampleRate: 8000, channels: [new Float32Array(800), new Float32Array(800)] };

interface FakeSource {
  started: boolean;
  stopped: boolean;
  onended: (() => void) | null;
}

let sources: FakeSource[] = [];

function fakeContext(): AudioContext {
  const node = () => ({ connect: (n: unknown) => n, disconnect() {} });
  return {
    currentTime: 0,
    destination: node(),
    resume: async () => undefined,
    createBuffer: (c: number, l: number, r: number) => ({ numberOfChannels: c, length: l, sampleRate: r, duration: l / r, copyToChannel() {} }),
    createGain: () => ({ ...node(), gain: { value: 1 } }),
    createAnalyser: () => ({ ...node(), fftSize: 1024, getFloatTimeDomainData() {} }),
    createBufferSource: () => {
      const s: FakeSource & Record<string, unknown> = {
        ...node(),
        buffer: null,
        started: false,
        stopped: false,
        onended: null,
        start() {
          s.started = true;
        },
        stop() {
          s.stopped = true;
        },
      };
      sources.push(s);
      return s;
    },
  } as unknown as AudioContext;
}

const E = () => useEditorStore.getState();

beforeEach(() => {
  sources = [];
  resetPreview();
  vi.spyOn(previewDeps, 'createContext').mockImplementation(fakeContext);
  vi.spyOn(previewDeps, 'frame').mockImplementation(() => () => undefined);
  E().loadProject(createProject());
});

afterEach(() => {
  resetPreview();
  vi.restoreAllMocks();
});

describe('preview exclusivity', () => {
  it('plays one item at a time', async () => {
    await togglePreview('a', async () => pcm);
    expect(usePreviewStore.getState().playingKey).toBe('a');
    await togglePreview('b', async () => pcm);
    expect(usePreviewStore.getState().playingKey).toBe('b');
    expect(sources[0]!.stopped).toBe(true);
    expect(sources[1]!.started).toBe(true);
    expect(sources[1]!.stopped).toBe(false);
  });

  it('toggling the playing item stops it', async () => {
    await togglePreview('a', async () => pcm);
    await togglePreview('a', async () => pcm);
    expect(usePreviewStore.getState().playingKey).toBeNull();
    expect(sources[0]!.stopped).toBe(true);
  });

  it('a newer request wins over a slower pending render', async () => {
    let release!: () => void;
    const slow = togglePreview('slow', () => new Promise<Pcm>((r) => (release = () => r(pcm))));
    expect(usePreviewStore.getState().loadingKey).toBe('slow');
    await togglePreview('fast', async () => pcm);
    release();
    await slow;
    expect(usePreviewStore.getState().playingKey).toBe('fast');
    expect(sources).toHaveLength(1);
  });

  it('starting a preview pauses the timeline; playing the timeline stops the preview', async () => {
    E().setCurrentTime(0);
    E().play();
    expect(E().isPlaying).toBe(true);
    await togglePreview('a', async () => pcm);
    expect(E().isPlaying).toBe(false);
    expect(usePreviewStore.getState().playingKey).toBe('a');
    E().play();
    expect(usePreviewStore.getState().playingKey).toBeNull();
    expect(sources[0]!.stopped).toBe(true);
  });

  it('stops by itself at the end of the sound', async () => {
    await togglePreview('a', async () => pcm);
    sources[0]!.onended?.();
    expect(usePreviewStore.getState().playingKey).toBeNull();
    stopPreview();
  });
});
