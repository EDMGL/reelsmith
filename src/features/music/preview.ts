/**
 * Library preview player. Uses its OWN AudioContext (never the editor engine),
 * plays one item at a time, pauses timeline playback when a preview starts and
 * stops when timeline playback starts.
 */
import { create } from 'zustand';
import { useEditorStore } from '../../core';
import type { Pcm } from './synth/master';

interface PreviewState {
  /** Item key currently audible. */
  playingKey: string | null;
  /** Item key being rendered for preview. */
  loadingKey: string | null;
  /** Render progress 0..1 of `loadingKey`. */
  loadProgress: number;
  /** Playback position 0..1. */
  position: number;
  /** Smoothed output level 0..1. */
  level: number;
  error: string | null;
}

export const usePreviewStore = create<PreviewState>()(() => ({ playingKey: null, loadingKey: null, loadProgress: 0, position: 0, level: 0, error: null }));

export const previewDeps = {
  createContext: (): AudioContext | null => (typeof AudioContext !== 'undefined' ? new AudioContext({ latencyHint: 'playback' }) : null),
  frame: (fn: () => void): (() => void) => {
    let id = 0;
    let alive = true;
    const loop = () => {
      if (!alive) return;
      fn();
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => {
      alive = false;
      cancelAnimationFrame(id);
    };
  },
};

let ctx: AudioContext | null = null;
let source: AudioBufferSourceNode | null = null;
let analyser: AnalyserNode | null = null;
let stopFrame: (() => void) | null = null;
let startedAt = 0;
let duration = 0;
let token = 0;
let unsubEditor: (() => void) | null = null;

const set = (p: Partial<PreviewState>) => usePreviewStore.setState(p);

function watchTimeline(): void {
  if (unsubEditor) return;
  unsubEditor = useEditorStore.subscribe((s, prev) => {
    if (s.isPlaying && !prev.isPlaying) stopPreview();
  });
}

/** Stops any preview (and cancels a pending one). */
export function stopPreview(): void {
  token++;
  stopFrame?.();
  stopFrame = null;
  if (source) {
    source.onended = null;
    try {
      source.stop();
    } catch {
      /* already stopped */
    }
    source.disconnect();
  }
  source = null;
  const s = usePreviewStore.getState();
  if (s.playingKey || s.loadingKey || s.level || s.position) set({ playingKey: null, loadingKey: null, loadProgress: 0, position: 0, level: 0 });
}

/**
 * Plays `key` (rendering it with `load` if needed). Calling it again for the
 * item that is playing/loading stops it. Starting a preview pauses the timeline.
 */
export async function togglePreview(key: string, load: (onProgress: (f: number) => void) => Promise<Pcm>): Promise<void> {
  const st = usePreviewStore.getState();
  if (st.playingKey === key || st.loadingKey === key) {
    stopPreview();
    return;
  }
  stopPreview();
  watchTimeline();
  const my = ++token;
  if (useEditorStore.getState().isPlaying) useEditorStore.getState().pause();
  set({ loadingKey: key, loadProgress: 0, error: null });
  // Create/resume the context inside the user gesture (autoplay policy).
  ctx ??= previewDeps.createContext();
  void ctx?.resume?.();
  let pcm: Pcm;
  try {
    pcm = await load((f) => {
      if (token === my) set({ loadProgress: f });
    });
  } catch (e) {
    if (token === my) set({ loadingKey: null, error: e instanceof Error ? e.message : String(e) });
    return;
  }
  if (token !== my) return; // another preview (or stop) happened meanwhile
  if (!ctx) {
    set({ loadingKey: null, error: 'Audio playback is not available in this browser.' });
    return;
  }
  const buf = ctx.createBuffer(pcm.channels.length, pcm.channels[0]!.length, pcm.sampleRate);
  pcm.channels.forEach((ch, c) => buf.copyToChannel(ch as Float32Array<ArrayBuffer>, c));
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const gain = ctx.createGain();
  gain.gain.value = 0.9;
  analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  src.connect(gain).connect(analyser).connect(ctx.destination);
  src.onended = () => {
    if (source === src) stopPreview();
  };
  source = src;
  startedAt = ctx.currentTime;
  duration = buf.duration;
  src.start();
  set({ loadingKey: null, playingKey: key, position: 0, level: 0 });
  const data = new Float32Array(analyser.fftSize);
  let level = 0;
  stopFrame = previewDeps.frame(() => {
    if (!ctx || !analyser) return;
    analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i]! * data[i]!;
    const rmsLevel = Math.min(1, Math.sqrt(sum / data.length) * 3);
    level = Math.max(rmsLevel, level * 0.85);
    set({ position: Math.min(1, (ctx.currentTime - startedAt) / duration), level });
  });
}

/** Test helper: forget the audio context. */
export function resetPreview(): void {
  stopPreview();
  ctx = null;
  unsubEditor?.();
  unsubEditor = null;
}
