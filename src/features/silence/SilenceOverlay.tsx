import type { CSSProperties } from 'react';
import { useEditorStore, type TimelineOverlayProps } from '../../core';
import { isStale, useSilenceStore } from './silenceStore';

const base: CSSProperties = { position: 'absolute', top: 0, bottom: 0, pointerEvents: 'none', boxSizing: 'border-box' };
const includedStyle: CSSProperties = {
  ...base,
  background: 'var(--danger-soft)',
  borderLeft: '1px solid var(--danger)',
  borderRight: '1px solid var(--danger)',
};
const excludedStyle: CSSProperties = {
  ...base,
  background: 'repeating-linear-gradient(135deg, var(--border-strong) 0 6px, transparent 6px 12px)',
  borderLeft: '1px dashed var(--border-hover)',
  borderRight: '1px dashed var(--border-hover)',
};

/** Detected silences as bands over the timeline (never intercepts pointer events). */
export default function SilenceOverlay({ timeToPx, height }: TimelineOverlayProps) {
  const result = useSilenceStore((s) => s.result);
  const stale = useEditorStore((s) => isStale(result, s.project));
  if (!result || result.ranges.length === 0) return null;
  return (
    <div
      className="silence-overlay"
      data-testid="silence-overlay"
      style={{ position: 'absolute', inset: 0, height, pointerEvents: 'none', opacity: stale ? 0.4 : 1 }}
    >
      {result.ranges.map((r) => {
        const left = timeToPx(r.start);
        const width = Math.max(1, timeToPx(r.end) - left);
        return (
          <div
            key={`${r.start}-${r.end}`}
            className={r.included ? 'silence-band' : 'silence-band excluded'}
            data-start={r.start}
            data-end={r.end}
            title={`Silence ${r.start.toFixed(2)}–${r.end.toFixed(2)} s${r.included ? '' : ' (excluded)'}`}
            style={{ ...(r.included ? includedStyle : excludedStyle), left, width }}
          />
        );
      })}
    </div>
  );
}
