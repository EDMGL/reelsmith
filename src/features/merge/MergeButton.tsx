import { useEffect } from 'react';
import { useEditorStore } from '../../core';
import { planMerge } from './merge';
import { cancelMerge, startMerge, useMergeStore } from './mergeStore';

/** Timeline toolbar "Merge" button: progress + cancel while running, result as a tooltip/inline note. */
export default function MergeButton() {
  const running = useMergeStore((s) => s.running);
  const fraction = useMergeStore((s) => s.fraction);
  const message = useMergeStore((s) => s.message);
  // A primitive selector result (a fresh object would re-render forever): '' = mergeable, else why not.
  const whyNot = useEditorStore((s) => {
    const r = planMerge(s.project, s.selectedClipIds);
    return r.ok ? '' : r.error;
  });
  const canMerge = whyNot === '';

  // Result notes fade after a while.
  useEffect(() => {
    if (!message || running) return;
    const t = setTimeout(() => useMergeStore.setState({ message: null }), 8000);
    return () => clearTimeout(t);
  }, [message, running]);

  if (running) {
    return (
      <button type="button" className="btn btn-small btn-ghost" data-action="merge:clips" title="Cancel merging" onClick={cancelMerge}>
        <span className="btn-icon" aria-hidden>
          ⧉
        </span>
        <span className="btn-label">Merging {Math.round(fraction * 100)}% ✕</span>
      </button>
    );
  }
  return (
    <>
      <button
        type="button"
        className="btn btn-small btn-ghost"
        data-action="merge:clips"
        aria-label="Merge clips"
        title={
          canMerge
            ? 'Bake the selected clips (and their detached audio) into one clip. Subtitles keep their timing; plays much smoother.'
            : whyNot
        }
        disabled={!canMerge}
        onClick={() => void startMerge()}
      >
        <span className="btn-icon" aria-hidden>
          ⧉
        </span>
        <span className="btn-label">Merge</span>
      </button>
      {message && (
        <span role="status" className={`merge-note merge-note-${message.kind}`} style={{ fontSize: 12, alignSelf: 'center', color: message.kind === 'error' ? 'var(--danger, #e5484d)' : 'var(--text-muted, inherit)' }}>
          {message.text}
        </span>
      )}
    </>
  );
}
