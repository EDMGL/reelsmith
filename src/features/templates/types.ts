/**
 * Template format. Everything here is plain JSON-serializable data: built-in
 * templates, user templates in localStorage and exported `.json` files all use
 * it. Imported data is never trusted: it goes through `validateTemplate`.
 *
 * Times are seconds from the template start. Positions/sizes are fractions of
 * the canvas, so a template works on any canvas size; text sizes are authored
 * for a 1080 px short side and scaled to the target canvas.
 */
import type { AspectPresetId, ClipShape, EffectParamValue, MotionPreset, TextStyle } from '../../core';

export const TEMPLATE_FORMAT_VERSION = 1;

/** Aspect presets a template can target ('custom' is not a template aspect). */
export type TemplateAspect = Exclude<AspectPresetId, 'custom'>;

export type SlotAccepts = 'image' | 'video' | 'any';

/**
 * How the picture sits in its frame:
 * - 'cover': fills the frame completely (cropped by the canvas edges / layers above).
 * - 'contain': the whole picture is visible inside the frame.
 */
export type SlotFit = 'cover' | 'contain';

/** A rectangle on the canvas: CENTER x/y and width/height, all fractions of the canvas. */
export interface SlotFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TemplateMotion {
  preset: MotionPreset;
  /** Zoom factor at full strength (default per preset, see the motion feature). */
  amount?: number;
  /** Seconds the move takes; 0/absent = the whole clip. */
  duration?: number;
  focusX?: number;
  focusY?: number;
}

export interface TemplateEffect {
  effectType: string;
  params: Record<string, EffectParamValue>;
}

/** Visual treatment shared by slots and their copies. */
export interface SlotLook {
  fit: SlotFit;
  /** Region the picture is fitted into (default: the whole canvas). */
  frame?: SlotFrame;
  /** Extra scale on top of the fit (default 1). */
  zoom?: number;
  /** Degrees clockwise (default 0). */
  rotation?: number;
  /** 0..1 (default 1). */
  opacity?: number;
  motion?: TemplateMotion;
  effects?: TemplateEffect[];
  shape?: ClipShape;
  fadeIn?: number;
  fadeOut?: number;
}

/**
 * Another clip that shows the SAME media as its slot, at the same time (e.g.
 * a blurred full-frame background behind a "contain" picture). Copies are
 * always silent and are not user-fillable.
 */
export interface SlotCopy extends SlotLook {
  layer: number;
}

/** A media placeholder the user fills with a photo or video. */
export interface TemplateSlot extends SlotLook {
  id: string;
  /** Optional hint shown on the slot tile (e.g. "Before"). */
  label?: string;
  start: number;
  duration: number;
  accepts: SlotAccepts;
  /**
   * Stacking layer: slots on the same layer share a track and must not
   * overlap in time; higher layers are drawn on top. The lowest layer used by
   * the template goes to the main video track.
   */
  layer: number;
  /** Volume of a video's own sound (default: 0 when the template has music, else 1). */
  volume?: number;
  copies?: SlotCopy[];
}

export interface TemplateText {
  id: string;
  /** Label of the edit field in the fill view. */
  label: string;
  text: string;
  start: number;
  duration: number;
  /** Merged over the editor's default text style. Sizes for a 1080 px short side. */
  style: Partial<TextStyle>;
  /** Center position, fractions of the canvas. */
  x: number;
  y: number;
  scale?: number;
  rotation?: number;
  opacity?: number;
  fadeIn?: number;
  fadeOut?: number;
  /** Shown as an edit field in the fill view. */
  editable: boolean;
}

/** Reference into the built-in procedural music catalogue. */
export interface TemplateMusic {
  /** `MusicTrackDef.id`. */
  trackId: string;
  /** Variation seed. */
  seed: number;
  /** Clip volume 0..1. */
  volume: number;
  fadeIn?: number;
  fadeOut?: number;
}

export interface VideoTemplate {
  formatVersion: typeof TEMPLATE_FORMAT_VERSION;
  id: string;
  name: string;
  category: string;
  description: string;
  aspect: TemplateAspect;
  /** Total length, seconds (end of the last slot/text). */
  duration: number;
  slots: TemplateSlot[];
  texts: TemplateText[];
  music?: TemplateMusic;
  /** Free-form search tags. */
  tags?: string[];
  /** Hand-made highlight (shown under "Featured"). */
  featured?: boolean;
}

/** A file exported by "Export .json". */
export interface TemplateFile {
  kind: 'erdemcut-template';
  formatVersion: typeof TEMPLATE_FORMAT_VERSION;
  template: VideoTemplate;
}
