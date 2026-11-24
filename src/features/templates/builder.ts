/**
 * Template builder (pure): turns a template + the user's media/text choices
 * into tracks and ordinary clips for a target project. No store access, so it
 * is fully unit-testable; `apply.ts` commits the result as one undo step.
 *
 * Rules:
 * - Media fills its frame ("cover") by default, whatever the source aspect.
 * - Images get the slot duration and the slot's motion.
 * - Videos are trimmed to the slot: a window that skips a little of the start
 *   (often shaky) and, when the same video fills several slots, moves on so
 *   the slots show different moments.
 * - A video SHORTER than its slot is slowed down (down to `MIN_TEMPLATE_SPEED`).
 *   If even that is not enough, a slot on the main layer is shortened and
 *   everything after it moves earlier (gap closed); slots on upper layers just
 *   end early. Source bounds are never exceeded.
 * - Fewer media than slots: the supplied media are cycled in order.
 */
import {
  clamp,
  containSize,
  createClipFromAsset,
  createId,
  createTextClip,
  getProjectDuration,
  getSortedTracks,
  ops,
  TIME_EPSILON,
  type AudioClip,
  type Clip,
  type ClipMotion,
  type EffectInstance,
  type Id,
  type ImageClip,
  type MediaAsset,
  type Project,
  type Track,
  type TrackKind,
  type Transform,
  type VideoClip,
} from '../../core';
import { motionFor } from '../motion/motion';
import { findFreeAudioTrack, MUSIC_TRACK_NAME } from '../music/timeline';
import type { SlotLook, TemplateSlot, VideoTemplate } from './types';

/** Slowest playback used to stretch a too-short video (slower looks broken). */
export const MIN_TEMPLATE_SPEED = 0.5;
/** Seconds skipped at most at the start of a video when it is longer than the slot. */
export const MAX_LEAD_IN = 1.5;
/** Text sizes in templates are authored for this short canvas side. */
export const TEXT_REFERENCE_SIDE = 1080;
export const BACKGROUND_TRACK_NAME = 'Background';

/** User choice per slot id (undefined = empty). */
export type SlotAssignments = Readonly<Record<string, Id | undefined>>;
/** User text per editable text id (undefined = template default, '' = leave the text out). */
export type TextValues = Readonly<Record<string, string | undefined>>;

export interface ResolvedSlot {
  slotId: string;
  assetId: Id | null;
  /** True when the slot was not filled by the user and repeats earlier media. */
  cycled: boolean;
}

export interface NewTrackSpec {
  /** Placeholder id used in `clips[].trackId` until the track exists. */
  key: string;
  kind: TrackKind;
  name: string;
  /** Insert directly below this track (existing id or another spec's key) instead of on top. */
  below?: string;
}

export interface BuildOptions {
  /** Timeline time where the template starts (default 0). */
  start?: number;
  /** Rendered music asset (exactly the template length); omit to build without music. */
  musicAsset?: MediaAsset;
}

export interface BuildResult {
  /** Tracks to create, in creation order. Visual/text tracks go on top of the stack, audio at the bottom. */
  newTracks: NewTrackSpec[];
  /** Clips to add; `trackId` is an existing track id or a `newTracks[].key`. */
  clips: Clip[];
  start: number;
  /** Final length (shorter than the template when a short video closed a gap). */
  duration: number;
  slots: ResolvedSlot[];
  /** Human-readable notes (short videos, type mismatches, …). */
  warnings: string[];
}

const NEW_TRACK_PREFIX = 'new-track:';
export const isNewTrackKey = (id: string) => id.startsWith(NEW_TRACK_PREFIX);

const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------

export function assetFits(slot: Pick<TemplateSlot, 'accepts'>, asset: Pick<MediaAsset, 'kind'>): boolean {
  if (asset.kind === 'audio') return false;
  return slot.accepts === 'any' || slot.accepts === asset.kind;
}

/** Usable picture assets (ready image/video) of a project, by id. */
function pictureAsset(project: Project, id: Id | undefined): MediaAsset | undefined {
  if (!id) return undefined;
  const a = project.assets[id];
  return a && (a.kind === 'image' || a.kind === 'video') ? a : undefined;
}

/**
 * Effective media per slot: the user's choice, else the next of the supplied
 * media in cycle order (slot order of the user's choices).
 */
