/**
 * Screen + camera recording (Loom style).
 *
 * Screen and camera are recorded as SEPARATE files (editable independently),
 * started together so they stay in sync. The microphone goes with the camera
 * take (or with the screen take when there is no camera); screen/system audio
 * stays with the screen take. After stopping, both files are made seekable,
 * imported and placed at the playhead: screen on a video track, camera as a
 * bubble on an overlay track (one undo step).
 */
import { create } from 'zustand';
import { getTrackClips, useEditorStore, type Id, type TrackKind } from '../../core';
import { importFile } from '../media/importMedia';
import { makeSeekable, openCamera, openMicStream, openScreen, recordTracks, stopStream, type Sources, type Take } from './capture';
import { bubbleLayout, type BubbleCorner, type BubbleShape, type BubbleSize } from './layout';

export type RecorderStatus = 'idle' | 'starting' | 'countdown' | 'recording' | 'processing';

interface RecorderState {
  sources: Sources;
  corner: BubbleCorner;
  size: BubbleSize;
  shape: BubbleShape;
  useCountdown: boolean;
  status: RecorderStatus;
  countdown: number;
  elapsed: number;
  /** Live camera preview stream (also used for the take). */
  preview: MediaStream | null;
  /** Live screen stream while recording (for the panel thumbnail). */
  screenPreview: MediaStream | null;
  takes: number;
  message: { kind: 'info' | 'error'; text: string } | null;
}

export const useRecorderStore = create<RecorderState>()(() => ({
  sources: { screen: true, camera: true, mic: true },
  corner: 'bottom-left',
  size: 'medium',
  shape: 'circle',
  useCountdown: true,
  status: 'idle',
  countdown: 0,
  elapsed: 0,
  preview: null,
  screenPreview: null,
  takes: 0,
  message: null,
}));

/** Browser dependencies (swappable in tests). */
export const recorderDeps = {
  openScreen,
  openCamera: () => openCamera(),
  openMic: () => openMicStream(),
  record: recordTracks,
  makeSeekable,
  importFile,
  /** Mixes several audio tracks into one (MediaRecorder only records the first audio track). */
  mixAudio: (tracks: MediaStreamTrack[]): { track: MediaStreamTrack; close: () => void } => {
    const ctx = new AudioContext();
    const dest = ctx.createMediaStreamDestination();
    for (const t of tracks) ctx.createMediaStreamSource(new MediaStream([t])).connect(dest);
    return { track: dest.stream.getAudioTracks()[0]!, close: () => void ctx.close().catch(() => undefined) };
  },
  wait: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
  now: () => performance.now(),
  tick: (fn: () => void): (() => void) => {
    const id = setInterval(fn, 200);
    return () => clearInterval(id);
  },
};

const set = (p: Partial<RecorderState>) => useRecorderStore.setState(p);
const get = () => useRecorderStore.getState();
const E = () => useEditorStore.getState();

let screen: MediaStream | null = null;
let mic: MediaStream | null = null;
let takes: { screen: Take | null; camera: Take | null } = { screen: null, camera: null };
let mixer: { close: () => void } | null = null;
let stopTick: (() => void) | null = null;
let startedAt = 0;
let recordStart = 0;
let cancelled = false;

export function setSources(patch: Partial<Sources>): void {
  const sources = { ...get().sources, ...patch };
  set({ sources });
  if (!sources.camera) closePreview();
}

/** Opens the camera preview (when the camera source is on). */
export async function openPreview(): Promise<void> {
  if (!get().sources.camera || get().preview) return;
  try {
    set({ preview: await recorderDeps.openCamera() });
  } catch (e) {
    set({ message: { kind: 'error', text: `Camera unavailable: ${e instanceof Error ? e.message : String(e)}` } });
  }
}

export function closePreview(): void {
  if (get().status === 'recording' || get().status === 'countdown' || get().status === 'starting') return;
  stopStream(get().preview);
  set({ preview: null });
}

function releaseAll(): void {
  stopTick?.();
  stopTick = null;
  mixer?.close();
  mixer = null;
  stopStream(screen);
  stopStream(mic);
  stopStream(get().preview);
  screen = null;
  mic = null;
  set({ preview: null, screenPreview: null });
}

export async function startRecording(): Promise<void> {
  const { sources } = get();
  if (get().status !== 'idle') return;
  if (!sources.screen && !sources.camera) {
    set({ message: { kind: 'error', text: 'Pick the screen, the camera, or both.' } });
    return;
  }
  cancelled = false;
  set({ status: 'starting', message: null, elapsed: 0 });
  try {
    if (sources.screen) screen = await recorderDeps.openScreen();
    if (sources.camera && !get().preview) set({ preview: await recorderDeps.openCamera() });
    if (sources.mic) mic = await recorderDeps.openMic();
  } catch (e) {
    const name = e instanceof DOMException ? e.name : '';
    const text =
      name === 'NotAllowedError' || name === 'AbortError'
        ? sources.screen && !screen
          ? 'Screen sharing was cancelled.'
          : 'Camera/microphone access was blocked. Allow it in the browser’s site settings.'
        : `Could not start recording: ${e instanceof Error ? e.message : String(e)}`;
    releaseAll();
    set({ status: 'idle', message: { kind: 'error', text } });
    return;
  }
  set({ screenPreview: screen });
  // The browser's own "Stop sharing" button ends the take too.
  screen?.getVideoTracks()[0]?.addEventListener('ended', () => void stopRecording());

  if (get().useCountdown) {
    for (let n = 3; n > 0; n--) {
      set({ status: 'countdown', countdown: n });
      await recorderDeps.wait(1000);
      if (cancelled) return;
    }
  }

  const camera = get().preview;
  const micTracks = mic?.getAudioTracks() ?? [];
  const screenAudio = screen?.getAudioTracks() ?? [];
  takes = { screen: null, camera: null };
  if (screen) {
    let audio: MediaStreamTrack[] = screenAudio;
    if (!camera && micTracks.length) {
      if (screenAudio.length) {
        const mixed = recorderDeps.mixAudio([...screenAudio, ...micTracks]);
        mixer = mixed;
        audio = [mixed.track];
      } else audio = micTracks;
    }
    takes.screen = recorderDeps.record([...screen.getVideoTracks(), ...audio], 6_000_000);
  }
  if (camera) takes.camera = recorderDeps.record([...camera.getVideoTracks(), ...micTracks], 3_000_000);
  recordStart = E().currentTime;
  takes.screen?.start();
  takes.camera?.start();
  startedAt = recorderDeps.now();
  set({ status: 'recording', countdown: 0 });
  stopTick = recorderDeps.tick(() => set({ elapsed: (recorderDeps.now() - startedAt) / 1000 }));
}

