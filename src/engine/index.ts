/**
 * Playback/render engine package (P2). Installs the engine with `setEngine()`
 * and registers the 'video' clip renderer. Consumers use `getEngine()` from
 * core and never import this package.
 */
import { registerClipRenderer, setEngine } from '../core';
import { ReelsmithEngine } from './engine';
import { renderVideoClip } from './videoRenderer';

export { ReelsmithEngine } from './engine';
export { renderVideoClip } from './videoRenderer';

export function register(): void {
  registerClipRenderer('video', renderVideoClip);
  setEngine(new ReelsmithEngine());
}
