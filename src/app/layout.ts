/**
 * Shell layout sizes (left panel, inspector, timeline height, collapsed
 * panels): remembered in localStorage, applied as CSS custom properties on
 * the `.app` grid. Drag handles update the DOM directly while dragging and
 * commit to React state on release, so resizing never re-renders the editor
 * per pointer move.
 */
import { useCallback, useState } from 'react';

export interface LayoutSizes {
  left: number;
  right: number;
  timeline: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
}

export const LAYOUT_STORAGE_KEY = 'erdemcut:layout';
export const LAYOUT_LIMITS = {
  left: { min: 260, max: 560 },
  right: { min: 250, max: 460 },
  timeline: { min: 180, max: 640 },
} as const;
export const DEFAULT_LAYOUT: LayoutSizes = { left: 360, right: 300, timeline: 300, leftCollapsed: false, rightCollapsed: false };

export const clampSize = (k: keyof typeof LAYOUT_LIMITS, v: number): number =>
  Math.round(Math.min(LAYOUT_LIMITS[k].max, Math.max(LAYOUT_LIMITS[k].min, v)));

export function loadLayout(): LayoutSizes {
  try {
    const raw = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_LAYOUT };
    const v = JSON.parse(raw) as Partial<LayoutSizes>;
    const num = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
    return {
      left: clampSize('left', num(v.left, DEFAULT_LAYOUT.left)),
      right: clampSize('right', num(v.right, DEFAULT_LAYOUT.right)),
      timeline: clampSize('timeline', num(v.timeline, DEFAULT_LAYOUT.timeline)),
      leftCollapsed: v.leftCollapsed === true,
      rightCollapsed: v.rightCollapsed === true,
    };
  } catch {
    return { ...DEFAULT_LAYOUT };
  }
}

function saveLayout(l: LayoutSizes): void {
  try {
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(l));
  } catch {
    /* storage unavailable: sizes just aren't remembered */
  }
}

export function useLayoutSizes(): [LayoutSizes, (patch: Partial<LayoutSizes>) => void] {
  const [layout, setLayout] = useState(loadLayout);
  const update = useCallback((patch: Partial<LayoutSizes>) => {
    setLayout((prev) => {
      const next = { ...prev, ...patch };
      saveLayout(next);
      return next;
    });
  }, []);
  return [layout, update];
}
