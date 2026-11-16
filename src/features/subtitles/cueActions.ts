/**
 * Store-level subtitle operations. Every exported action is ONE undo step.
 * Cues are `subtitle` clips; a "cue track" is any subtitle track.
 */
import {
  DEFAULT_SUBTITLE_STYLE_ID,
  createSubtitleClip,
  getTrack,
  getTrackClips,
  ops,
  useEditorStore,
  type Id,
  type Project,
  type SubtitleClip,
  type SubtitleStyle,
  type Track,
} from '../../core';
import { resolveOverlaps, splitCue, splitCueText, mergeCues } from './cueMath';
import type { Cue } from './formats';

const S = () => useEditorStore.getState();

export const DEFAULT_CUE_DURATION = 2;

export function cueName(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 40) || 'Subtitle';
}

export function subtitleTracks(project: Project): Track[] {
  return [...project.tracks].filter((t) => t.kind === 'subtitle').sort((a, b) => b.order - a.order);
}

export function cueClips(project: Project, trackId: Id | null | undefined): SubtitleClip[] {
  if (!trackId) return [];
  return getTrackClips(project, trackId).filter((c): c is SubtitleClip => c.type === 'subtitle');
}

export function clipsToCues(clips: readonly SubtitleClip[]): Cue[] {
  return clips.map((c) => ({ start: c.start, end: c.start + c.duration, text: c.text }));
}

function minDur(project: Project): number {
  return ops.minClipDuration(project);
}

export interface ImportReport {
  trackId: Id | null;
  added: number;
  trimmed: number;
  skipped: number;
  replaced: number;
  error?: string;
}

/**
 * Puts cues on a subtitle track (the given one, else the first unlocked
 * subtitle track, else a new one) as ONE undo step. Overlaps (with existing
 * clips unless `replace`, and among the cues) are resolved with
 * `resolveOverlaps` (trim, else skip) and counted in the report.
 */
export function importCues(cues: readonly Cue[], opts: { trackId?: Id | null; replace?: boolean; label?: string } = {}): ImportReport {
  const report: ImportReport = { trackId: null, added: 0, trimmed: 0, skipped: 0, replaced: 0 };
  if (cues.length === 0) return { ...report, error: 'No cues to import.' };
  S().transact(opts.label ?? 'Import subtitles', () => {
    let project = S().project;
    let trackId = opts.trackId ?? subtitleTracks(project).find((t) => !t.locked)?.id ?? null;
    const target = trackId ? getTrack(project, trackId) : undefined;
    if (target && target.locked) {
      report.error = `Track "${target.name}" is locked.`;
      return;
    }
    if (!target) trackId = S().addTrack('subtitle');
    report.trackId = trackId!;
    project = S().project;
    const existing = cueClips(project, trackId);
    if (opts.replace && existing.length) {
      S().removeClips(existing.map((c) => c.id));
      report.replaced = existing.length;
    }
    const occupied = getTrackClips(S().project, trackId!).map((c) => ({ start: c.start, end: c.start + c.duration }));
    const r = resolveOverlaps(cues, occupied, minDur(project));
    report.trimmed = r.trimmed;
    report.skipped = r.skipped;
    for (const cue of r.placed) {
      const clip = createSubtitleClip({ trackId: trackId!, start: cue.start, duration: cue.end - cue.start, text: cue.text, name: cueName(cue.text) });
      if (S().addClip(clip)) report.added++;
      else report.skipped++;
    }
  });
  return report;
}

/** Adds an empty-ish cue at time `t` on the track (after any cue under `t`, shortened to fit the gap). */
export function addCueAt(trackId: Id | null, t: number, text = 'New subtitle'): Id | null {
  let id: Id | null = null;
  S().transact('Add subtitle', () => {
    let tid = trackId && getTrack(S().project, trackId) ? trackId : null;
    if (!tid) tid = subtitleTracks(S().project).find((x) => !x.locked)?.id ?? S().addTrack('subtitle');
    const p = S().project;
    const md = minDur(p);
    const start = ops.findFreeStart(p, tid, t, md);
    const next = getTrackClips(p, tid).find((c) => c.start >= start - 1e-6);
    const duration = Math.min(DEFAULT_CUE_DURATION, next ? next.start - start : DEFAULT_CUE_DURATION);
    if (duration < md) return;
    const clip = createSubtitleClip({ trackId: tid, start, duration, text, name: cueName(text) });
    if (S().addClip(clip)) id = clip.id;
  });
  if (id) S().selectClips([id]);
  return id;
}

