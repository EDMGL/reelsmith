/**
 * Voiceover recording flow:
 * countdown → record from the playhead while the timeline plays (optionally
 * muted) → stop (button, Space, or end of timeline) → the take becomes a WAV
 * asset placed at the recording start on a "Voiceover" audio track (one undo step).
 */
import { create } from 'zustand';
import { getEngine, getProjectDuration, getTrackClips, useEditorStore, type Id } from '../../core';
import { importFile } from '../media/importMedia';
import { decodeRecording, listMics, openMic, type MicSession } from './mic';
import { encodeWav, type PcmLike } from './wav';

export type VoiceoverStatus = 'idle' | 'countdown' | 'recording' | 'saving';

interface VoiceoverState {
  status: VoiceoverStatus;
  countdown: number;
  /** Project time where the current/last take started. */
  startTime: number;
  elapsed: number;
  level: number;
  deviceId: string;
  devices: { id: string; label: string }[];
  muteTimeline: boolean;
  useCountdown: boolean;
  takes: number;
  message: { kind: 'info' | 'error'; text: string } | null;
}

export const useVoiceoverStore = create<VoiceoverState>()(() => ({
  status: 'idle',
  countdown: 0,
  startTime: 0,
  elapsed: 0,
  level: 0,
  deviceId: '',
  devices: [],
  muteTimeline: true,
  useCountdown: true,
  takes: 0,
  message: null,
}));

/** Browser dependencies (swappable in tests). */
export const voiceoverDeps = {
  openMic,
  listMics,
  decode: (blob: Blob): Promise<PcmLike> => decodeRecording(blob),
  importFile,
  wait: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
  now: () => performance.now(),
  frame: (fn: () => void): (() => void) => {
    let id = 0;
    const loop = () => {
      fn();
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  },
};

export const VOICEOVER_TRACK_NAME = 'Voiceover';

const set = (p: Partial<VoiceoverState>) => useVoiceoverStore.setState(p);
const get = () => useVoiceoverStore.getState();
const E = () => useEditorStore.getState();

let session: MicSession | null = null;
let stopFrame: (() => void) | null = null;
let unsubPlay: (() => void) | null = null;
let cancelled = false;
let recordedAt = 0;

export async function refreshMics(): Promise<void> {
  try {
    const devices = await voiceoverDeps.listMics();
    set({ devices, deviceId: devices.some((d) => d.id === get().deviceId) ? get().deviceId : '' });
  } catch {
    /* enumerateDevices unavailable */
  }
}

function cleanup(): void {
  stopFrame?.();
  stopFrame = null;
  unsubPlay?.();
  unsubPlay = null;
  session?.close();
  session = null;
  getEngine()?.setPreviewMuted?.(false);
}

/** Starts a take at the current playhead. */
export async function startVoiceover(): Promise<void> {
  if (get().status !== 'idle') return;
  cancelled = false;
  set({ message: null, elapsed: 0, level: 0 });
  try {
    session = await voiceoverDeps.openMic(get().deviceId || undefined);
  } catch (e) {
    const denied = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
    set({ message: { kind: 'error', text: denied ? 'Microphone access was blocked. Allow it in the browser’s site settings and try again.' : `Could not open the microphone: ${e instanceof Error ? e.message : String(e)}` } });
    cleanup();
    return;
  }
  void refreshMics(); // labels become available once permission is granted
  stopFrame = voiceoverDeps.frame(() => {
    if (session) set({ level: session.level() });
    if (get().status === 'recording') set({ elapsed: (voiceoverDeps.now() - recordedAt) / 1000 });
  });
  if (E().isPlaying) E().pause();
  if (get().useCountdown) {
    for (let n = 3; n > 0; n--) {
      set({ status: 'countdown', countdown: n });
      await voiceoverDeps.wait(1000);
      if (cancelled) return;
    }
  }
  const startTime = E().currentTime;
  set({ status: 'recording', countdown: 0, startTime });
  if (get().muteTimeline) getEngine()?.setPreviewMuted?.(true);
  try {
    await session!.start();
  } catch (e) {
    set({ status: 'idle', message: { kind: 'error', text: `Recording failed: ${e instanceof Error ? e.message : String(e)}` } });
    cleanup();
    return;
  }
  recordedAt = voiceoverDeps.now();
  // At (or past) the end there is nothing to play: record without playback (play() would rewind to 0).
  if (startTime < getProjectDuration(E().project) - 1e-3) E().play();
  // Space / end of timeline stops playback -> stop the take too.
  let wasPlaying = E().isPlaying;
  unsubPlay = useEditorStore.subscribe((s) => {
    if (wasPlaying && !s.isPlaying && get().status === 'recording') void stopVoiceover();
    wasPlaying = s.isPlaying;
  });
}

/** Free audio track for [start, end): the first "Voiceover" track with room, else a new one. */
export function voiceoverTrackFor(start: number, end: number): Id {
  const p = E().project;
  const candidates = p.tracks
    .filter((t) => t.kind === 'audio' && !t.locked && t.name.startsWith(VOICEOVER_TRACK_NAME))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  for (const t of candidates) {
    const free = getTrackClips(p, t.id).every((c) => c.start + c.duration <= start + 1e-6 || c.start >= end - 1e-6);
    if (free) return t.id;
  }
  return E().addTrack('audio', { name: candidates.length ? `${VOICEOVER_TRACK_NAME} ${candidates.length + 1}` : VOICEOVER_TRACK_NAME });
}

/** Stops the take and adds it to the project. */
export async function stopVoiceover(): Promise<boolean> {
  const status = get().status;
  if (status === 'countdown') {
    cancelVoiceover();
    return false;
  }
  if (status !== 'recording' || !session) return false;
  set({ status: 'saving' });
  unsubPlay?.();
  unsubPlay = null;
  if (E().isPlaying) E().pause();
  const s = session;
  try {
    const blob = await s.stop();
    cleanup();
    if (cancelled) return false;
    const pcm = await voiceoverDeps.decode(blob);
    if (pcm.length / pcm.sampleRate < 0.2) throw new Error('The recording is too short.');
    const take = get().takes + 1;
    const file = new File([encodeWav(pcm, { maxChannels: 1 })], `Voiceover ${take}.wav`, { type: 'audio/wav' });
    const assetId = await voiceoverDeps.importFile(file);
    if (!assetId) throw new Error('The recording could not be imported.');
    const start = get().startTime;
    const end = start + pcm.length / pcm.sampleRate;
    let clipId: Id | null = null;
    E().transact('Record voiceover', () => {
      clipId = E().addAssetClip(assetId, { trackId: voiceoverTrackFor(start, end), start });
    });
    if (!clipId) throw new Error('No room on the timeline for the recording.');
    E().selectClips([clipId]);
    set({
      status: 'idle',
      takes: take,
      message: { kind: 'info', text: `Voiceover ${take} added (${(end - start).toFixed(1)} s). Undo removes it.` },
    });
    return true;
  } catch (e) {
    cleanup();
    set({ status: 'idle', message: { kind: 'error', text: e instanceof Error ? e.message : String(e) } });
    return false;
  }
}

/** Aborts the countdown / take without adding anything. */
export function cancelVoiceover(): void {
  cancelled = true;
  const s = session;
  if (get().status === 'recording' && E().isPlaying) E().pause();
  if (s && get().status === 'recording') void s.stop().catch(() => undefined);
  cleanup();
  set({ status: 'idle', countdown: 0, message: { kind: 'info', text: 'Recording cancelled.' } });
}
