import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClipFromAsset, createProject, getTrackClips, useEditorStore, type AudioClip, type MediaAsset, type Project, type VideoClip } from '../../../core';
import { findSfx, findTrack } from '../catalogue';
import { libraryDeps, pcmCache } from '../library';
import type { Pcm } from '../synth/master';
import { addMusicToTimeline, addSfxToTimeline, assetDeps, DEFAULT_MUSIC_OPTIONS, findFreeAudioTrack, musicDragTemplate, planMusic, resetAssetMemo } from '../timeline';

const E = () => useEditorStore.getState();
const RATE = 8000;

function loopPcm(seconds: number): Pcm {
  const n = Math.round(seconds * RATE);
  const ch = Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 200 * i) / RATE));
  return { sampleRate: RATE, channels: [ch, ch.slice()] };
}

function projectWithVideo(seconds: number): Project {
  const base = createProject();
  const v = base.tracks.find((t) => t.kind === 'video')!.id;
  const vid: MediaAsset = { id: 'vid', kind: 'video', name: 'v.mp4', mimeType: 'video/mp4', size: 1, duration: seconds, width: 1, height: 1, hasAudio: true, status: 'ready', objectURL: 'blob:v' };
  const clip = { ...(createClipFromAsset(vid, { trackId: v, start: 0 }) as VideoClip), id: 'vc' };
  return { ...base, assets: { vid }, clips: { vc: clip } };
}

const track = findTrack('lofi-lazy-sunday')!;
const sfx = findSfx('sfx-whoosh')!;
let persisted: string[] = [];

beforeEach(() => {
  pcmCache.clear();
  resetAssetMemo();
  persisted = [];
  vi.spyOn(libraryDeps, 'renderMusic').mockImplementation(async () => ({ pcm: loopPcm(7), ms: 1, lufs: -16, peak: 0.5 }));
  vi.spyOn(libraryDeps, 'renderSfx').mockImplementation(async () => ({ pcm: loopPcm(0.8), ms: 1, lufs: -14, peak: 0.5 }));
  vi.spyOn(assetDeps, 'createObjectURL').mockImplementation(() => 'blob:music');
  vi.spyOn(assetDeps, 'persist').mockImplementation(async (id) => {
    persisted.push(id);
  });
  E().loadProject(projectWithVideo(20));
});

afterEach(() => vi.restoreAllMocks());

describe('planMusic', () => {
  it('fits to the project, or uses fixed lengths', () => {
    const p = projectWithVideo(20);
    expect(planMusic(p, 5, { length: 'fit', startAt: 'zero' })).toEqual({ start: 0, duration: 20 });
    expect(planMusic(p, 5, { length: 'fit', startAt: 'playhead' })).toEqual({ start: 5, duration: 15 });
    expect(planMusic(p, 5, { length: 30, startAt: 'playhead' })).toEqual({ start: 5, duration: 30 });
    expect(planMusic(createProject(), 0, { length: 'fit', startAt: 'zero' }).duration).toBe(30);
  });
});

