/**
 * Drag-and-drop payload conventions shared between the left panels and the
 * timeline (HTML5 DnD).
 */
import type { Clip } from './types';

/** dataTransfer type carrying a media asset id (dragged from the media library). */
export const ASSET_DRAG_MIME = 'application/x-erdemcut-asset';

/**
 * dataTransfer type carrying a JSON-serialized `Clip` template (e.g. a text
 * preset dragged from the text panel). The timeline assigns id/trackId/start
 * on drop and inserts it with `insertClip`.
 */
export const CLIP_TEMPLATE_DRAG_MIME = 'application/x-erdemcut-clip';

/**
 * What is being dragged right now (set on dragstart, cleared on dragend).
 * HTML5 drag data can only be READ on drop, so the timeline uses this to draw
 * an exact landing preview (clip length) while hovering. Optional: a drag
 * without a payload still drops fine, just with a simpler preview.
 */
export type DragPayload = { kind: 'asset'; assetId: string } | { kind: 'clip-template'; clip: Clip };

let currentPayload: DragPayload | null = null;

export function setDragPayload(payload: DragPayload | null): void {
  currentPayload = payload;
}

export function getDragPayload(): DragPayload | null {
  return currentPayload;
}

/** True if a drag carries files from the OS. */
export function isFileDrag(dt: Pick<DataTransfer, 'types'> | null | undefined): boolean {
  return !!dt && Array.from(dt.types).includes('Files');
}

/**
 * Imports files dropped from the OS and returns the new asset ids (in order;
 * unsupported files are skipped). Provided by the media package
 * (`registerFileImporter`); other packages call `importDroppedFiles`.
 */
export type FileImporter = (files: File[]) => Promise<{ imported: string[]; failed: string[] }>;

let fileImporter: FileImporter | null = null;

export function registerFileImporter(fn: FileImporter | null): void {
  fileImporter = fn;
}

export async function importDroppedFiles(files: Iterable<File>): Promise<{ imported: string[]; failed: string[] }> {
  const list = Array.from(files);
  if (!fileImporter) return { imported: [], failed: list.map((f) => f.name) };
  return fileImporter(list);
}