export function resolveAssignments(template: VideoTemplate, assignments: SlotAssignments, project: Project): ResolvedSlot[] {
  const supplied: Id[] = [];
  for (const s of template.slots) {
    const a = pictureAsset(project, assignments[s.id]);
    if (a && !supplied.includes(a.id)) supplied.push(a.id);
  }
  let k = 0;
  return template.slots.map((s) => {
    const own = pictureAsset(project, assignments[s.id]);
    if (own) return { slotId: s.id, assetId: own.id, cycled: false };
    if (supplied.length === 0) return { slotId: s.id, assetId: null, cycled: false };
    // Prefer media of the accepted kind when cycling.
    const fitting = supplied.filter((id) => assetFits(s, project.assets[id]!));
    const pool = fitting.length ? fitting : supplied;
    return { slotId: s.id, assetId: pool[k++ % pool.length]!, cycled: true };
  });
}

/**
 * Assigns new media to slots in order: empty slots first (skipping slots that
 * do not accept the media kind while a fitting one is free). Returns the new
 * assignments and the media that found no slot.
 */
export function autoAssign(
  template: VideoTemplate,
  current: SlotAssignments,
  media: readonly Pick<MediaAsset, 'id' | 'kind'>[],
): { assignments: Record<string, Id | undefined>; unused: Id[] } {
  const next: Record<string, Id | undefined> = { ...current };
  const unused: Id[] = [];
  for (const m of media) {
    if (m.kind === 'audio') {
      unused.push(m.id);
      continue;
    }
    const empty = template.slots.filter((s) => !next[s.id]);
    const slot = empty.find((s) => assetFits(s, m)) ?? empty[0];
    if (!slot) unused.push(m.id);
    else next[slot.id] = m.id;
  }
  return { assignments: next, unused };
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/**
 * Transform placing a W x H picture by a slot look on a canvas. `Transform.scale`
 * 1 = contain fit in the whole canvas, so frame fits are relative to that.
 */
export function slotTransform(look: SlotLook, assetW: number, assetH: number, canvasW: number, canvasH: number): Transform {
  const f = look.frame ?? { x: 0.5, y: 0.5, w: 1, h: 1 };
  const c = containSize(assetW, assetH, canvasW, canvasH);
  let scale = 1;
  if (c.width > 0 && c.height > 0) {
    const sx = (f.w * canvasW) / c.width;
    const sy = (f.h * canvasH) / c.height;
    scale = look.fit === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy);
  }
  return {
    x: f.x,
    y: f.y,
    scale: r6(scale * (look.zoom ?? 1)),
    rotation: look.rotation ?? 0,
    opacity: clamp(look.opacity ?? 1, 0, 1),
  };
}

function lookMotion(look: SlotLook): ClipMotion | undefined {
  const m = look.motion;
  if (!m || m.preset === 'none') return undefined;
  const base = motionFor(m.preset);
  return {
    ...base,
    amount: m.amount ?? base.amount,
    duration: m.duration ?? 0,
    focusX: m.focusX ?? base.focusX,
    focusY: m.focusY ?? base.focusY,
  };
}

function lookEffects(look: SlotLook): EffectInstance[] {
  return (look.effects ?? []).map((e) => ({ id: createId('fx'), effectType: e.effectType, params: { ...e.params }, enabled: true }));
}

// ---------------------------------------------------------------------------
// Timing (short videos on the main layer close their gap)
// ---------------------------------------------------------------------------

interface Shrink {
  a: number;
  /** Original and new length. */
  d: number;
  nd: number;
}

/** Timeline mapping after shortening slots: later times move earlier. */
function makeTimeMap(shrinks: readonly Shrink[]): (t: number) => number {
  if (shrinks.length === 0) return (t) => t;
  return (t) => {
    let out = t;
    for (const s of shrinks) {
      if (t >= s.a + s.d - TIME_EPSILON) out -= s.d - s.nd;
      else if (t > s.a + s.nd) out -= t - (s.a + s.nd);
    }
    return r6(out);
  };
}

function videoSeconds(a: MediaAsset): number | null {
  return a.kind === 'video' && a.duration && a.duration > 0 ? a.duration : null;
}

// ---------------------------------------------------------------------------
// Tracks
// ---------------------------------------------------------------------------