describe('add music to the timeline', () => {
  it('loops the track to the project length on the empty audio track, with volume/fades, as one undo step', async () => {
    const pastBefore = E().past.length;
    const r = await addMusicToTimeline(track, 101, DEFAULT_MUSIC_OPTIONS);
    expect(r.ok).toBe(true);
    const clip = E().project.clips[r.clipId!] as AudioClip;
    expect(clip.type).toBe('audio');
    expect(clip.start).toBe(0);
    expect(clip.duration).toBeCloseTo(20, 3);
    expect(clip.volume).toBe(0.3);
    expect(clip.fadeIn).toBe(0.5);
    expect(clip.fadeOut).toBe(2);
    const asset = E().project.assets[clip.assetId]!;
    expect(asset.kind).toBe('audio');
    expect(asset.mimeType).toBe('audio/wav');
    expect(asset.duration).toBeCloseTo(20, 3);
    expect(asset.blob!.size).toBe(44 + 20 * RATE * 4);
    expect(asset.waveform!.length).toBeGreaterThan(100);
    expect(persisted).toEqual([asset.id]);
    // The project's (empty) default audio track was used.
    expect(E().project.tracks.find((t) => t.id === clip.trackId)!.kind).toBe('audio');
    expect(E().past.length).toBe(pastBefore + 1);
    E().undo();
    expect(E().project.clips[r.clipId!]).toBeUndefined();
  });

  it('creates a "Music" track when no audio track is free, and undo removes clip and track together', async () => {
    const audio = E().project.tracks.find((t) => t.kind === 'audio')!;
    const vo: MediaAsset = { id: 'vo', kind: 'audio', name: 'vo.wav', mimeType: 'audio/wav', size: 1, duration: 5, width: 0, height: 0, hasAudio: true, status: 'ready', objectURL: 'blob:vo' };
    E().addAsset(vo);
    E().addClip({ ...(createClipFromAsset(vo, { trackId: audio.id, start: 2 }) as AudioClip), id: 'voc' });
    const tracksBefore = E().project.tracks.length;
    const pastBefore = E().past.length;
    const r = await addMusicToTimeline(track, 102, { ...DEFAULT_MUSIC_OPTIONS, length: 15, volume: 0.25 });
    expect(r.ok).toBe(true);
    const clip = E().project.clips[r.clipId!] as AudioClip;
    const t = E().project.tracks.find((x) => x.id === clip.trackId)!;
    expect(t.name).toBe('Music');
    expect(t.kind).toBe('audio');
    expect(clip.duration).toBeCloseTo(15, 3);
    expect(clip.volume).toBe(0.25);
    expect(E().project.tracks.length).toBe(tracksBefore + 1);
    expect(E().past.length).toBe(pastBefore + 1);
    E().undo();
    expect(E().project.tracks.length).toBe(tracksBefore);
    expect(E().project.clips[r.clipId!]).toBeUndefined();
    // Second add goes to "Music 2" when "Music" is busy.
    E().redo();
    const r2 = await addMusicToTimeline(track, 102, { ...DEFAULT_MUSIC_OPTIONS, length: 15 });
    const t2 = E().project.tracks.find((x) => x.id === (E().project.clips[r2.clipId!] as AudioClip).trackId)!;
    expect(t2.name).toBe('Music 2');
  });

  it('reuses the generated asset for an identical render', async () => {
    const a = await addMusicToTimeline(track, 101, { ...DEFAULT_MUSIC_OPTIONS, length: 15 });
    const b = await addMusicToTimeline(track, 101, { ...DEFAULT_MUSIC_OPTIONS, length: 15 });
    const ca = E().project.clips[a.clipId!] as AudioClip;
    const cb = E().project.clips[b.clipId!] as AudioClip;
    expect(ca.assetId).toBe(cb.assetId);
    expect(libraryDeps.renderMusic).toHaveBeenCalledTimes(1);
  });

  it('starts at the playhead when asked', async () => {
    E().setCurrentTime(6);
    const r = await addMusicToTimeline(track, 101, { ...DEFAULT_MUSIC_OPTIONS, startAt: 'playhead' });
    const clip = E().project.clips[r.clipId!] as AudioClip;
    expect(clip.start).toBe(6);
    expect(clip.duration).toBeCloseTo(14, 3);
  });

  it('reports render errors instead of failing silently', async () => {
    vi.mocked(libraryDeps.renderMusic).mockRejectedValueOnce(new Error('boom'));
    const r = await addMusicToTimeline(track, 103, DEFAULT_MUSIC_OPTIONS);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/boom/);
  });

  it('drag template is available only once rendered', async () => {
    expect(musicDragTemplate(track, 101, DEFAULT_MUSIC_OPTIONS)).toBeNull();
    await addMusicToTimeline(track, 101, DEFAULT_MUSIC_OPTIONS);
    const tpl = musicDragTemplate(track, 101, DEFAULT_MUSIC_OPTIONS)!;
    expect(tpl.type).toBe('audio');
    expect(tpl.volume).toBe(0.3);
    expect(E().project.assets[tpl.assetId]).toBeDefined();
  });
});

describe('add sound effects', () => {
  it('places the effect at the playhead on a free audio track, creating "SFX" tracks as needed', async () => {
    E().setCurrentTime(3);
    const pastBefore = E().past.length;
    const a = await addSfxToTimeline(sfx, 11);
    expect(a.ok).toBe(true);
    const ca = E().project.clips[a.clipId!] as AudioClip;
    expect(ca.start).toBe(3);
    expect(E().past.length).toBe(pastBefore + 1);
    // Same spot again: the first track is busy there -> another track.
    const b = await addSfxToTimeline(sfx, 11);
    const cb = E().project.clips[b.clipId!] as AudioClip;
    expect(cb.trackId).not.toBe(ca.trackId);
    expect(E().project.tracks.find((t) => t.id === cb.trackId)!.name).toMatch(/^SFX/);
    expect(getTrackClips(E().project, cb.trackId)).toHaveLength(1);
  });

  it('never picks music or voiceover tracks for effects', () => {
    const p = E().project;
    const music = { ...p.tracks.find((t) => t.kind === 'audio')!, name: 'Music' };
    const proj = { ...p, tracks: p.tracks.map((t) => (t.id === music.id ? music : t)) };
    expect(findFreeAudioTrack(proj, 0, 1, 'sfx')).toBeNull();
    expect(findFreeAudioTrack(proj, 0, 1, 'music')).toBe(music.id);
  });
});
