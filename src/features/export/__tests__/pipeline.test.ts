import { describe, expect, it } from 'vitest';
import { AUDIO_CHUNK_FRAMES, ExportError, MAX_VIDEO_QUEUE, runExport, type ExportProgress } from '../pipeline';
import { frameDurationUs, frameTimestampUs } from '../plan';
import { CODECS, fakeAudio, makeWorld, plan } from './fakes';

describe('runExport orchestration', () => {
  it('renders every frame, encodes with correct timestamps/keyframes, interleaves audio, finalizes', async () => {
    const w = makeWorld({ audio: fakeAudio(2.5) });
    const progress: ExportProgress[] = [];
    const p = plan({ duration: 2.5, frameCount: 75, fps: 30 });
    const blob = await runExport(p, CODECS, w.deps, { onProgress: (x) => progress.push(x) });

    expect(blob.size).toBeGreaterThan(0);
    expect(w.mixCalls).toEqual([{ start: 0, end: 2.5, sampleRate: 48000, channels: 2 }]);
    expect(w.renders).toHaveLength(75);
    w.renders.forEach((r, i) => {
      expect(r.t).toBeCloseTo(i / 30, 9);
      expect(r.opts).toEqual({ isExport: true, width: 64, height: 36 });
    });
    expect(w.frames.map((f) => f.timestamp)).toEqual(Array.from({ length: 75 }, (_, i) => frameTimestampUs(i, 30)));
    expect(w.frames.every((f, i) => f.duration === frameDurationUs(i, 30) && f.closed)).toBe(true);
    // Muxer saw all video chunks in order, key frames every 60 frames (2 s), decoder config on the first.
    expect(w.muxVideo).toHaveLength(75);
    expect(w.muxVideo.filter((c) => c.type === 'key').map((c) => c.timestamp)).toEqual([0, frameTimestampUs(60, 30)]);
    expect(w.muxVideo[0]!.hasMeta).toBe(true);
    // Audio: every sample encoded exactly once, contiguous timestamps.
    const totalAudio = w.audioData.reduce((s, a) => s + a.numberOfFrames, 0);
    expect(totalAudio).toBe(2.5 * 48000);
    expect(w.audioData.every((a) => a.closed && a.numberOfFrames <= AUDIO_CHUNK_FRAMES)).toBe(true);
    let pos = 0;
    for (const a of w.audioData) {
      expect(a.timestamp).toBe(Math.round((pos * 1e6) / 48000));
      pos += a.numberOfFrames;
    }
    expect(w.muxAudio.length).toBe(w.audioData.length);
    expect(w.video().config).toMatchObject({ codec: 'avc1.640028' });
    expect(w.audio()!.config).toMatchObject({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2 });
    expect(w.muxer.finalized).toBe(true);
    expect(w.muxer.canceled).toBe(false);
    expect(w.muxer.opts).toEqual({ container: 'mp4', videoCodec: 'avc', audioCodec: 'aac', fps: 30, mimeType: 'video/mp4' });
    expect(w.video().state).toBe('closed');
    // Progress: audio phase, frames, then finalizing at 100 %, with an ETA while encoding.
    expect(progress[0]!.phase).toBe('audio');
    expect(progress.some((x) => x.phase === 'video' && x.etaMs !== null)).toBe(true);
    expect(progress.at(-1)).toMatchObject({ phase: 'finalizing', framesDone: 75, totalFrames: 75, fraction: 1 });
  });

  it('skips audio when no audio codec was selected', async () => {
    const w = makeWorld();
    await runExport(plan({ frameCount: 3, duration: 0.1 }), { ...CODECS, audio: null }, w.deps);
    expect(w.mixCalls).toHaveLength(0);
    expect(w.audio()).toBeNull();
    expect(w.muxVideo).toHaveLength(3);
  });

  it('respects encoder backpressure', async () => {
    const w = makeWorld({ encoderDelayMs: 2 });
    await runExport(plan({ frameCount: 40, duration: 40 / 30 }), { ...CODECS, audio: null }, w.deps);
    expect(w.video().maxQueueSeen).toBeLessThanOrEqual(MAX_VIDEO_QUEUE + 1);
    expect(w.muxVideo).toHaveLength(40);
  });

  it('cancel aborts, frees encoders and cancels the muxer', async () => {
    const w = makeWorld();
    const ctl = new AbortController();
    const orig = w.deps.engine.renderFrame;
    w.deps.engine.renderFrame = async (t, ctx, o) => {
      await orig(t, ctx, o);
      if (w.renders.length === 5) ctl.abort();
    };
    await expect(runExport(plan({ frameCount: 300, duration: 10 }), CODECS, w.deps, { signal: ctl.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(w.renders.length).toBe(5);
    expect(w.muxer.canceled).toBe(true);
    expect(w.muxer.finalized).toBe(false);
    expect(w.video().state).toBe('closed');
    expect(w.audio()!.state).toBe('closed');
  });

  it('an already-aborted signal does nothing', async () => {
    const w = makeWorld();
    const ctl = new AbortController();
    ctl.abort();
    await expect(runExport(plan(), CODECS, w.deps, { signal: ctl.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(w.renders).toHaveLength(0);
  });

  it('reports encoder errors readably and cleans up', async () => {
    const w = makeWorld();
    const orig = w.deps.engine.renderFrame;
    w.deps.engine.renderFrame = async (t, ctx, o) => {
      await orig(t, ctx, o);
      if (w.renders.length === 3) w.video().triggerError('hardware encoder lost');
    };
    const err = await runExport(plan(), CODECS, w.deps).catch((e) => e);
    expect(err).toBeInstanceOf(ExportError);
    expect(err.message).toMatch(/Video encoder error: hardware encoder lost/);
    expect(w.muxer.canceled).toBe(true);
    expect(w.audio()!.state).toBe('closed');
  });

  it('reports render failures with the frame number', async () => {
    const w = makeWorld({ renderError: 4 });
    await expect(runExport(plan(), CODECS, w.deps)).rejects.toThrow(/Rendering frame 5 \(0\.13 s\) failed: decoder stalled/);
    expect(w.muxer.canceled).toBe(true);
  });

  it('reports audio mix failures', async () => {
    const w = makeWorld({ audio: new Error('no OfflineAudioContext') });
    await expect(runExport(plan(), CODECS, w.deps)).rejects.toThrow(/Mixing the audio failed: no OfflineAudioContext/);
  });

  it('rejects an empty project', async () => {
    const w = makeWorld();
    await expect(runExport(plan({ frameCount: 0, duration: 0 }), CODECS, w.deps)).rejects.toThrow(/timeline is empty/);
  });

  it('muxer write failures surface as errors', async () => {
    const w = makeWorld();
    w.muxer.addVideoChunk = async () => {
      throw new Error('quota exceeded');
    };
    await expect(runExport(plan(), CODECS, w.deps)).rejects.toThrow(/Writing the file failed: quota exceeded/);
  });
});
