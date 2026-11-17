/**
 * Public API of the editor core. Feature packages import ONLY from here:
 *   import { useEditorStore, registerPanel, type Clip } from '../../core';
 */
export * from './types';
export * from './ids';
export * from './time';
export * from './aspect';
export * from './model';
export * as ops from './ops';
export type { ClipPatch, TrimEdge, DistributiveOmit, ClipMove, PlacementItem } from './ops';
export * from './dnd';
export * from './registry';
export { openPanel, getActivePanelId, useActivePanelId, subscribeActivePanel, resetActivePanel } from './panels';
export * from './render';
export { Slot } from './Slot';
export { PreviewOverlayLayer, type PreviewOverlayLayerProps } from './PreviewOverlayLayer';
export * from './ui';
export * from './engine';
export * from './audioDecode';
export * from './store';
export {
  PROJECT_STORAGE_KEY,
  serializeProject,
  deserializeProject,
  saveProject,
  restoreProject,
  startAutosave,
  putAssetBlob,
  getAssetBlob,
  type SerializedAsset,
  type SerializedProject,
} from './persistence';
