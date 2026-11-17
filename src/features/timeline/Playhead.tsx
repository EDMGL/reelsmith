import { useLayoutEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { useEditorStore } from '../../core';

/**
 * Playhead marker that follows `currentTime` IMPERATIVELY (store subscription +
 * CSS transform). Playback ticks therefore cause no React render anywhere in
 * the timeline — not even of this component.
 */
export function PlayheadMarker({
  className,
  zoom,
  offset = 0,
  onPointerDown,
}: {
  className: string;
  zoom: number;
  /** px added to time * zoom (e.g. the track header width). */
  offset?: number;
  onPointerDown?: (e: ReactPointerEvent) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = (t: number) => {
      el.style.transform = `translate3d(${offset + t * zoom}px,0,0)`;
    };
    place(useEditorStore.getState().currentTime);
    return useEditorStore.subscribe((s, prev) => {
      if (s.currentTime !== prev.currentTime) place(s.currentTime);
    });
  }, [zoom, offset]);
  return <div ref={ref} className={className} onPointerDown={onPointerDown} aria-hidden data-testid={className} />;
}
