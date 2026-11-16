/**
 * Playback/render engine CONTRACT (types + provider). The implementation is
 * owned by P2 (`src/engine`), which calls `setEngine(impl)` from its
 * `register()`. Consumers (e.g. P4 export) call `getEngine()` and never import
 * P2 internals.
 *
 * State ownership: the editor store is the source of truth for `isPlaying`
 * and `currentTime`. The engine SUBSCRIBES to the store:
 * - when `isPlaying` flips, it starts/stops playback;
 * - when `seekNonce` changes, the user seeked to `currentTime` -> engine seeks;
 * - while playing, the engine advances time by calling
 *   `useEditorStore.getState().setPlaybackTime(t)` (does NOT bump seekNonce),
 *   and calls `pause()` on the store when reaching the project end.
 * `play()/pause()/seek()` below are imperative mirrors for non-UI callers.
 */
import { useSyncExternalStore } from 'react';
import type { Canvas2D } from './registry';

export interface RenderFrameOptions {
  /** Draw for export (may use higher quality, must wait for exact frames). */
  isExport?: boolean;
  /**
   * Target size in pixels; defaults to the target canvas size. The engine maps
   * the project canvas (project.width x project.height) onto it.
   */
  width?: number;
  height?: number;
}

export interface AudioMixOptions {
  /** Project time range to mix, seconds. */
  start: number;
  end: number;
  sampleRate: number;
  /** 1 or 2. */
  channels: number;
}

export interface PlaybackEngine {
  /** Starts playback from the store's currentTime. */
  play(): void;
  pause(): void;
  /** Seeks to project time `t` (seconds). */
  seek(t: number): void;
  /**
   * Composites the complete frame at project time `t` (background, all visible
   * tracks bottom-up, clip renderers, effects, fades) into `targetCtx`.
   * Resolves once the frame is fully drawn (all media frames decoded).
   * Must be callable while paused and independent of playback state, so the
   * exporter can step through frames.
   */
  renderFrame(t: number, targetCtx: Canvas2D, opts?: RenderFrameOptions): Promise<void>;
  /**
   * Offline-mixes all audible clips (video clips with audio + audio clips,
   * honouring volume, fades, speed, muted tracks) for the given range.
   */
  mixAudio(opts: AudioMixOptions): Promise<AudioBuffer>;
  /** Silences preview playback (e.g. while recording a voiceover). Export is unaffected. */
  setPreviewMuted?(muted: boolean): void;
  /** Releases decoders, audio contexts, listeners. */
  dispose(): void;
}

let current: PlaybackEngine | null = null;
const listeners = new Set<() => void>();

/** Installs (or removes with null) the engine. Disposes the previous one. */
export function setEngine(engine: PlaybackEngine | null): void {
  if (current === engine) return;
  current?.dispose();
  current = engine;
  listeners.forEach((l) => l());
}

/** The installed engine, or null if none (e.g. P2 not loaded yet). */
export function getEngine(): PlaybackEngine | null {
  return current;
}

export function subscribeEngine(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** React hook returning the current engine (re-renders when it changes). */
export function useEngine(): PlaybackEngine | null {
  return useSyncExternalStore(subscribeEngine, getEngine, getEngine);
}
