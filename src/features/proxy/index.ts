/**
 * Preview proxies: light copies of video files for smooth preview playback
 * (export always uses the originals). See proxyManager.ts.
 */
import { startProxies } from './proxyManager';

export function register(): void {
  if (typeof Worker === 'undefined') return;
  startProxies();
}