/** First track of `kind` that is free on [start, end), else a new one named `name`. */
function freeTrack(kind: TrackKind, name: string, start: number, end: number): Id {
  const p = E().project;
  const candidates = p.tracks.filter((t) => t.kind === kind && !t.locked).sort((a, b) => b.order - a.order);
  for (const t of candidates) {
    if (getTrackClips(p, t.id).every((c) => c.start + c.duration <= start + 1e-6 || c.start >= end - 1e-6)) return t.id;
  }
  return E().addTrack(kind, { name });
}

export async function stopRecording(): Promise<boolean> {
  if (get().status === 'countdown' || get().status === 'starting') {
    cancelRecording();
    return false;
  }
  if (get().status !== 'recording') return false;
  set({ status: 'processing' });
  stopTick?.();
  stopTick = null;
  const [screenBlob, cameraBlob] = await Promise.all([takes.screen?.stop() ?? null, takes.camera?.stop() ?? null]);
  const screenSettings = screen?.getVideoTracks()[0]?.getSettings();
  releaseAll();
  if (cancelled) return false;
  try {
    const n = get().takes + 1;
    const files: { screen?: File; camera?: File } = {};
    if (screenBlob && screenBlob.size > 0) {
      const s = await recorderDeps.makeSeekable(screenBlob);
      files.screen = new File([s.blob], `Screen recording ${n}${s.ext}`, { type: s.blob.type });
    }
    if (cameraBlob && cameraBlob.size > 0) {
      const c = await recorderDeps.makeSeekable(cameraBlob);
      files.camera = new File([c.blob], `Camera ${n}${c.ext}`, { type: c.blob.type });
    }
    const screenId = files.screen ? await recorderDeps.importFile(files.screen) : null;
    const cameraId = files.camera ? await recorderDeps.importFile(files.camera) : null;
    if (!screenId && !cameraId) throw new Error('The recording could not be imported.');

    const wasEmpty = Object.keys(E().project.clips).length === 0;
    const start = wasEmpty ? 0 : recordStart;
    const added: Id[] = [];
    E().transact('Record screen', () => {
      // An empty project takes the screen's shape (e.g. 16:9 for a laptop screen).
      const sw = screenSettings?.width ?? 0;
      const sh = screenSettings?.height ?? 0;
      if (wasEmpty && screenId && sw > sh) E().setAspectPreset('16:9');
      const assets = E().project.assets;
      const dur = (id: Id | null) => (id ? assets[id]?.duration ?? 0 : 0);
      if (screenId) {
        const id = E().addAssetClip(screenId, { trackId: freeTrack('video', 'Screen', start, start + dur(screenId)), start });
        if (id) added.push(id);
      }
      if (cameraId) {
        const kind: TrackKind = screenId ? 'overlay' : 'video';
        const id = E().addAssetClip(cameraId, { trackId: freeTrack(kind, 'Camera', start, start + dur(cameraId)), start });
        if (id) {
          added.push(id);
          const cam = E().project.assets[cameraId]!;
          if (screenId && cam.width > 0 && cam.height > 0) {
            const p = E().project;
            const { transform, shape } = bubbleLayout(cam.width, cam.height, p.width, p.height, { corner: get().corner, size: get().size, shape: get().shape });
            E().updateClip(id, { transform, shape });
          }
        }
      }
    });
    if (added.length === 0) throw new Error('No room on the timeline for the recording.');
    E().selectClips(added);
    E().setCurrentTime(start);
    const secs = Math.max(dur2(screenId), dur2(cameraId));
    set({ status: 'idle', takes: n, message: { kind: 'info', text: `Recording ${n} added (${secs.toFixed(1)} s${screenId && cameraId ? ', screen + camera' : ''}). Undo removes it.` } });
    return true;
  } catch (e) {
    set({ status: 'idle', message: { kind: 'error', text: e instanceof Error ? e.message : String(e) } });
    return false;
  }
}

function dur2(id: Id | null): number {
  return id ? E().project.assets[id]?.duration ?? 0 : 0;
}

export function cancelRecording(): void {
  cancelled = true;
  void takes.screen?.stop().catch(() => undefined);
  void takes.camera?.stop().catch(() => undefined);
  takes = { screen: null, camera: null };
  releaseAll();
  set({ status: 'idle', countdown: 0, message: { kind: 'info', text: 'Recording cancelled.' } });
}
