/**
 * Factories, defaults and read-only queries over the data model.
 * All functions are pure.
 */
import { createId } from './ids';
import { TIME_EPSILON, clamp } from './time';
import type {
  AudioClip,
  Clip,
  ClipType,
  Id,
  ImageClip,
  MediaAsset,
  MediaClip,
  Project,
  SubtitleClip,
  SubtitleStyle,
  TextClip,
  TextStyle,
  Track,
  TrackKind,
  Transform,
  VideoClip,
  VisualClip,
} from './types';

export const DEFAULT_FPS = 30;
export const DEFAULT_IMAGE_DURATION = 5;
export const DEFAULT_TEXT_DURATION = 3;
export const MIN_SPEED = 0.1;
export const MAX_SPEED = 16;
export const MAX_VOLUME = 4;
export const DEFAULT_SUBTITLE_STYLE_ID = 'default';

/** Which clip types each track kind accepts. */
export const TRACK_ACCEPTS: Readonly<Record<TrackKind, readonly ClipType[]>> = {
  video: ['video', 'image'],
  overlay: ['video', 'image', 'text'],
  audio: ['audio'],
  text: ['text'],
  subtitle: ['subtitle'],
};

/** The track kind a new clip of this type goes to by default. */
export const DEFAULT_TRACK_KIND: Readonly<Record<ClipType, TrackKind>> = {
  video: 'video',
  image: 'video',
  audio: 'audio',
  text: 'text',
  subtitle: 'subtitle',
};

export function trackAccepts(track: Pick<Track, 'kind'>, clipType: ClipType): boolean {
  return TRACK_ACCEPTS[track.kind].includes(clipType);
}

export function defaultTransform(): Transform {
  return { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 };
}

export function defaultTextStyle(): TextStyle {
  return {
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSize: 96,
    fontWeight: 700,
    italic: false,
    color: '#ffffff',
    stroke: null,
    shadow: { color: 'rgba(0,0,0,0.5)', blur: 8, offsetX: 0, offsetY: 4 },
    align: 'center',
    background: null,
    lineHeight: 1.2,
  };
}

export function defaultSubtitleStyle(): SubtitleStyle {
  return {
    ...defaultTextStyle(),
    id: DEFAULT_SUBTITLE_STYLE_ID,
    name: 'Default',
    fontSize: 56,
    fontWeight: 600,
    shadow: null,
    stroke: { color: '#000000', width: 6 },
    bottomMargin: 0.08,
    maxWidth: 0.85,
  };
}

export function createTrack(kind: TrackKind, order: number, name?: string): Track {
  const label = { video: 'Video', audio: 'Audio', overlay: 'Overlay', text: 'Text', subtitle: 'Subtitles' }[kind];
  return { id: createId('track'), kind, name: name ?? label, order, muted: false, locked: false, hidden: false };
}

export function createProject(partial: Partial<Pick<Project, 'name' | 'width' | 'height' | 'fps' | 'aspectPreset'>> = {}): Project {
  // Audio tracks sit at the bottom of the order so they list under visual tracks.
  const tracks = [createTrack('audio', 0), createTrack('video', 1, 'Main')];
  return {
    version: 1,
    id: createId('project'),
    name: partial.name ?? 'Untitled project',
    width: partial.width ?? 1080,
    height: partial.height ?? 1920,
    fps: partial.fps ?? DEFAULT_FPS,
    aspectPreset: partial.aspectPreset ?? '9:16',
    backgroundColor: '#000000',
    tracks,
    clips: {},
    assets: {},
    subtitleStyles: { [DEFAULT_SUBTITLE_STYLE_ID]: defaultSubtitleStyle() },
  };
}

interface ClipCommon {
  trackId: Id;
  start: number;
  name?: string;
}

/** Builds a video/audio/image clip for an asset, using the full source range. */
export function createClipFromAsset(asset: MediaAsset, opts: ClipCommon): VideoClip | AudioClip | ImageClip {
  const base = {
    id: createId('clip'),
    trackId: opts.trackId,
    start: opts.start,
    name: opts.name ?? asset.name,
    effects: [],
    fadeIn: 0,
    fadeOut: 0,
  };
  if (asset.kind === 'image') {
    return { ...base, type: 'image', assetId: asset.id, duration: DEFAULT_IMAGE_DURATION, transform: defaultTransform() };
  }
  const srcDur = asset.duration && asset.duration > 0 ? asset.duration : DEFAULT_IMAGE_DURATION;
  const media = { assetId: asset.id, sourceIn: 0, sourceOut: srcDur, speed: 1, volume: 1, duration: srcDur };
  if (asset.kind === 'video') return { ...base, ...media, type: 'video', transform: defaultTransform() };
  return { ...base, ...media, type: 'audio' };
}

