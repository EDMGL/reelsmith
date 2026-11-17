import { lazy } from 'react';
import { getProjectDuration, isFileDrag, registerFileImporter, registerPanel, useEditorStore } from '../../core';
import { importFiles } from './importMedia';

export { importFile, importFiles, detectKind, computeWaveform } from './importMedia';

let windowDropInstalled = false;

/**
 * Files dropped anywhere outside a drop target (preview, empty app area) are
 * imported and appended at the end of the timeline instead of making the
 * browser navigate to the file. Targets that handle the drop themselves
 * (media panel, timeline) call preventDefault, which this listener respects.
 */
function installWindowFileDrop(): void {
  if (windowDropInstalled || typeof window === 'undefined') return;
  windowDropInstalled = true;
  window.addEventListener('dragover', (e) => {
    if (e.defaultPrevented || !isFileDrag(e.dataTransfer)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('drop', (e) => {
    if (e.defaultPrevented || !isFileDrag(e.dataTransfer) || !e.dataTransfer?.files.length) return;
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    void importFiles(files).then(({ imported }) => {
      if (imported.length === 0) return;
      const s = useEditorStore.getState();
      s.transact('Add media', () => {
        for (const id of imported) {
          // Append: after the end of the timeline on a track of the right kind.
          s.addAssetClip(id, { start: getProjectDuration(useEditorStore.getState().project) });
        }
      });
    });
  });
}

/** Registers the media library as the first left-panel tab, the OS-file importer and the window file drop. */
export function register(): void {
  registerFileImporter(importFiles);
  installWindowFileDrop();
  registerPanel({
    id: 'media',
    title: 'Media',
    icon: '▦',
    order: 0,
    component: lazy(() => import('./MediaPanel').then((m) => ({ default: m.MediaPanel }))),
  });
}
