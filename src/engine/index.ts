/**
 * Playback/render engine package (P2). Installs the engine with `setEngine()`
 * and registers the 'video' clip renderer. Consumers use `getEngine()` from
 * core and never import this package.
 */
import { registerClipRenderer, setEngine } from '../core';
import { ErdemcutEngine } from './engine';
import { renderVideoClip } from './videoRenderer';

export { ErdemcutEngine } from './engine';
export { renderVideoClip } from './videoRenderer';

export function register(): void {
  registerClipRenderer('video', renderVideoClip);
  setEngine(new ErdemcutEngine());
}
