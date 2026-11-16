import { registerInspector } from '../../core';
import { ClipInspector, TransformInspector } from './ClipInspector';

export { Timeline } from './Timeline';
export { NumberField, RangeField } from './ClipInspector';

/** Registers the core inspector sections ("Clip" timing for all clips, "Transform" for visual clips). */
export function register(): void {
  registerInspector('*', ClipInspector, { id: 'core:clip', title: 'Clip', order: 0, multi: true });
  registerInspector(['video', 'image', 'text'], TransformInspector, { id: 'core:transform', title: 'Transform', order: 10, multi: true });
}
