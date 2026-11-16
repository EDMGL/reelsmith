/**
 * P3 — subtitles: `subtitle` renderer, "Subtitles" panel (cue list, sync,
 * style, SRT/VTT import-export, auto-caption entry point), transcription
 * provider registry.
 */
import { lazy } from 'react';
import { registerClipRenderer, registerPanel } from '../../core';
import { renderSubtitle } from './renderSubtitle';
import { registerTranscriptionProvider } from './transcription';
import { whisperProviders } from './whisper/whisperProvider';

export { renderSubtitle, placeSubtitle } from './renderSubtitle';
export * from './formats';
export {
  registerTranscriptionProvider,
  getTranscriptionProviders,
  type TranscriptionProvider,
  type TranscriptionOptions,
} from './transcription';

export function register(): void {
  registerClipRenderer('subtitle', renderSubtitle);
  registerPanel({ id: 'subtitles', title: 'Subtitles', icon: '💬', order: 20, component: lazy(() => import('./SubtitlesPanel')) });
  for (const p of whisperProviders) registerTranscriptionProvider(p);
}
