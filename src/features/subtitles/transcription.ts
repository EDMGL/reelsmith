/**
 * Auto-transcription plumbing. Erdemcut ships NO speech model: a provider
 * (on-device WASM model, a user-configured service, …) registers itself here
 * and the Subtitles panel's "Auto captions" button becomes available.
 */
import { useSyncExternalStore } from 'react';
import type { Cue } from './formats';

export interface TranscriptionOptions {
  /** BCP-47 language hint, e.g. "en"; undefined = auto-detect. */
  language?: string;
  /** Progress 0..1. */
  onProgress?: (fraction: number) => void;
  /** Human-readable phase, e.g. "Downloading model… 40%". */
  onStatus?: (message: string) => void;
  /** Abort -> the promise must reject with an AbortError (DOMException name 'AbortError'). */
  signal?: AbortSignal;
}

export interface TranscriptionProvider {
  id: string;
  /** Shown in the UI. */
  label: string;
  /**
   * Transcribes audio into cues. Times are relative to the start of `audio`
   * (seconds). Mono 16 kHz AudioBuffers are what the panel passes by default.
   */
  transcribe(audio: AudioBuffer | Blob, opts?: TranscriptionOptions): Promise<Cue[]>;
}

let providers: readonly TranscriptionProvider[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Registers (or replaces, by id) a provider. Returns an unregister function. */
export function registerTranscriptionProvider(provider: TranscriptionProvider): () => void {
  providers = [...providers.filter((p) => p.id !== provider.id), provider];
  emit();
  return () => {
    if (providers.includes(provider)) {
      providers = providers.filter((p) => p !== provider);
      emit();
    }
  };
}

export function getTranscriptionProviders(): readonly TranscriptionProvider[] {
  return providers;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useTranscriptionProviders(): readonly TranscriptionProvider[] {
  return useSyncExternalStore(subscribe, getTranscriptionProviders, getTranscriptionProviders);
}

/** Helper for providers: rejects with an AbortError if the signal is aborted. */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Transcription aborted', 'AbortError');
}
