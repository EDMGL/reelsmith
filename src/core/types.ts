/**
 * Core data model of the editor.
 *
 * Everything in a {@link Project} is plain JSON-serializable data, EXCEPT the
 * runtime-only fields of {@link MediaAsset} (`blob`, `objectURL`), which are
 * stripped on save and re-created on load (see `persistence.ts`).
 *
 * Units:
 * - All times are in **seconds** (floating point). Timeline times are "project
 *   time"; `sourceIn`/`sourceOut` are times inside the source media file.
 * - Canvas sizes are in project pixels (`project.width` x `project.height`).
 *
 * Immutability: the store never mutates a Project in place. Always produce new
 * objects (the undo history keeps references to old snapshots).
 */

/** Opaque string id (UUID-like). Use `createId()` from `src/core/ids` to make one. */
export type Id = string;

// ---------------------------------------------------------------------------
// Tracks
// ---------------------------------------------------------------------------

/** Kind of a track; determines which clip types it accepts (see `TRACK_ACCEPTS`). */
export type TrackKind = 'video' | 'audio' | 'overlay' | 'text' | 'subtitle';

export interface Track {
  id: Id;
  kind: TrackKind;
  name: string;
  /**
   * Compositing order. Tracks are drawn in ascending `order` (0 is drawn first,
   * i.e. bottom-most layer). The timeline UI lists tracks with the highest
   * order at the top. Orders are kept dense (0..n-1) by the store.
   */
  order: number;
  /** Audio of every clip on this track is silent. */
  muted: boolean;
  /** Clips on this track cannot be edited (store operations reject edits). */
  locked: boolean;
  /** Clips on this track are not rendered (preview and export). */
  hidden: boolean;
}

// ---------------------------------------------------------------------------
// Clips
// ---------------------------------------------------------------------------

export type ClipType = 'video' | 'audio' | 'image' | 'text' | 'subtitle';

/**
 * Geometric placement of a visual clip on the project canvas.
 *
 * - `x`, `y`: position of the clip's CENTER as a fraction of canvas width /
 *   height (0.5, 0.5 = centered). Fractions keep layouts sane when the aspect
 *   ratio changes.
 * - `scale`: 1 = the content's "natural fit" size. For video/image this is
 *   "contain" fit inside the canvas; for text it multiplies `style.fontSize`.
 * - `rotation`: degrees, clockwise.
 * - `opacity`: 0..1 (combined with fades by `clipOpacityAt()`).
 */
export interface Transform {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
}

/** Value types allowed in effect params (keeps them JSON-serializable). */
export type EffectParamValue = number | string | boolean;

/** One applied effect. The effect *definitions* are owned by the effects package (P2). */
export interface EffectInstance {
  id: Id;
  /** Key of the effect definition, e.g. "brightness", "blur". */
  effectType: string;
  params: Record<string, EffectParamValue>;
  /** Disabled effects are kept but skipped while rendering. Defaults to true. */
  enabled: boolean;
}

/** Fields shared by every clip type. */
export interface ClipBase<T extends ClipType = ClipType> {
  id: Id;
  type: T;
  trackId: Id;
  /** Timeline start, seconds. */
  start: number;
  /** Timeline duration, seconds (> 0). For video/audio it is derived, see {@link MediaSourceFields}. */
  duration: number;
  /** Display name in the timeline. */
  name: string;
  effects: EffectInstance[];
  /** Fade-in length (seconds) for opacity (visual) and volume (audio). */
  fadeIn: number;
  /** Fade-out length (seconds). */
  fadeOut: number;
}

/**
 * Trimming / speed fields of time-based media clips (video, audio).
 *
 * Invariant (maintained by the store): `duration === (sourceOut - sourceIn) / speed`
 * and `0 <= sourceIn < sourceOut <= asset.duration`.
 * Source time for a timeline time `t` is `sourceIn + (t - start) * speed`
 * (use `clipSourceTime()`).
 */
export interface MediaSourceFields {
  assetId: Id;
  sourceIn: number;
  sourceOut: number;
  /** Playback rate, 1 = normal. Range enforced by the store: [0.1, 16]. */
  speed: number;
  /** Linear gain, 1 = unchanged. Range [0, 4]. */
  volume: number;
}

export interface TextStroke {
  color: string;
  /** Width in project pixels. */
  width: number;
}

export interface TextShadow {
  color: string;
  blur: number;
  offsetX: number;
  offsetY: number;
}

export interface TextBackground {
  color: string;
  /** Padding in project pixels. */
  padding: number;
  /** Corner radius in project pixels. */
  radius: number;
}

/** Style of text and subtitle clips. Sizes are in project pixels. */
export interface TextStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  /** CSS color. */
  color: string;
  stroke: TextStroke | null;
  shadow: TextShadow | null;
  align: 'left' | 'center' | 'right';
  background: TextBackground | null;
  /** Line height multiplier. */
  lineHeight: number;
}

