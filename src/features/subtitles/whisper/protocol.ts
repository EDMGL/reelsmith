/** Messages between `whisperProvider` (main thread) and `whisper.worker`. */
import type { Cue } from '../formats';

export interface WhisperModel {
  id: string;
  /** Hugging Face repo with ONNX weights (transformers.js layout). */
  repo: string;
  label: string;
}

/**
 * Multilingual models (Turkish included). The `_timestamped` exports carry the
 * cross-attention outputs needed for word-level timestamps (word highlighting).
 * Weights are cached by the browser after the first download.
 */
export const WHISPER_MODELS: readonly WhisperModel[] = [
  { id: 'whisper-base', repo: 'onnx-community/whisper-base_timestamped', label: 'Whisper Base (fast)' },
  { id: 'whisper-small', repo: 'onnx-community/whisper-small_timestamped', label: 'Whisper Small (more accurate)' },
];

export type WhisperRequest =
  | { type: 'transcribe'; id: number; repo: string; samples: Float32Array; sampleRate: number; language?: string }
  | { type: 'cancel'; id: number };

export type WhisperResponse =
  | { type: 'status'; id: number; message: string }
  | { type: 'progress'; id: number; fraction: number }
  | { type: 'result'; id: number; cues: Cue[] }
  | { type: 'error'; id: number; message: string; aborted?: boolean };
