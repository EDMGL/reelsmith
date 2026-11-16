import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClipFromAsset, createProject, setEngine, useEditorStore, type MediaAsset, type PlaybackEngine, type Project, type VideoClip } from '../../../core';
import { cancelVoiceover, startVoiceover, stopVoiceover, useVoiceoverStore, voiceoverDeps, voiceoverTrackFor } from '../voiceoverStore';
import { encodeWav, type PcmLike } from '../wav';

const E = () => useEditorStore.getState();

function pcm(seconds: number, sampleRate = 48000, channels = 1): PcmLike {
  const length = Math.round(seconds * sampleRate);
  const data = Array.from({ length: channels }, (_, c) => Float32Array.from({ length }, (_, i) => Math.sin(i / 10) * 0.5 * (c + 1)));
  return { numberOfChannels: channels, sampleRate, length, getChannelData: (c) => data[c]! };
}

describe('encodeWav', () => {
  it('writes a valid 16-bit PCM header and samples', async () => {
    const audio = pcm(0.01, 8000, 2);
    const blob = encodeWav(audio);
    const v = new DataView(await blob.arrayBuffer());
    const str = (o: number, n: number) => String.fromCharCode(...Array.from({ length: n }, (_, i) => v.getUint8(o + i)));
    expect(blob.type).toBe('audio/wav');
    expect(str(0, 4)).toBe('RIFF');
    expect(str(8, 4)).toBe('WAVE');
    expect(v.getUint16(22, true)).toBe(2); // channels
    expect(v.getUint32(24, true)).toBe(8000);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(80 * 2 * 2);
    expect(blob.size).toBe(44 + 80 * 4);
    expect(v.getInt16(44 + 4 * 5, true)).toBe(Math.round(Math.sin(0.5) * 0.5 * 0x7fff));
    // downmix limit: keep only the first channel
    expect(encodeWav(audio, { maxChannels: 1 }).size).toBe(44 + 80 * 2);
  });
});

