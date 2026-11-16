import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClipFromAsset, createProject, getProjectDuration, useEditorStore, type MediaAsset, type Project, type VideoClip } from '../../../core';
import { DEFAULT_SILENCE_PARAMS } from '../analysis';
import { matchPreset, presetParams, SILENCE_PRESETS } from '../presets';
import { silenceDeps, useSilenceStore } from '../silenceStore';
import { buildSignal, SR } from './signals';

// 10 s: tone 0-2, silence 2-4, tone 4-6, silence 6-7, tone 7-10.
const signal = buildSignal([
  { kind: 'tone', sec: 2 },
  { kind: 'silence', sec: 2 },
  { kind: 'tone', sec: 2 },
  { kind: 'silence', sec: 1 },
  { kind: 'tone', sec: 3 },
]);

function project(): Project {
  const base = createProject({ fps: 30 });
  const v = base.tracks.find((t) => t.kind === 'video')!.id;
  const asset: MediaAsset = {
    id: 'vid',
    kind: 'video',
    name: 'vid',
    mimeType: 'video/webm',
    size: 1,
    duration: 10,
    width: 640,
    height: 360,
    hasAudio: true,
    status: 'ready',
    objectURL: 'blob:vid',
  };
  const vc = { ...(createClipFromAsset(asset, { trackId: v, start: 0 }) as VideoClip), id: 'vc' };
  return { ...base, assets: { vid: asset }, clips: { vc } };
}

describe('silence presets', () => {
  it('every preset round-trips through matchPreset; edited values become Custom', () => {
    for (const p of SILENCE_PRESETS) expect(matchPreset(presetParams(p.id))?.id).toBe(p.id);
    expect(matchPreset({ ...presetParams('tight'), paddingMs: 999 })).toBeNull();
    expect(matchPreset(DEFAULT_SILENCE_PARAMS)).toBeNull();
  });

  it('presets get progressively more aggressive', () => {
    const [natural, tight, jump] = ['natural', 'tight', 'jumpcut'].map(presetParams);
    expect(natural!.minSilenceMs).toBeGreaterThan(tight!.minSilenceMs);
    expect(tight!.minSilenceMs).toBeGreaterThan(jump!.minSilenceMs);
    expect(natural!.paddingMs).toBeGreaterThan(jump!.paddingMs);
  });
});

describe('silence store workflow', () => {
  beforeEach(() => {
    silenceDeps.decode = vi.fn(async () => ({ samples: signal, sampleRate: SR }));
    useSilenceStore.getState().clear();
    useSilenceStore.setState({ scope: 'timeline', includeNoAudio: false, notice: null });
    useSilenceStore.getState().applyPreset('natural');
    useEditorStore.getState().loadProject(project());
  });

  it('applyPreset keeps the advanced analysis settings', () => {
    useSilenceStore.getState().setParams({ windowMs: 35 });
    useSilenceStore.getState().applyPreset('jumpcut');
    expect(useSilenceStore.getState().params).toMatchObject({ ...SILENCE_PRESETS[2]!.params, windowMs: 35 });
  });

  it('re-detects automatically when a setting changes while a result is shown', async () => {
    await useSilenceStore.getState().detect();
    expect(useSilenceStore.getState().result!.ranges).toHaveLength(2);
    useSilenceStore.getState().setParams({ minSilenceMs: 1500 }); // the 1 s gap no longer qualifies
    await vi.waitFor(() => expect(useSilenceStore.getState().result!.ranges).toHaveLength(1), { timeout: 2000 });
  });

  it('does not start detection on a setting change when nothing was detected yet', async () => {
    useSilenceStore.getState().setParams({ minSilenceMs: 900 });
    await new Promise((r) => setTimeout(r, 450));
    expect(silenceDeps.decode).not.toHaveBeenCalled();
    expect(useSilenceStore.getState().result).toBeNull();
  });

  it('detectAndRemove cuts every silence in one undo step', async () => {
    const past = useEditorStore.getState().past.length;
    expect(await useSilenceStore.getState().detectAndRemove()).toBe(true);
    const dur = getProjectDuration(useEditorStore.getState().project);
    expect(dur).toBeLessThan(8);
    expect(dur).toBeGreaterThan(7);
    expect(useEditorStore.getState().past.length).toBe(past + 1);
    expect(useSilenceStore.getState().notice).toMatch(/Removed 2 silences/);
  });

  it('detectAndRemove reports when nothing qualifies', async () => {
    useSilenceStore.setState({ params: { ...useSilenceStore.getState().params, minSilenceMs: 5000 } });
    expect(await useSilenceStore.getState().detectAndRemove()).toBe(false);
    expect(useSilenceStore.getState().notice).toMatch(/No silences found/);
    expect(getProjectDuration(useEditorStore.getState().project)).toBeCloseTo(10, 6);
  });
});
