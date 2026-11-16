/**
 * Saving the exported file: File System Access API when available (the handle
 * must be requested while the click's user activation is still valid, i.e.
 * BEFORE the export runs), otherwise an <a download> with an object URL.
 */

interface WritableLike {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}
export interface SaveHandle {
  createWritable(): Promise<WritableLike>;
  name?: string;
}
type SavePicker = (opts: {
  suggestedName: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<SaveHandle>;

export function hasSavePicker(): boolean {
  return typeof window !== 'undefined' && typeof (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function';
}

/**
 * Asks where to save. Returns null when the picker is unavailable; throws an
 * AbortError if the user dismissed it.
 */
export async function pickSaveHandle(fileName: string, mimeType: string, extension: string): Promise<SaveHandle | null> {
  if (!hasSavePicker()) return null;
  const picker = (window as unknown as { showSaveFilePicker: SavePicker }).showSaveFilePicker;
  return picker({
    suggestedName: fileName,
    types: [{ description: mimeType === 'video/mp4' ? 'MP4 video' : 'WebM video', accept: { [mimeType]: [extension] } }],
  });
}

export async function writeToHandle(handle: SaveHandle, blob: Blob): Promise<void> {
  const w = await handle.createWritable();
  await w.write(blob);
  await w.close();
}

export function triggerDownload(url: string, fileName: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
