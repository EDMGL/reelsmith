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
  WordTiming,
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

export function createSubtitleClip(opts: ClipCommon & { text: string; duration: number; styleId?: Id; words?: WordTiming[] }): SubtitleClip {
  return {
    ...(opts.words && opts.words.length > 0 ? { words: opts.words } : {}),
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

// ---------------------------------------------------------------------------
// Per-project query index
// ---------------------------------------------------------------------------

/**
 * Read-only lookup structures derived from ONE immutable project object:
 * tracks in compositing order, every track's clips sorted by start, and the
 * running maximum clip end per track (for binary-searching active clips).
 * Built lazily on first query and cached per project object (WeakMap), so
 * per-frame queries cost O(tracks x log clips) instead of O(tracks x clips).
 * Treat it as frozen: never mutate the arrays.
 */
export interface ProjectIndex {
  readonly sortedTracks: readonly Track[];
  readonly trackById: ReadonlyMap<Id, Track>;
  /** Clips of each track sorted by start (stable: ties keep `project.clips` order). */
  readonly clipsByTrack: ReadonlyMap<Id, readonly Clip[]>;
  /** `maxEnd[trackId][i]` = max clip end among `clipsByTrack[trackId][0..i]`. */
  readonly maxEndByTrack: ReadonlyMap<Id, Float64Array>;
  /** End of the last clip (0 if empty). */
  readonly duration: number;
}

const EMPTY_CLIPS: readonly Clip[] = Object.freeze([]);
const projectIndexes = new WeakMap<Project, ProjectIndex>();

function buildProjectIndex(project: Project): ProjectIndex {
  const sortedTracks = [...project.tracks].sort((a, b) => a.order - b.order);
  const trackById = new Map<Id, Track>();
  for (const t of project.tracks) if (!trackById.has(t.id)) trackById.set(t.id, t);
  const buckets = new Map<Id, Clip[]>();
  let duration = 0;
  for (const c of Object.values(project.clips)) {
    let b = buckets.get(c.trackId);
    if (!b) buckets.set(c.trackId, (b = []));
    b.push(c);
    duration = Math.max(duration, clipEnd(c));
  }
  const maxEndByTrack = new Map<Id, Float64Array>();
  for (const [trackId, clips] of buckets) {
    clips.sort((a, b) => a.start - b.start);
    const maxEnd = new Float64Array(clips.length);
    let m = -Infinity;
    for (let i = 0; i < clips.length; i++) {
      m = Math.max(m, clipEnd(clips[i]!));
      maxEnd[i] = m;
    }
    maxEndByTrack.set(trackId, maxEnd);
  }
  return { sortedTracks, trackById, clipsByTrack: buckets, maxEndByTrack, duration };
}

/** The cached query index of a project object (built on first use). */
export function getProjectIndex(project: Project): ProjectIndex {
  let idx = projectIndexes.get(project);
  if (!idx) {
    idx = buildProjectIndex(project);
    projectIndexes.set(project, idx);
  }
  return idx;
}

/** Index of the last clip with `start <= x` in a start-sorted array (-1 if none). */
function lastStartingAtOrBefore(clips: readonly Clip[], x: number): number {
  let lo = 0;
  let hi = clips.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (clips[mid]!.start <= x) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/**
 * Clips of one track that cover `t` (`clipContainsTime`), sorted by start.
 * O(log n + hits) via the project index.
 */
export function getTrackClipsAt(project: Project, trackId: Id, t: number): Clip[] {
  const idx = getProjectIndex(project);
  const clips = idx.clipsByTrack.get(trackId);
  if (!clips || clips.length === 0) return [];
  const maxEnd = idx.maxEndByTrack.get(trackId)!;
  const out: Clip[] = [];
  // Candidates start at or before t + eps; walk back while some earlier clip may still cover t.
  for (let i = lastStartingAtOrBefore(clips, t + TIME_EPSILON); i >= 0; i--) {
    if (!(t < maxEnd[i]! - TIME_EPSILON)) break;
    const c = clips[i]!;
    if (clipContainsTime(c, t)) out.push(c);
  }
  return out.reverse();
}

/**
 * Clips of one track whose start lies in `(from, to]`, sorted by start.
 * O(log n + hits) via the project index.
 */
export function getTrackClipsStartingIn(project: Project, trackId: Id, from: number, to: number): Clip[] {
  const clips = getProjectIndex(project).clipsByTrack.get(trackId);
  if (!clips || !(to > from)) return [];
  const out: Clip[] = [];
  for (let i = lastStartingAtOrBefore(clips, from) + 1; i < clips.length; i++) {
    const c = clips[i]!;
    if (c.start > to) break;
    if (c.start > from) out.push(c);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Tracks sorted by ascending `order` (= compositing order, bottom first). Returns a fresh array. */
export function getSortedTracks(project: Project): Track[] {
  return getProjectIndex(project).sortedTracks.slice();
}

export function getTrack(project: Project, trackId: Id): Track | undefined {
  // Few tracks: a scan is cheaper than building the index for a short-lived intermediate project.
  return project.tracks.find((t) => t.id === trackId);
}

/** Clips of one track sorted by start time. Returns a fresh array. */
export function getTrackClips(project: Project, trackId: Id): Clip[] {
  return (getProjectIndex(project).clipsByTrack.get(trackId) ?? EMPTY_CLIPS).slice();
}

/** Total project length = end of the last clip (0 if empty). Cached per project object. */
export function getProjectDuration(project: Project): number {
  return getProjectIndex(project).duration;
}

/** True if the clip covers time `t` (start inclusive, end exclusive). */
export function clipContainsTime(clip: Pick<Clip, 'start' | 'duration'>, t: number): boolean {
  return t >= clip.start - TIME_EPSILON && t < clipEnd(clip) - TIME_EPSILON;
}

/**
 * Clips active at time `t`, in compositing order (bottom track first; within a
 * track by start). Hidden tracks are skipped unless `includeHidden`.
 * O(tracks x log clips) through the cached project index.
 */
export function getActiveClipsAt(project: Project, t: number, includeHidden = false): { clip: Clip; track: Track }[] {
  const out: { clip: Clip; track: Track }[] = [];
  for (const track of getProjectIndex(project).sortedTracks) {
    if (track.hidden && !includeHidden) continue;
    for (const clip of getTrackClipsAt(project, track.id, t)) out.push({ clip, track });
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
