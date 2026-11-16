import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClipFromAsset, createProject, useEditorStore, type MediaAsset, type Project, type VideoClip } from '../../../core';
import { clipsUsing, denoiseDeps, denoisedStrength, originalOf, reduceNoise, restoreOriginal, useDenoiseStore } from '../denoiseStore';

function asset(): MediaAsset {
  return {
    id: 'vid',
    kind: 'video',
    name: 'talk.mov',
    mimeType: 'video/quicktime',
    size: 10,
    duration: 10,
    width: 1920,
    height: 1080,
    hasAudio: true,
    status: 'ready',
    objectURL: 'blob:vid',
    blob: new Blob(['x']),
    thumbnail: 'data:thumb',
  };
}

/** Two clips cut from the same file (e.g. after silence removal). */
function project(): Project {
  const base = createProject({ fps: 30 });
  const v = base.tracks.find((t) => t.kind === 'video')!.id;
  const a = asset();
  const c1 = { ...(createClipFromAsset(a, { trackId: v, start: 0 }) as VideoClip), id: 'c1', duration: 4, sourceOut: 4 };
  const c2 = { ...(createClipFromAsset(a, { trackId: v, start: 4 }) as VideoClip), id: 'c2', sourceIn: 6, sourceOut: 10, duration: 4 };
  return { ...base, assets: { vid: a }, clips: { c1, c2 } };
}

const S = () => useEditorStore.getState();

describe('noise reduction store', () => {
  beforeEach(() => {
    S().loadProject(project());
    useDenoiseStore.setState({ jobs: {}, messages: {} });
    denoiseDeps.loadBlob = vi.fn(async (a: MediaAsset) => a.blob!);
    denoiseDeps.makeURL = () => 'blob:clean';
    denoiseDeps.process = vi.fn(async (_b, _o, onProgress) => {
      onProgress({ fraction: 0.5, label: 'Reducing noise…' });
      return { blob: new Blob(['clean'], { type: 'video/mp4' }), extension: '.mp4', hasVideo: true };
    });
  });

  it('creates a cleaned asset and moves every clip of the file to it in ONE undo step', async () => {
    const past = S().past.length;
    expect(await reduceNoise('vid', 'medium')).toBe(true);
    const p = S().project;
    const cleaned = Object.values(p.assets).find((a) => a.id !== 'vid')!;
    expect(cleaned).toMatchObject({ name: 'talk (clean).mp4', mimeType: 'video/mp4', kind: 'video', objectURL: 'blob:clean', thumbnail: 'data:thumb' });
    expect(cleaned.derivedFrom).toEqual({ assetId: 'vid', operation: 'denoise', params: { strength: 'medium' } });
    expect(denoisedStrength(cleaned)).toBe('medium');
    expect(clipsUsing(p, cleaned.id).sort()).toEqual(['c1', 'c2']);
    // clip timing untouched
    expect(p.clips.c2).toMatchObject({ start: 4, sourceIn: 6, sourceOut: 10 });
    expect(S().past.length).toBe(past + 1);
    expect(useDenoiseStore.getState().jobs).toEqual({});
    expect(useDenoiseStore.getState().messages.vid?.text).toMatch(/2 clips/);

    S().undo();
    expect(clipsUsing(S().project, 'vid').sort()).toEqual(['c1', 'c2']);
  });

  it('re-applying works from the ORIGINAL file and drops the previous cleaned copy', async () => {
    await reduceNoise('vid', 'light');
    const first = Object.keys(S().project.assets).find((id) => id !== 'vid')!;
    await reduceNoise(first, 'strong');
    expect(denoiseDeps.loadBlob).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'vid' }));
    const ids = Object.keys(S().project.assets);
    expect(ids).toHaveLength(2);
    expect(ids).not.toContain(first);
    const second = S().project.assets[ids.find((id) => id !== 'vid')!]!;
    expect(denoisedStrength(second)).toBe('strong');
    expect(originalOf(S().project, second).id).toBe('vid');
  });

  it('restoreOriginal switches clips back and removes the unused cleaned copy', async () => {
    await reduceNoise('vid', 'medium');
    const cleaned = Object.keys(S().project.assets).find((id) => id !== 'vid')!;
    expect(restoreOriginal(cleaned)).toBe(true);
    expect(Object.keys(S().project.assets)).toEqual(['vid']);
    expect(clipsUsing(S().project, 'vid').sort()).toEqual(['c1', 'c2']);
    expect(restoreOriginal('vid')).toBe(false);
  });

  it('reports failures and cancellation without touching the project', async () => {
    denoiseDeps.process = vi.fn(async () => {
      throw new Error('boom');
    });
    expect(await reduceNoise('vid', 'medium')).toBe(false);
    expect(useDenoiseStore.getState().messages.vid).toEqual({ kind: 'error', text: 'Noise reduction failed: boom' });
    denoiseDeps.process = vi.fn(async () => {
      throw new DOMException('x', 'AbortError');
    });
    expect(await reduceNoise('vid', 'medium')).toBe(false);
    expect(useDenoiseStore.getState().messages.vid?.kind).toBe('info');
    expect(Object.keys(S().project.assets)).toEqual(['vid']);
  });

  it('keeps clips on locked tracks on the original file', async () => {
    const p = S().project;
    S().updateTrack(p.clips.c1!.trackId, { locked: true });
    expect(await reduceNoise('vid', 'medium')).toBe(false);
    expect(clipsUsing(S().project, 'vid').sort()).toEqual(['c1', 'c2']);
    expect(useDenoiseStore.getState().messages.vid?.kind).toBe('error');
  });
});
