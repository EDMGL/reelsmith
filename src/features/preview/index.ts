/**
 * Preview package (P2): the center preview canvas (rendered by the engine via
 * `getEngine().renderFrame`) with frame-step / fullscreen tools. The shell's
 * transport bar below it provides play/pause, timecodes and jump to start/end.
 */
import { lazy } from 'react';
import { registerPreview } from '../../core';

export function register(): void {
  registerPreview(lazy(() => import('./Preview')));
}
