import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClipFromAsset, createProject, useEditorStore, type ImageClip, type MediaAsset } from '../../../core';
import type { Pcm } from '../../music/synth/master';
import { applyDeps, applyTemplate } from '../apply';
import { findBuiltinTemplate } from '../catalogue';
import { ASSETS, asset } from './fixtures';

const E = () => useEditorStore.getState();
const pcm = (): Pcm => ({ sampleRate: 8000, channels: [new Float32Array(8000), new Float32Array(8000)] });
let musicAsset: MediaAsset;

beforeEach(() => {
  E().loadProject(createProject());
  for (const a of Object.values(ASSETS)) E().addAsset(a);
  vi.spyOn(applyDeps, 'renderMusic').mockImplementation(async () => pcm());
  vi.spyOn(applyDeps, 'ensureAsset').mockImplementation((_k, _p, name) => {
    musicAsset = { ...asset('music', 'audio', 0, 0, 120), name };
    E().addAsset(musicAsset);
    return musicAsset;
  });
});
afterEach(() => vi.restoreAllMocks());

const thenNow = findBuiltinTemplate('featured-then-and-now')!; // 4:5
const opts = { mode: 'append' as const, switchAspect: false };

describe('applyTemplate', () => {
  it('on an empty timeline: switches aspect, builds at 0 with music, as ONE undo step', async () => {
    const pastBefore = E().past.length;
    const r = await applyTemplate(thenNow, { s1: 'tall', s2: 'square' }, { then1: 'BACK THEN' }, opts);
    expect(r.ok).toBe(true);
    const p = E().project;
    expect(p.aspectPreset).toBe('4:5');
    expect(p.width / p.height).toBeCloseTo(4 / 5, 6);
    const clips = Object.values(p.clips);
    expect(clips.some((c) => c.type === 'audio' && c.assetId === 'music')).toBe(true);
    expect(clips.some((c) => c.type === 'text' && c.text === 'BACK THEN')).toBe(true);
    expect(Math.min(...clips.map((c) => c.start))).toBe(0);
    expect(E().past.length).toBe(pastBefore + 1);
    expect(E().past.at(-1)!.label).toBe('Apply template: Then & Now');
    E().undo();
    expect(Object.keys(E().project.clips)).toHaveLength(0);
    expect(E().project.aspectPreset).toBe('9:16');
    // The music render happened at the template's length.
    expect(vi.mocked(applyDeps.renderMusic).mock.calls[0]![2]).toBeCloseTo(thenNow.duration, 6);
  });

  it('append keeps existing work and the aspect unless asked', async () => {
    const main = E().project.tracks.find((t) => t.kind === 'video')!.id;
    E().addClip({ ...(createClipFromAsset(ASSETS.tallPhoto, { trackId: main, start: 0 }) as ImageClip), id: 'mine', duration: 5 });
    const r = await applyTemplate(thenNow, { s1: 'tall' }, {}, opts);
    expect(r.ok).toBe(true);
    expect(E().project.clips.mine).toBeDefined();
    expect(E().project.aspectPreset).toBe('9:16');
    const added = r.clipIds!.map((id) => E().project.clips[id]!);
    expect(Math.min(...added.map((c) => c.start))).toBe(5);
    expect(r.message).toMatch(/added after the end/);
  });

  it('replace clears the timeline (one undo brings it back)', async () => {
    const main = E().project.tracks.find((t) => t.kind === 'video')!.id;
    E().addClip({ ...(createClipFromAsset(ASSETS.tallPhoto, { trackId: main, start: 0 }) as ImageClip), id: 'mine', duration: 5 });
    E().addTrack('overlay', { name: 'Extra' });
    const r = await applyTemplate(thenNow, { s1: 'tall' }, {}, { mode: 'replace', switchAspect: true });
    expect(r.ok).toBe(true);
    expect(E().project.clips.mine).toBeUndefined();
    expect(E().project.tracks.some((t) => t.name === 'Extra')).toBe(false);
    expect(E().project.aspectPreset).toBe('4:5');
    E().undo();
    expect(E().project.clips.mine).toBeDefined();
    expect(E().project.aspectPreset).toBe('9:16');
  });

  it('replace refuses to touch locked tracks with clips', async () => {
    const main = E().project.tracks.find((t) => t.kind === 'video')!.id;
    E().addClip({ ...(createClipFromAsset(ASSETS.tallPhoto, { trackId: main, start: 0 }) as ImageClip), id: 'mine', duration: 5 });
    E().updateTrack(main, { locked: true });
    const before = E().project;
    const r = await applyTemplate(thenNow, { s1: 'tall' }, {}, { mode: 'replace', switchAspect: false });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Unlock/);
    expect(E().project).toBe(before);
  });

  it('fails cleanly without media, and still applies when music generation fails', async () => {
    const none = await applyTemplate(thenNow, {}, {}, opts);
    expect(none.ok).toBe(false);
    expect(none.message).toMatch(/at least one photo or video/);
    vi.mocked(applyDeps.renderMusic).mockRejectedValueOnce(new Error('no audio'));
    const r = await applyTemplate(thenNow, { s1: 'tall' }, {}, opts);
    expect(r.ok).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/music could not be generated/);
    expect(Object.values(E().project.clips).some((c) => c.type === 'audio')).toBe(false);
  });
});