export function setCueText(id: Id, text: string): boolean {
  return S().updateClip(id, { text, name: cueName(text) });
}

/** Sets both edges; rejected (false) if invalid or overlapping a neighbour. */
export function setCueTiming(id: Id, start: number, end: number): boolean {
  if (!(end > start) || start < 0) return false;
  return S().updateClip(id, { start, duration: end - start });
}

/** Splits a cue at `t` (or its middle if `t` is not inside), dividing the text at a word boundary. */
export function splitCueAt(id: Id, t?: number): Id | null {
  const clip = S().project.clips[id];
  if (!clip || clip.type !== 'subtitle') return null;
  const md = minDur(S().project);
  const end = clip.start + clip.duration;
  const at = t !== undefined && t - clip.start >= md && end - t >= md ? t : clip.start + clip.duration / 2;
  const parts = splitCue({ start: clip.start, end, text: clip.text }, at, md);
  if (!parts) return null;
  let newId: Id | null = null;
  S().transact('Split subtitle', () => {
    newId = S().splitClip(id, at);
    if (!newId) return;
    S().updateClip(id, { text: parts[0].text, name: cueName(parts[0].text) });
    S().updateClip(newId, { text: parts[1].text, name: cueName(parts[1].text) });
  });
  return newId;
}

/** Merges a cue with the next cue on its track (the gap between them is absorbed). */
export function mergeWithNext(id: Id): boolean {
  const p = S().project;
  const clip = p.clips[id];
  if (!clip || clip.type !== 'subtitle') return false;
  const list = cueClips(p, clip.trackId);
  const next = list[list.findIndex((c) => c.id === id) + 1];
  if (!next) return false;
  const merged = mergeCues({ start: clip.start, end: clip.start + clip.duration, text: clip.text }, { start: next.start, end: next.start + next.duration, text: next.text });
  let ok = false;
  S().transact('Merge subtitles', () => {
    S().removeClips([next.id]);
    if (S().project.clips[next.id]) return; // locked
    ok = S().updateClip(id, { duration: merged.end - merged.start, text: merged.text, name: cueName(merged.text) });
    if (!ok) S().cancelTransaction();
  });
  return ok;
}

/** Shifts cues by `delta` seconds (clamped at 0). All-or-nothing; false if it would overlap other cues. */
export function shiftCueClips(ids: readonly Id[], delta: number): boolean {
  if (ids.length === 0 || delta === 0) return false;
  return S().moveClips([...ids], delta);
}

/** Moves a cue's start to `t` and shifts every following cue on its track by the same amount. */
export function syncFromCue(id: Id, t: number): boolean {
  const p = S().project;
  const clip = p.clips[id];
  if (!clip || clip.type !== 'subtitle') return false;
  const ids = cueClips(p, clip.trackId)
    .filter((c) => c.start >= clip.start - 1e-6)
    .map((c) => c.id);
  return shiftCueClips(ids, t - clip.start);
}

/** Splits text helper re-exported for UI previews. */
export { splitCueText };

/**
 * Updates a shared subtitle style as ONE undo step (core `updateSubtitleStyle`).
 * Unknown style ids fall back to the default style (the core action alone would
 * be a no-op). Any `id` in the patch is ignored. Returns false if nothing changed.
 */
export function updateSubtitleStyle(styleId: Id, patch: Partial<SubtitleStyle>): boolean {
  const styles = S().project.subtitleStyles;
  const target = styles[styleId] ? styleId : DEFAULT_SUBTITLE_STYLE_ID;
  if (!styles[target]) return false;
  const { id: _ignored, ...rest } = patch;
  return S().updateSubtitleStyle(target, rest);
}
