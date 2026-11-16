import type { AspectPresetId } from './types';

export interface AspectPreset {
  id: Exclude<AspectPresetId, 'custom'>;
  label: string;
  /** Typical destination, for UI hints. */
  hint: string;
  width: number;
  height: number;
}

/** Built-in canvas size presets. 'custom' is any other W x H. */
export const ASPECT_PRESETS: readonly AspectPreset[] = [
  { id: '9:16', label: '9:16', hint: 'Vertical (Reels, Shorts, TikTok)', width: 1080, height: 1920 },
  { id: '16:9', label: '16:9', hint: 'Widescreen (YouTube)', width: 1920, height: 1080 },
  { id: '1:1', label: '1:1', hint: 'Square post', width: 1080, height: 1080 },
  { id: '4:5', label: '4:5', hint: 'Portrait feed post', width: 1080, height: 1350 },
  { id: '4:3', label: '4:3', hint: 'Classic', width: 1440, height: 1080 },
  { id: '21:9', label: '21:9', hint: 'Cinematic', width: 2520, height: 1080 },
];

export function getAspectPreset(id: AspectPresetId): AspectPreset | undefined {
  return ASPECT_PRESETS.find((p) => p.id === id);
}

/** Returns the preset matching a W x H exactly, else 'custom'. */
export function detectAspectPreset(width: number, height: number): AspectPresetId {
  return ASPECT_PRESETS.find((p) => p.width === width && p.height === height)?.id ?? 'custom';
}

/** Canvas size limits enforced by the store (even numbers keep encoders happy). */
export const CANVAS_MIN = 16;
export const CANVAS_MAX = 7680;

export function sanitizeCanvasSize(width: number, height: number): { width: number; height: number } {
  const fix = (n: number) => {
    const v = Math.round(Number.isFinite(n) ? n : CANVAS_MIN);
    const c = Math.min(CANVAS_MAX, Math.max(CANVAS_MIN, v));
    return c % 2 === 0 ? c : c - 1;
  };
  return { width: fix(width), height: fix(height) };
}

/**
 * Largest rectangle with aspect `width:height` that fits in a box of
 * `boxW` x `boxH` (contain fit), centered. Handy for preview stages.
 */
export function fitRect(
  width: number,
  height: number,
  boxW: number,
  boxH: number,
): { x: number; y: number; width: number; height: number; scale: number } {
  if (width <= 0 || height <= 0 || boxW <= 0 || boxH <= 0) return { x: 0, y: 0, width: 0, height: 0, scale: 0 };
  const scale = Math.min(boxW / width, boxH / height);
  const w = width * scale;
  const h = height * scale;
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, width: w, height: h, scale };
}