describe('voiceover recording flow', () => {
  let muted: boolean[] = [];
  let mic: {
    start: ReturnType<typeof vi.fn<() => Promise<void>>>;
    stop: ReturnType<typeof vi.fn<() => Promise<Blob>>>;
    close: ReturnType<typeof vi.fn<() => void>>;
    level: () => number;
  };

  function project(): Project {
    const base = createProject();
    const v = base.tracks.find((t) => t.kind === 'video')!.id;
    const vid: MediaAsset = { id: 'vid', kind: 'video', name: 'v.mp4', mimeType: 'video/mp4', size: 1, duration: 20, width: 1, height: 1, hasAudio: true, status: 'ready', objectURL: 'blob:v' };
    const clip = { ...(createClipFromAsset(vid, { trackId: v, start: 0 }) as VideoClip), id: 'vc' };
    return { ...base, assets: { vid }, clips: { vc: clip } };
  }

  beforeEach(() => {
    E().loadProject(project());
    E().setCurrentTime(4);
    muted = [];
    setEngine({ setPreviewMuted: (m: boolean) => muted.push(m), dispose() {} } as unknown as PlaybackEngine);
    mic = {
      start: vi.fn<() => Promise<void>>(async () => undefined),
      stop: vi.fn<() => Promise<Blob>>(async () => new Blob(['rec'], { type: 'audio/webm' })),
      close: vi.fn<() => void>(),
      level: () => 0.5,
    };
    useVoiceoverStore.setState({ status: 'idle', useCountdown: false, muteTimeline: true, takes: 0, message: null, deviceId: '' });
    voiceoverDeps.openMic = vi.fn(async () => mic);
    voiceoverDeps.listMics = vi.fn(async () => [{ id: 'm1', label: 'USB Mic' }]);
    voiceoverDeps.decode = vi.fn(async () => pcm(2.5));
    voiceoverDeps.frame = () => () => undefined;
    voiceoverDeps.wait = vi.fn(async () => undefined);
    voiceoverDeps.importFile = vi.fn(async (file: File) => {
      expect(file.type).toBe('audio/wav');
      const asset: MediaAsset = { id: 'vo1', kind: 'audio', name: file.name, mimeType: 'audio/wav', size: file.size, duration: 2.5, width: 0, height: 0, hasAudio: true, status: 'ready', objectURL: 'blob:vo' };
      E().addAsset(asset);
      return asset.id;
    });
  });
  afterEach(() => setEngine(null));

  it('records from the playhead with playback (muted) and places the take on a Voiceover track in one undo step', async () => {
    await startVoiceover();
    expect(useVoiceoverStore.getState().status).toBe('recording');
    expect(useVoiceoverStore.getState().startTime).toBe(4);
    expect(E().isPlaying).toBe(true);
    expect(muted).toEqual([true]);
    const past = E().past.length;
    expect(await stopVoiceover()).toBe(true);
    expect(E().isPlaying).toBe(false);
    expect(muted.at(-1)).toBe(false);
    expect(mic.close).toHaveBeenCalled();
    const p = E().project;
    const clip = Object.values(p.clips).find((c) => c.type === 'audio')!;
    expect(clip).toMatchObject({ start: 4, duration: 2.5 });
    expect(p.tracks.find((t) => t.id === clip.trackId)!.name).toBe('Voiceover');
    expect(E().past.length).toBe(past + 1);
    expect(E().selectedClipIds).toEqual([clip.id]);
    expect(useVoiceoverStore.getState()).toMatchObject({ status: 'idle', takes: 1, message: { kind: 'info' } });
    E().undo();
    expect(Object.values(E().project.clips).some((c) => c.type === 'audio')).toBe(false);
  });

  it('pausing playback (Space / end of timeline) stops the take', async () => {
    await startVoiceover();
    E().pause();
    await vi.waitFor(() => expect(useVoiceoverStore.getState().takes).toBe(1));
  });

  it('countdown runs before recording; cancel discards everything', async () => {
    useVoiceoverStore.setState({ useCountdown: true });
    await startVoiceover();
    expect(voiceoverDeps.wait).toHaveBeenCalledTimes(3);
    cancelVoiceover();
    expect(useVoiceoverStore.getState().status).toBe('idle');
    expect(E().isPlaying).toBe(false);
    expect(voiceoverDeps.importFile).not.toHaveBeenCalled();
    expect(mic.close).toHaveBeenCalled();
  });

  it('a second overlapping take goes to a new Voiceover track; a later one reuses the first', async () => {
    await startVoiceover();
    await stopVoiceover();
    const first = voiceoverTrackFor(4, 6.5);
    expect(E().project.tracks.find((t) => t.id === first)!.name).toBe('Voiceover 2');
    expect(E().project.tracks.filter((t) => t.name.startsWith('Voiceover')).map((t) => t.name).sort()).toEqual(['Voiceover', 'Voiceover 2']);
    const later = voiceoverTrackFor(10, 12);
    expect(E().project.tracks.find((t) => t.id === later)!.name).toBe('Voiceover');
  });

  it('reports a blocked microphone', async () => {
    voiceoverDeps.openMic = vi.fn(async () => {
      throw new DOMException('denied', 'NotAllowedError');
    });
    await startVoiceover();
    expect(useVoiceoverStore.getState().status).toBe('idle');
    expect(useVoiceoverStore.getState().message?.text).toMatch(/blocked/);
  });

  it('at the end of the timeline it records without rewinding playback', async () => {
    E().setCurrentTime(20);
    await startVoiceover();
    expect(E().isPlaying).toBe(false);
    expect(E().currentTime).toBe(20);
    expect(await stopVoiceover()).toBe(true);
    expect(Object.values(E().project.clips).find((c) => c.type === 'audio')!.start).toBe(20);
  });
});