export function createTextClip(opts: ClipCommon & { text?: string; duration?: number; style?: Partial<TextStyle> }): TextClip {
  return {
    id: createId('clip'),
    type: 'text',
    trackId: opts.trackId,
    start: opts.start,
    duration: opts.duration ?? DEFAULT_TEXT_DURATION,
    name: opts.name ?? 'Text',
    effects: [],
    fadeIn: 0,
    fadeOut: 0,
    text: opts.text ?? 'Your text',
    style: { ...defaultTextStyle(), ...opts.style },
    transform: defaultTransform(),
  };
}

export function createSubtitleClip(opts: ClipCommon & { text: string; duration: number; styleId?: Id }): SubtitleClip {
  return {
    id: createId('clip'),
    type: 'subtitle',
    trackId: opts.trackId,
    start: opts.start,
    duration: opts.duration,
    name: opts.name ?? opts.text.slice(0, 40),
    effects: [],
    fadeIn: 0,
    fadeOut: 0,
    text: opts.text,
    styleId: opts.styleId ?? DEFAULT_SUBTITLE_STYLE_ID,
  };
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

export function isMediaClip(clip: Clip): clip is MediaClip {
  return clip.type === 'video' || clip.type === 'audio';
}

export function isVisualClip(clip: Clip): clip is VisualClip {
  return clip.type === 'video' || clip.type === 'image' || clip.type === 'text';
}

/** Clips that reference a media asset (video, audio, image). */
export function hasAsset(clip: Clip): clip is VideoClip | AudioClip | ImageClip {
  return clip.type === 'video' || clip.type === 'audio' || clip.type === 'image';
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function clipEnd(clip: Pick<Clip, 'start' | 'duration'>): number {
  return clip.start + clip.duration;
}

/** Tracks sorted by ascending `order` (= compositing order, bottom first). */
export function getSortedTracks(project: Project): Track[] {
  return [...project.tracks].sort((a, b) => a.order - b.order);
}

export function getTrack(project: Project, trackId: Id): Track | undefined {
  return project.tracks.find((t) => t.id === trackId);
}

/** Clips of one track sorted by start time. */
export function getTrackClips(project: Project, trackId: Id): Clip[] {
  return Object.values(project.clips)
    .filter((c) => c.trackId === trackId)
    .sort((a, b) => a.start - b.start);
}

/** Total project length = end of the last clip (0 if empty). */
export function getProjectDuration(project: Project): number {
  let end = 0;
  for (const c of Object.values(project.clips)) end = Math.max(end, clipEnd(c));
  return end;
}

/** True if the clip covers time `t` (start inclusive, end exclusive). */
export function clipContainsTime(clip: Pick<Clip, 'start' | 'duration'>, t: number): boolean {
  return t >= clip.start - TIME_EPSILON && t < clipEnd(clip) - TIME_EPSILON;
}

/**
 * Clips active at time `t`, in compositing order (bottom track first).
 * Hidden tracks are skipped unless `includeHidden`.
 */
export function getActiveClipsAt(project: Project, t: number, includeHidden = false): { clip: Clip; track: Track }[] {
  const out: { clip: Clip; track: Track }[] = [];
  for (const track of getSortedTracks(project)) {
    if (track.hidden && !includeHidden) continue;
    for (const clip of getTrackClips(project, track.id)) {
      if (clipContainsTime(clip, t)) out.push({ clip, track });
    }
  }
  return out;
}

/** Time inside the source media for timeline time `t` (video/audio clips). */
export function clipSourceTime(clip: MediaClip, t: number): number {
  return clamp(clip.sourceIn + (t - clip.start) * clip.speed, clip.sourceIn, clip.sourceOut);
}

/** Fade multiplier 0..1 at `localTime` (seconds since clip start) from fadeIn/fadeOut. */
export function fadeFactor(clip: Pick<Clip, 'duration' | 'fadeIn' | 'fadeOut'>, localTime: number): number {
  let f = 1;
  if (clip.fadeIn > 0) f = Math.min(f, clamp(localTime / clip.fadeIn, 0, 1));
  if (clip.fadeOut > 0) f = Math.min(f, clamp((clip.duration - localTime) / clip.fadeOut, 0, 1));
  return f;
}

/** Effective opacity of a clip at `localTime`: transform.opacity (if any) x fades. */
export function clipOpacityAt(clip: Clip, localTime: number): number {
  const base = isVisualClip(clip) ? clip.transform.opacity : 1;
  return base * fadeFactor(clip, localTime);
}

/** Effective audio gain at `localTime`: volume x fades, 0 if the track is muted. */
export function clipGainAt(clip: MediaClip, localTime: number, track?: Pick<Track, 'muted'>): number {
  if (track?.muted) return 0;
  return clip.volume * fadeFactor(clip, localTime);
}

/** Resolved style of a subtitle clip (shared style + per-clip overrides). */
export function resolveSubtitleStyle(project: Project, clip: SubtitleClip): SubtitleStyle {
  const base =
    project.subtitleStyles[clip.styleId] ?? project.subtitleStyles[DEFAULT_SUBTITLE_STYLE_ID] ?? defaultSubtitleStyle();
  return { ...base, ...clip.styleOverride };
}
