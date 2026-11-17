import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { LAYOUT_LIMITS, clampSize } from './layout';

type SizeKey = keyof typeof LAYOUT_LIMITS;

const CSS_VAR: Record<SizeKey, string> = { left: '--left-w', right: '--right-w', timeline: '--timeline-h' };

interface Props {
  size: SizeKey;
  value: number;
  /** +1: dragging right/down grows the pane; -1: dragging left/up grows it. */
  direction: 1 | -1;
  defaultValue: number;
  label: string;
  appRef: RefObject<HTMLDivElement | null>;
  onCommit: (value: number) => void;
}

/**
 * Splitter between shell panes. While dragging it only sets a CSS variable on
 * the app grid (no React render per move); the final size is committed once.
 */
export function ResizeHandle({ size, value, direction, defaultValue, label, appRef, onCommit }: Props) {
  const vertical = size === 'timeline';
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const app = appRef.current;
    const el = e.currentTarget;
    const start = vertical ? e.clientY : e.clientX;
    let current = value;
    el.setPointerCapture?.(e.pointerId);
    el.classList.add('dragging');
    app?.classList.add(vertical ? 'resizing-y' : 'resizing-x');
    const move = (ev: PointerEvent) => {
      const delta = ((vertical ? ev.clientY : ev.clientX) - start) * direction;
      current = clampSize(size, value + delta);
      app?.style.setProperty(CSS_VAR[size], `${current}px`);
    };
    const end = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
      el.classList.remove('dragging');
      app?.classList.remove('resizing-x', 'resizing-y');
      onCommit(current);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  };
  const onKeyDown = (e: ReactKeyboardEvent) => {
    const step = e.shiftKey ? 48 : 16;
    const grow = vertical ? ['ArrowUp'] : direction === 1 ? ['ArrowRight'] : ['ArrowLeft'];
    const shrink = vertical ? ['ArrowDown'] : direction === 1 ? ['ArrowLeft'] : ['ArrowRight'];
    if (grow.includes(e.key)) onCommit(clampSize(size, value + step));
    else if (shrink.includes(e.key)) onCommit(clampSize(size, value - step));
    else if (e.key === 'Home' || e.key === 'Enter') onCommit(defaultValue);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  return (
    <div
      className={`resize-handle resize-${size}`}
      role="separator"
      aria-orientation={vertical ? 'horizontal' : 'vertical'}
      aria-label={label}
      aria-valuemin={LAYOUT_LIMITS[size].min}
      aria-valuemax={LAYOUT_LIMITS[size].max}
      aria-valuenow={value}
      tabIndex={0}
      title={`${label} (double-click to reset)`}
      onPointerDown={onPointerDown}
      onDoubleClick={() => onCommit(defaultValue)}
      onKeyDown={onKeyDown}
    />
  );
}
