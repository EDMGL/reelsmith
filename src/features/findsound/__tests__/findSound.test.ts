import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore, type AudioClip, type MediaAsset } from '../../../core';
import { makeAsset, makeProject, videoClip, withClips } from '../../../core/__tests__/fixtures';
import { parseSearch } from '../../../../server/soundApi';
import { addSoundToTimeline, buildQuery, soundApi, soundFileName } from '../findSound';

const S = () => useEditorStore.getState();
const song = { id: 'abcdefghijk', title: 'Chill / Beat: "Summer"', channel: 'x', duration: 120, thumbnail: null };

beforeEach(() => {
  const { project, v } = makeProject();
  S().loadProject(withClips(project, videoClip(project, 'v', v, 0, 0, 10)));
  let n = 0;
  soundApi.importFile = async (file) => {
    const a: MediaAsset = { ...makeAsset(`snd${++n}`, 120, 'audio'), name: file.name, mimeType: 'audio/mpeg' };
    S().addAsset(a);
    return a.id;
  };
});

describe('find sound', () => {
  it('adds "no copyright music" only when asked and not already there', () => {
    expect(buildQuery(' lofi ', true)).toBe('lofi no copyright music');
    expect(buildQuery('lofi', false)).toBe('lofi');
    expect(buildQuery('copyright free piano', true)).toBe('copyright free piano');
    expect(buildQuery('  ', true)).toBe('');
  });

  it('makes a safe mp3 file name', () => {
    expect(soundFileName(song.title)).toBe('Chill Beat Summer.mp3');
  });

  it('places the song on a music track, cut to the end of the video, soft and under speech', async () => {
    const id = await addSoundToTimeline(song, new Blob(['x']), { startAt: 'zero', volume: 0.3 });
    const c = S().project.clips[id] as AudioClip;
    expect(c).toMatchObject({ type: 'audio', start: 0, duration: 10, sourceIn: 0, sourceOut: 10, volume: 0.3, fadeOut: 2 });
    expect(S().project.tracks.find((t) => t.id === c.trackId)!.kind).toBe('audio');
    // Adding the same song again reuses the imported file.
    S().setCurrentTime(4);
    const id2 = await addSoundToTimeline(song, new Blob(['x']), { startAt: 'playhead', volume: 0.5 });
    const c2 = S().project.clips[id2] as AudioClip;
    expect(c2.assetId).toBe(c.assetId);
    expect(c2).toMatchObject({ start: 4, duration: 6 });
    S().undo();
    expect(S().project.clips[id2]).toBeUndefined();
  });
});

describe('search parsing (server)', () => {
  it('keeps normal videos, drops live streams, long mixes and junk', () => {
    const lines = [
      JSON.stringify({ id: 'aaaaaaaaaaa', title: 'Song', channel: 'Ch', duration: 150, thumbnails: [{ url: 'x' }] }),
      JSON.stringify({ id: 'bbbbbbbbbbb', title: 'Radio', duration: null, live_status: 'is_live' }),
      JSON.stringify({ id: 'ccccccccccc', title: '10h mix', duration: 36000 }),
      JSON.stringify({ id: 'bad id!', title: 'x', duration: 10 }),
      'not json',
    ].join('\n');
    expect(parseSearch(lines)).toEqual([{ id: 'aaaaaaaaaaa', title: 'Song', channel: 'Ch', duration: 150, thumbnail: '/api/sound/thumb?id=aaaaaaaaaaa' }]);
  });
});