/** A shared subtitle style, referenced by `SubtitleClip.styleId`. */
/** Word-by-word highlight of the word being spoken (TikTok / karaoke style). */
export type WordHighlightMode = 'none' | 'color' | 'box' | 'karaoke';

export interface WordHighlight {
  mode: WordHighlightMode;
  /** Text color of the active word ('color'), box fill ('box'), or color of spoken words ('karaoke'). */
  color: string;
  /** Scale of the active word (1 = no "pop"). */
  pop: number;
}

export interface SubtitleStyle extends TextStyle {
  id: Id;
  name: string;
  /** Distance of the text block's bottom from the canvas bottom, fraction of canvas height. */
  bottomMargin: number;
  /** Max text block width, fraction of canvas width. */
  maxWidth: number;
  /** Word highlight (absent = none). */
  highlight?: WordHighlight;
}

/** Timing of one spoken word of a subtitle, seconds relative to the clip start. */
export interface WordTiming {
  text: string;
  start: number;
  end: number;
}

export interface VideoClip extends ClipBase<'video'>, MediaSourceFields {
  transform: Transform;
}

export interface AudioClip extends ClipBase<'audio'>, MediaSourceFields {}

/** Still image. Has no source bounds: duration is freely trimmable. */
export interface ImageClip extends ClipBase<'image'> {
  assetId: Id;
  transform: Transform;
}

export interface TextClip extends ClipBase<'text'> {
  text: string;
  style: TextStyle;
  transform: Transform;
}

export interface SubtitleClip extends ClipBase<'subtitle'> {
  text: string;
  /** Key into `project.subtitleStyles`. `DEFAULT_SUBTITLE_STYLE_ID` always exists. */
  styleId: Id;
  /** Per-clip overrides on top of the referenced style. */
  styleOverride?: Partial<TextStyle>;
  /**
   * Word timings (from speech recognition), relative to `start`. Used for word
   * highlighting; when absent or not matching the text, timings are estimated.
   */
  words?: WordTiming[];
}

/** Discriminated union of all clip types (switch on `clip.type`). */
export type Clip = VideoClip | AudioClip | ImageClip | TextClip | SubtitleClip;

/** Maps a ClipType to its clip interface, e.g. `ClipOf<'text'>` = `TextClip`. */
export type ClipOf<T extends ClipType> = Extract<Clip, { type: T }>;

/** Clips that have trimmable source media (video, audio). */
export type MediaClip = VideoClip | AudioClip;

/** Clips drawn on the canvas with a `transform`. */
export type VisualClip = VideoClip | ImageClip | TextClip;

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

export type AssetKind = 'video' | 'audio' | 'image';

export interface MediaAsset {
  id: Id;
  kind: AssetKind;
  /** Original file name. */
  name: string;
  mimeType: string;
  /** Byte size of the file. */
  size: number;
  /** Duration in seconds; `null` for images (no intrinsic duration). */
  duration: number | null;
  /** Pixel size; 0 for audio. */
  width: number;
  height: number;
  /** Best-effort detection (true for audio files). */
  hasAudio: boolean;
  /** Small JPEG data URL for library / timeline thumbnails (serializable). */
  thumbnail?: string;
  /**
   * Normalized (0..1) peak values spread evenly over the asset's duration,
   * for waveform drawing. Optional, filled asynchronously after import.
   */
  waveform?: number[];
  /**
   * 'ready': blob + objectURL usable. 'missing': restored from storage but the
   * blob could not be found (clips render nothing).
   */
  status: 'ready' | 'missing';
  /** RUNTIME ONLY (not persisted in JSON): object URL for <video>/<img>/<audio> src. */
  objectURL: string;
  /** RUNTIME ONLY (persisted separately in IndexedDB): the file data. */
  blob?: Blob;
  /**
   * Set when this asset was generated from another one by an in-app operation
   * (e.g. noise reduction), so the operation can be re-done or reverted.
   */
  derivedFrom?: { assetId: Id; operation: string; params?: Record<string, string | number | boolean> };
}

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export type AspectPresetId = '9:16' | '16:9' | '1:1' | '4:5' | '4:3' | '21:9' | 'custom';

export interface Project {
  /** Schema version for persistence migrations. */
  version: 1;
  id: Id;
  name: string;
  /** Canvas size in pixels. */
  width: number;
  height: number;
  fps: number;
  aspectPreset: AspectPresetId;
  /** Canvas background (CSS color) drawn under all tracks. */
  backgroundColor: string;
  tracks: Track[];
  /** All clips keyed by id. Use `getTrackClips()` for ordered access. */
  clips: Record<Id, Clip>;
  /** All imported assets keyed by id. */
  assets: Record<Id, MediaAsset>;
  subtitleStyles: Record<Id, SubtitleStyle>;
}

/** A half-open time interval [start, end) in seconds. */
export interface TimeRange {
  start: number;
  end: number;
}
