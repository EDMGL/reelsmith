/**
 * P3 — text clips: canvas renderer, "Text" panel (add + presets), inspector section.
 */
import { lazy } from 'react';
import { registerClipRenderer, registerInspector, registerPanel } from '../../core';
import { renderText } from './renderText';

export { renderText, layoutTextClip } from './renderText';
export * from './textLayout';

export function register(): void {
  registerClipRenderer('text', renderText);
  registerPanel({ id: 'text', title: 'Text', icon: 'T', order: 10, component: lazy(() => import('./TextPanel')) });
  registerInspector('text', lazy(() => import('./TextInspector')), { id: 'text:style', title: 'Text', order: 20 });
}
