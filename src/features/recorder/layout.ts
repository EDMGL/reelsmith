/**
 * Pure placement math for the camera bubble (unit-tested).
 */
import { containSize, type ClipShape, type Transform } from '../../core';

export type BubbleCorner = 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';
export type BubbleSize = 'small' | 'medium' | 'large';
export type BubbleShape = 'circle' | 'rounded';

const SIZE: Record<BubbleSize, number> = { small: 0.22, medium: 0.3, large: 0.4 };

/**
 * Transform + shape that put a camera picture of `camW x camH` into a corner of
 * the canvas. Circle: diameter = SIZE x the canvas' shorter side. Rounded:
 * width = SIZE x 1.4 of the canvas' shorter side (keeps the camera aspect).
 */
export function bubbleLayout(
  camW: number,
  camH: number,
  canvasW: number,
  canvasH: number,
  opts: { corner: BubbleCorner; size: BubbleSize; shape: BubbleShape },
): { transform: Transform; shape: ClipShape } {
  const base = containSize(camW, camH, canvasW, canvasH);
  const short = Math.min(canvasW, canvasH);
  const margin = short * 0.05;
  let w: number;
  let h: number;
  let scale: number;
  if (opts.shape === 'circle') {
    const d = SIZE[opts.size] * short;
    scale = d / Math.max(1, Math.min(base.width, base.height));
    w = d;
    h = d;
  } else {
    const targetW = SIZE[opts.size] * 1.4 * short;
    scale = targetW / Math.max(1, base.width);
    w = targetW;
    h = base.height * scale;
  }
  const left = opts.corner.endsWith('left');
  const top = opts.corner.startsWith('top');
  const cx = left ? margin + w / 2 : canvasW - margin - w / 2;
  // Keep clear of the bottom caption area on tall canvases.
  const bottomMargin = canvasH > canvasW ? canvasH * 0.18 : margin;
  const cy = top ? margin + h / 2 : canvasH - bottomMargin - h / 2;
  return {
    transform: { x: cx / canvasW, y: cy / canvasH, scale, rotation: 0, opacity: 1 },
    shape: { kind: opts.shape, radius: 0.12, border: Math.round(short * 0.006), borderColor: '#ffffff' },
  };
}
