import { memo, type PointerEvent as ReactPointerEvent } from 'react';
import { formatDuration, rulerStep } from '../../core';

interface RulerProps {
  zoom: number;
  width: number;
  /** Visible time window (only ticks inside are rendered). */
  viewStart: number;
  viewEnd: number;
  onPointerDown: (e: ReactPointerEvent) => void;
}

function label(t: number, step: number): string {
  if (step < 1) return `${t.toFixed(2)}s`;
  return formatDuration(t).replace(/\.0$/, '');
}

export const Ruler = memo(function Ruler({ zoom, width, viewStart, viewEnd, onPointerDown }: RulerProps) {
  const step = rulerStep(zoom);
  const minor = step / 5;
  const ticks: { t: number; major: boolean }[] = [];
  const first = Math.max(0, Math.floor(viewStart / minor) * minor);
  for (let i = 0, t = first; t <= viewEnd + minor && i < 2000; i++, t = first + i * minor) {
    const r = t / step;
    ticks.push({ t, major: Math.abs(r - Math.round(r)) < 1e-6 });
  }
  return (
    <div className="ruler" style={{ width }} onPointerDown={onPointerDown} role="slider" aria-label="Timeline ruler" aria-valuemin={0}>
      {ticks.map(({ t, major }) => (
        <div key={t.toFixed(4)} className={major ? 'tick major' : 'tick'} style={{ left: t * zoom }}>
          {major && <span className="tick-label">{label(t, step)}</span>}
        </div>
      ))}
    </div>
  );
});
