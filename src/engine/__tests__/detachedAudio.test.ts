/**
 * "Detach audio": an `audio` clip referencing a VIDEO asset (same assetId,
 * sourceIn/sourceOut/speed) while the video clip's own audio is silenced with
 * volume 0. Preview must play the sound from an <audio> element of the video
 * file (never use it for the picture) and do no audio work for the silenced
 * video; the mixdown must schedule only the audio clip.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClipFromAsset, createProject, useEditorStore, type AudioClip, type Project, type VideoClip } from '../../core';
import { makeAsset } from '../../core/__tests__/fixtures';
import { planAudioMix, renderAudioMix } from '../audioMix';
import { ErdemcutEngine } from '../engine';
import { mediaNeedsAt } from '../timeline';
import { FakeVideo, fakeElementFactory } from './fakes';

const S = () => useEditorStore.getState();

function detachedProject(): Project {
  const p = createProject();
  const v = p.tracks.find((t) => t.kind === 'video')!.id;
  const a = p.tracks.find((t) => t.kind === 'audio')!.id;
  const asset = makeAsset('vid', 10);
  const base = createClipFromAsset(asset, { trackId: v, start: 0 }) as VideoClip;
  const video: VideoClip = { ...base, id: 'v', sourceIn: 2, sourceOut: 6, duration: 2, speed: 2, volume: 0 };
  const audio: AudioClip = {
    id: 'a',
    type: 'audio',
    trackId: a,
    start: 0,
    duration: 2,
    name: 'v (audio)',
    effects: [],
    fadeIn: 0,
    fadeOut: 0,
    assetId: asset.id,
    sourceIn: 2,
    sourceOut: 6,
    speed: 2,
    volume: 1,
  };
  return { ...p, assets: { vid: asset }, clips: { v: video, a: audio } };
}

let engine: ErdemcutEngine | null = null;
beforeEach(() => {
  FakeVideo.created = [];
  S().loadProject(detachedProject());
});
afterEach(() => {
  engine?.dispose();
  engine = null;
  S().pause();
});

describe('detached audio (audio clip on a video asset)', () => {
  it('needs: the video clip only for its picture, the audio clip for sound', () => {
    const needs = mediaNeedsAt(S().project, 0.5);
    expect(needs.map((n) => [n.clip.id, n.video, n.audio])).toEqual([
      ['a', false, true],
      ['v', true, false],
    ]);
  });

  it('preview: plays an <audio> element of the video file at the mapped time; the silent video gets no audio route', () => {
    const connected: unknown[] = [];
    const gains: { gain: { value: number; cancelScheduledValues(): void; setTargetAtTime(v: number): void } }[] = [];
    const fakeAudioCtx = {
      state: 'running',
      currentTime: 0,
      destination: {},
      resume: async () => undefined,
      close: async () => undefined,
      createMediaElementSource: (el: unknown) => {
        connected.push(el);
        return { connect: () => undefined, disconnect: () => undefined };
      },
      createGain: () => {
        const g = {
          gain: { value: 0, cancelScheduledValues() {}, setTargetAtTime(v: number) { g.gain.value = v; } },
          connect: () => undefined,
          disconnect: () => undefined,
        };
        gains.push(g);
        return g;
      },
    } as unknown as AudioContext;
    const queue: (() => void)[] = [];
    engine = new ErdemcutEngine({
      now: () => 0,
      requestFrame: (cb) => queue.push(cb),
      cancelFrame: () => undefined,
      createElement: fakeElementFactory,
      createLayer: () => null,
      createAudioContext: () => fakeAudioCtx,
    });
    S().setCurrentTime(0.5);
    S().play();
    const audioSlot = engine.previewPool.get('a')!;
    const videoSlot = engine.previewPool.get('v')!;
    expect(audioSlot.kind).toBe('audio');
    expect(audioSlot.url).toBe('blob:vid');
    expect((audioSlot.el as unknown as FakeVideo).currentTime).toBeCloseTo(3); // 2 + 0.5 * 2
    expect(audioSlot.el.playbackRate).toBe(2);
    expect(videoSlot.kind).toBe('video');
    // Only the detached audio element is routed through Web Audio; the volume-0 video stays muted.
    expect(connected).toEqual([audioSlot.el]);
    expect(videoSlot.source).toBeUndefined();
    expect(videoSlot.el.muted).toBe(true);
    expect(gains[0]!.gain.value).toBe(1);
  });

  it('the picture lookup never falls back to the <audio> element', () => {
    engine = new ErdemcutEngine({
      now: () => 0,
      requestFrame: () => 0,
      cancelFrame: () => undefined,
      createElement: fakeElementFactory,
      createLayer: () => null,
      createAudioContext: () => null,
    });
    engine.previewPool.acquire('a', 'audio', 'vid', 'blob:vid');
    expect(engine.previewPool.findByAsset('vid', 0, 'video')).toBeUndefined();
    expect(engine.previewPool.findByAsset('vid', 0)?.kind).toBe('audio');
  });

  it('mixdown schedules the detached audio clip from the video file and skips the volume-0 video', async () => {
    const p = S().project;
    const plan = planAudioMix(p, 0, 2);
    expect(plan.map((s) => [s.clipId, s.assetId, s.offset, s.playbackRate])).toEqual([['a', 'vid', 2, 2]]);
    const decoded: string[] = [];
    const log: string[] = [];
    const ctxFactory = (channels: number, length: number, sampleRate: number) =>
      ({
        sampleRate,
        destination: {},
        createBuffer: () => ({ silent: true }),
        createBufferSource: () => ({
          buffer: null,
          playbackRate: { value: 1 },
          connect: () => undefined,
          start: (w: number, o: number) => log.push(`start ${w} ${o}`),
          stop: () => undefined,
        }),
        createGain: () => ({ gain: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect: () => undefined }),
        startRendering: async () => ({ channels, length, silent: false }),
      }) as unknown as OfflineAudioContext;
    const out = (await renderAudioMix(p, { start: 0, end: 2, sampleRate: 1000, channels: 1 }, ctxFactory, async (asset) => {
      decoded.push(asset.id);
      return { duration: 10 } as AudioBuffer;
    })) as unknown as { silent: boolean };
    expect(out.silent).toBe(false);
    expect(decoded).toEqual(['vid']);
    expect(log).toEqual(['start 0 2']);
  });

  it('a video asset without an audio track makes its detached audio clip silent', () => {
    const p = S().project;
    const silent = { ...p, assets: { vid: { ...p.assets.vid!, hasAudio: false } } };
    expect(planAudioMix(silent, 0, 2)).toEqual([]);
    expect(mediaNeedsAt(silent, 0.5).map((n) => n.clip.id)).toEqual(['v']);
  });
});