interface TrackPlan {
  newTracks: NewTrackSpec[];
  /** Picks a track for the next layer up; creates (virtually) when none of the existing ones fit. */
  take(kinds: readonly TrackKind[], newKind: TrackKind, name: string, prefer?: (t: Track) => boolean): string;
  /** Picks a track directly below `ref` (an existing id or a new-track key). */
  takeBelow(ref: string, kinds: readonly TrackKind[], newKind: TrackKind, name: string): string;
}

/**
 * Existing tracks are reused bottom-up while they are unlocked, compatible and
 * free in [from, to); once one has to be created, every later one is new too
 * (new tracks are stacked on top), so the template's layer order is kept.
 * Background layers below the main one go to the free track right under it,
 * or to a new track inserted there.
 */
function planTracks(project: Project, from: number, to: number): TrackPlan {
  const sorted = getSortedTracks(project).filter((t) => t.kind !== 'audio');
  const free = (t: Track) => !t.locked && !ops.hasOverlap(project, t.id, from, to);
  const used = new Set<string>();
  let cursor = -1;
  let creating = false;
  const newTracks: NewTrackSpec[] = [];
  const create = (kind: TrackKind, name: string, below?: string) => {
    const key = `${NEW_TRACK_PREFIX}${newTracks.length}`;
    newTracks.push({ key, kind, name, ...(below ? { below } : {}) });
    return key;
  };
  return {
    newTracks,
    take(kinds, newKind, name, prefer) {
      if (!creating) {
        const ok = (t: Track) => t.order > cursor && kinds.includes(t.kind) && free(t);
        const hit = (prefer && sorted.find((t) => ok(t) && prefer(t))) || sorted.find(ok);
        if (hit) {
          cursor = hit.order;
          used.add(hit.id);
          return hit.id;
        }
        creating = true;
      }
      return create(newKind, name);
    },
    takeBelow(ref, kinds, newKind, name) {
      const refTrack = sorted.find((t) => t.id === ref);
      if (refTrack) {
        const below = sorted.filter((t) => t.order < refTrack.order).reverse()[0];
        if (below && !used.has(below.id) && kinds.includes(below.kind) && free(below)) {
          used.add(below.id);
          return below.id;
        }
      }
      return create(newKind, name, ref);
    },
  };
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export class TemplateBuildError extends Error {}

export function buildTemplate(
  template: VideoTemplate,
  assignments: SlotAssignments,
  texts: TextValues,
  project: Project,
  opts: BuildOptions = {},
): BuildResult {
  const start = r6(Math.max(0, opts.start ?? 0));
  const warnings: string[] = [];
  const resolved = resolveAssignments(template, assignments, project);
  if (resolved.every((r) => !r.assetId)) throw new TemplateBuildError('Add at least one photo or video to the template.');
  const assetOf = new Map(resolved.map((r) => [r.slotId, r.assetId ? project.assets[r.assetId]! : null]));
  const slotNo = new Map(template.slots.map((s, i) => [s.id, i + 1]));

  for (const s of template.slots) {
    const a = assetOf.get(s.id);
    if (a && !assetFits(s, a)) warnings.push(`Slot ${slotNo.get(s.id)} is meant for ${s.accepts === 'image' ? 'a photo' : 'a video'}; “${a.name}” is used anyway.`);
  }

  // 1) Main-layer videos too short even when slowed down shorten their slot.
  const layers = [...new Set(template.slots.flatMap((s) => [s.layer, ...(s.copies ?? []).map((c) => c.layer)]))].sort((a, b) => a - b);
  const mainLayer = Math.min(...template.slots.map((s) => s.layer));
  const shrinks: Shrink[] = [];
  for (const s of template.slots) {
    const a = assetOf.get(s.id);
    const v = a ? videoSeconds(a) : null;
    if (s.layer !== mainLayer || v === null) continue;
    const longest = v / MIN_TEMPLATE_SPEED;
    if (longest < s.duration - TIME_EPSILON) {
      shrinks.push({ a: s.start, d: s.duration, nd: longest });
      warnings.push(
        `“${a!.name}” (${v.toFixed(1)} s) is shorter than slot ${slotNo.get(s.id)} (${s.duration.toFixed(1)} s): it plays at ${Math.round(MIN_TEMPLATE_SPEED * 100)} % speed and the slot was shortened by ${(s.duration - longest).toFixed(1)} s.`,
      );
    }
  }
  const map = makeTimeMap(shrinks);
  const total = map(template.duration);

  // 2) Tracks.
  const plan = planTracks(project, start, start + total);
  const layerTrack = new Map<number, string>();
  // The lowest layer that holds fillable slots is the main one (the Main track);
  // copy-only layers under it (blurred backgrounds) go right below it.
  const upper = layers.filter((l) => l >= mainLayer);
  const lower = layers.filter((l) => l < mainLayer).reverse();
  upper.forEach((layer, i) => {
    layerTrack.set(
      layer,
      i === 0
        ? plan.take(['video', 'overlay'], 'video', 'Main', (t) => t.name !== BACKGROUND_TRACK_NAME)
        : plan.take(['overlay', 'video'], 'overlay', `Layer ${i + 1}`),
    );
  });
  let ref = layerTrack.get(mainLayer)!;
  for (const layer of lower) {
    ref = plan.takeBelow(ref, ['video', 'overlay'], 'video', BACKGROUND_TRACK_NAME);
    layerTrack.set(layer, ref);
  }

  // 3) Picture clips.
  const clips: Clip[] = [];
  const uses = new Map<Id, number>();
  const W = project.width;
  const H = project.height;
  const hasMusic = !!template.music;
  const ordered = [...template.slots].sort((a, b) => a.start - b.start || a.layer - b.layer);
  for (const s of ordered) {
    const asset = assetOf.get(s.id);
    if (!asset) continue;
    // Start/end come from the (monotonic) time map; lengths are derived from
    // them so neighbouring clips share exact cut times (no epsilon overlaps).
    const clipStart = r6(start + map(s.start));
    let dur = r6(start + map(s.start + s.duration)) - clipStart;
    if (dur <= TIME_EPSILON) continue;
    let media: Pick<VideoClip, 'sourceIn' | 'sourceOut' | 'speed'> | null = null;
    const v = videoSeconds(asset);
    if (asset.kind === 'video') {
      if (v === null) {
        media = { sourceIn: 0, sourceOut: dur, speed: 1 };
      } else if (v >= dur) {
        // A window that skips a little of the (often shaky) start; repeated
        // uses of the same video move on to later moments.
        const k = uses.get(asset.id) ?? 0;
        uses.set(asset.id, k + 1);
        const slack = v - dur;
        let sourceIn = Math.min(slack / 2, MAX_LEAD_IN) + k * dur;
        if (sourceIn > slack) sourceIn = slack > 0 ? sourceIn % slack : 0;
        media = { sourceIn, sourceOut: sourceIn + dur, speed: 1 };
      } else {
        let speed = v / dur;
        if (speed < MIN_TEMPLATE_SPEED) {
          // Upper layer (main-layer slots were already shortened above): end early.
          if (s.layer !== mainLayer && speed < MIN_TEMPLATE_SPEED - 1e-9) warnings.push(`“${asset.name}” is shorter than slot ${slotNo.get(s.id)}, so that layer ends early.`);
          speed = MIN_TEMPLATE_SPEED;
          dur = v / speed;
        }
        media = { sourceIn: 0, sourceOut: v, speed };
      }
    }
    const looks: { look: SlotLook; layer: number; copy: boolean }[] = [
      { look: s, layer: s.layer, copy: false },
      ...(s.copies ?? []).map((c) => ({ look: c, layer: c.layer, copy: true })),
    ];
    for (const { look, layer, copy } of looks) {
      const half = dur / 2;
      const common = {
        id: createId('clip'),
        trackId: layerTrack.get(layer)!,
        start: clipStart,
        duration: dur,
        name: copy ? `${asset.name} (background)` : asset.name,
        effects: lookEffects(look),
        fadeIn: Math.min(look.fadeIn ?? 0, half),
        fadeOut: Math.min(look.fadeOut ?? 0, half),
        transform: slotTransform(look, asset.width, asset.height, W, H),
        ...(lookMotion(look) ? { motion: lookMotion(look) } : {}),
        ...(look.shape ? { shape: { ...look.shape } } : {}),
      };
      if (asset.kind === 'image') {
        clips.push({ ...common, type: 'image', assetId: asset.id } satisfies ImageClip);
      } else {
        const volume = copy ? 0 : clamp(s.volume ?? (hasMusic ? 0 : 1), 0, 4);
        clips.push({ ...common, type: 'video', assetId: asset.id, ...media!, volume } satisfies VideoClip);
      }
    }
  }

  // 4) Texts (packed onto as few text tracks as possible).
  const unit = Math.min(W, H) / TEXT_REFERENCE_SIDE;
  const textTracks: { id: string; end: number }[] = [];
  const sortedTexts = [...template.texts].sort((a, b) => a.start - b.start);
  for (const t of sortedTexts) {
    const value = t.editable ? (texts[t.id] ?? t.text) : t.text;
    if (!value.trim()) continue;
    const s0 = r6(start + map(t.start));
    const d = r6(start + map(t.start + t.duration)) - s0;
    if (d <= TIME_EPSILON) continue;
    let lane = textTracks.find((l) => l.end <= s0 + TIME_EPSILON);
    if (!lane) {
      lane = { id: plan.take(['text', 'overlay'], 'text', 'Text'), end: 0 };
      textTracks.push(lane);
    }
    lane.end = s0 + d;
    const clip = createTextClip({ trackId: lane.id, start: s0, duration: d, text: value, style: t.style, name: t.label });
    clips.push({
      ...clip,
      fadeIn: Math.min(t.fadeIn ?? 0, d / 2),
      fadeOut: Math.min(t.fadeOut ?? 0, d / 2),
      transform: { x: t.x, y: t.y, scale: r6((t.scale ?? 1) * unit), rotation: t.rotation ?? 0, opacity: clamp(t.opacity ?? 1, 0, 1) },
    });
  }

  // 5) Music.
  const newTracks = plan.newTracks;
  if (template.music && opts.musicAsset) {
    const m = template.music;
    const asset = opts.musicAsset;
    const base = createClipFromAsset(asset, { trackId: '', start: start }) as AudioClip;
    const len = Math.min(total, base.sourceOut);
    let trackId: string | null = findFreeAudioTrack(project, start, start + len, 'music');
    if (!trackId) {
      trackId = `${NEW_TRACK_PREFIX}${newTracks.length}`;
      newTracks.push({ key: trackId, kind: 'audio', name: nextMusicTrackName(project) });
    }
    clips.push({
      ...base,
      trackId,
      name: asset.name.replace(/\s*\(.*$/, '') || asset.name,
      sourceOut: len,
      duration: len,
      volume: clamp(m.volume, 0, 1),
      fadeIn: Math.min(m.fadeIn ?? 0, len / 2),
      fadeOut: Math.min(m.fadeOut ?? 0, len / 2),
    });
  }

  return { newTracks, clips, start, duration: total, slots: resolved, warnings };
}

function nextMusicTrackName(project: Project): string {
  const n = project.tracks.filter((t) => t.kind === 'audio' && t.name.startsWith(MUSIC_TRACK_NAME)).length;
  return n ? `${MUSIC_TRACK_NAME} ${n + 1}` : MUSIC_TRACK_NAME;
}

/**
 * Pure commit of a build result (tests / previews): creates the tracks and
 * adds the clips with the core ops, exactly as `apply.ts` does through the
 * store. `rejected` lists clips the core refused (should always be empty).
 */
export function commitBuild(project: Project, result: BuildResult): { project: Project; trackIds: Map<string, Id>; added: Id[]; rejected: Id[] } {
  let p = project;
  const trackIds = new Map<string, Id>();
  for (const t of result.newTracks) {
    const r = ops.addTrack(p, t.kind, { name: t.name, ...(t.below ? { order: trackOrder(p, trackIds.get(t.below) ?? t.below) } : {}) });
    p = r.project;
    trackIds.set(t.key, r.trackId);
  }
  const clips = remapTracks(result.clips, trackIds);
  const r = ops.addClips(p, clips);
  const added = r?.added ?? [];
  const set = new Set(added);
  return { project: r?.project ?? p, trackIds, added, rejected: clips.filter((c) => !set.has(c.id)).map((c) => c.id) };
}

/** Current order of a track (for "insert below" specs). */
export function trackOrder(project: Project, id: Id): number | undefined {
  return project.tracks.find((t) => t.id === id)?.order;
}

export function remapTracks(clips: readonly Clip[], trackIds: ReadonlyMap<string, Id>): Clip[] {
  return clips.map((c) => (isNewTrackKey(c.trackId) ? ({ ...c, trackId: trackIds.get(c.trackId) ?? c.trackId } as Clip) : c));
}

/** End of the existing timeline (where "append" starts). */
export function appendStart(project: Project): number {
  return r6(getProjectDuration(project));
}
