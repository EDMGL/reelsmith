/**
 * Noise reduction ("Audio cleanup" inspector section on video/audio clips).
 * Spectral gating in a worker; the cleaned file becomes a new asset that the
 * clips are switched to (undoable, revertible via "Restore original").
 */
import { lazy } from 'react';
import { registerInspector } from '../../core';

export function register(): void {
  registerInspector(['video', 'audio'], lazy(() => import('./DenoiseInspector')), { id: 'denoise:cleanup', title: 'Audio cleanup', order: 40 });
}
