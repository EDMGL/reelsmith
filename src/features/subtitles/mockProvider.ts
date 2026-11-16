/**
 * Deterministic fake transcription provider — TESTS ONLY (never registered by
 * `register()`). Emits one cue per `cueLength` seconds of audio with the text
 * "Line N", reporting progress per cue and honouring abort.
 */
import type { Cue } from './formats';
import { throwIfAborted, type TranscriptionOptions, type TranscriptionProvider } from './transcription';

export function createMockTranscriptionProvider(opts: { cueLength?: number; id?: string } = {}): TranscriptionProvider {
  const len = opts.cueLength ?? 2;
  return {
    id: opts.id ?? 'mock',
    label: 'Mock (tests)',
    async transcribe(audio: AudioBuffer | Blob, o: TranscriptionOptions = {}): Promise<Cue[]> {
      const duration = 'duration' in audio ? audio.duration : audio.size / 32000; // Blob: pretend 16 kHz 16-bit mono
      const n = Math.max(0, Math.floor(duration / len));
      const cues: Cue[] = [];
      for (let i = 0; i < n; i++) {
        throwIfAborted(o.signal);
        await Promise.resolve();
        cues.push({ start: i * len, end: (i + 1) * len - 0.1, text: `Line ${i + 1}` });
        o.onProgress?.((i + 1) / n);
      }
      throwIfAborted(o.signal);
      o.onProgress?.(1);
      return cues;
    },
  };
}
