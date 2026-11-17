import { lazy, Suspense } from 'react';
import { Icon } from '../../core';
import { useExportStore } from './exportStore';

const ExportDialog = lazy(() => import('./ExportDialog'));

/** Top-bar "Export" primary button + its dialog. */
export default function ExportButton() {
  const open = useExportStore((s) => s.open);
  const running = useExportStore((s) => s.status === 'running');
  const fraction = useExportStore((s) => s.progress?.fraction ?? 0);
  return (
    <>
      <button
        type="button"
        className="btn btn-primary"
        title="Export the project to a video file"
        onClick={() => useExportStore.getState().openDialog()}
      >
        <Icon name="export" />
        {running ? `Exporting ${Math.round(fraction * 100)}%` : 'Export'}
      </button>
      {open && (
        <Suspense fallback={null}>
          <ExportDialog />
        </Suspense>
      )}
    </>
  );
}
