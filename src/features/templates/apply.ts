/**
 * Applying a template to the editor: renders the referenced catalogue music
 * (async, before touching the timeline), then commits everything — optional
 * "replace" clearing, optional aspect switch, new tracks, all clips — as ONE
 * undo step. After that the clips are ordinary clips.
 */
import { useEditorStore, type Id } from '../../core';
import { findTrack } from '../music/catalogue';
import { getMusic, lengthKey } from '../music/library';
import { ensureAsset, musicAssetName } from '../music/timeline';
import { appendStart, buildTemplate, remapTracks, TemplateBuildError, trackOrder, type SlotAssignments, type TextValues } from './builder';
import type { VideoTemplate } from './types';

export type ApplyMode = 'replace' | 'append';

export interface ApplyOptions {
  /** Ignored when the timeline is empty (always builds at 0). */
  mode: ApplyMode;
  /** Switch the canvas to the template's aspect (always done when the timeline is empty). */
  switchAspect: boolean;
  onProgress?: (label: string, fraction: number) => void;
}

export interface ApplyResult {
  ok: boolean;
  message: string;
  warnings: string[];
  clipIds?: Id[];
}

/** Indirection for tests (music rendering needs Web Audio). */
export const applyDeps = {
  renderMusic: getMusic,
  ensureAsset,
};

const E = () => useEditorStore.getState();

export function isTimelineEmpty(): boolean {
  return Object.keys(E().project.clips).length === 0;
}

/** Locked tracks that still hold clips (they block "replace"). */
export function lockedTracksWithClips(): string[] {
  const p = E().project;
  return p.tracks.filter((t) => t.locked && Object.values(p.clips).some((c) => c.trackId === t.id)).map((t) => t.name);
}

/** Removes every clip and all tracks except the lowest video and audio track. */
function clearTimeline(): void {
  const s = E();
  s.removeClips(Object.keys(s.project.clips));
  const sorted = [...E().project.tracks].sort((a, b) => a.order - b.order);
  const keep = new Set([sorted.find((t) => t.kind === 'video')?.id, sorted.find((t) => t.kind === 'audio')?.id]);
  for (const t of sorted) if (!keep.has(t.id)) E().removeTrack(t.id);
}

export async function applyTemplate(template: VideoTemplate, assignments: SlotAssignments, texts: TextValues, o: ApplyOptions): Promise<ApplyResult> {
  const empty = isTimelineEmpty();
  const mode: ApplyMode = empty ? 'replace' : o.mode;
  const switchAspect = empty || o.switchAspect;
  if (mode === 'replace' && !empty) {
    const locked = lockedTracksWithClips();
    if (locked.length) return { ok: false, warnings: [], message: `Unlock ${locked.map((n) => `“${n}”`).join(', ')} to replace the timeline, or choose “Append”.` };
  }

  // Dry run: checks the media and gives the final length for the music render.
  let duration: number;
  try {
    duration = buildTemplate(template, assignments, texts, E().project).duration;
  } catch (e) {
    return { ok: false, warnings: [], message: e instanceof TemplateBuildError ? e.message : `Could not build the template: ${String(e)}` };
  }

  const warnings: string[] = [];
  let musicAsset;
  if (template.music) {
    const def = findTrack(template.music.trackId);
    if (!def) warnings.push('The template’s music is not available; it was left out.');
    else {
      try {
        o.onProgress?.('Generating music', 0);
        const seed = template.music.seed;
        const pcm = await applyDeps.renderMusic(def, seed, duration, (f) => o.onProgress?.('Generating music', f));
        musicAsset = applyDeps.ensureAsset(lengthKey(def.id, seed, duration), pcm, musicAssetName(def, seed, duration));
      } catch (e) {
        warnings.push(`The music could not be generated (${e instanceof Error ? e.message : String(e)}); the template was applied without it.`);
      }
    }
  }
  o.onProgress?.('Building timeline', 1);

  const s = E();
  s.beginTransaction(`Apply template: ${template.name}`);
  let added: Id[] = [];
  let expected = 0;
  let result;
  try {
    if (mode === 'replace' && !isTimelineEmpty()) clearTimeline();
    if (switchAspect) E().setAspectPreset(template.aspect);
    const p = E().project;
    const start = mode === 'append' ? appendStart(p) : 0;
    result = buildTemplate(template, assignments, texts, p, { start, musicAsset });
    const ids = new Map<string, Id>();
    for (const t of result.newTracks) {
      const order = t.below ? trackOrder(E().project, ids.get(t.below) ?? t.below) : undefined;
      ids.set(t.key, E().addTrack(t.kind, { name: t.name, ...(order !== undefined ? { order } : {}) }));
    }
    const clips = remapTracks(result.clips, ids);
    expected = clips.length;
    added = E().addClips(clips);
  } catch (e) {
    E().cancelTransaction();
    return { ok: false, warnings, message: `Could not apply the template: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (added.length !== expected) {
    E().cancelTransaction();
    return { ok: false, warnings, message: 'Could not place all clips of the template (are some tracks locked?). Nothing was changed.' };
  }
  E().commitTransaction();
  E().clearSelection();
  E().setCurrentTime(result.start);
  const secs = result.duration;
  const len = `${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, '0')}`;
  return {
    ok: true,
    clipIds: added,
    warnings: [...warnings, ...result.warnings],
    message: `“${template.name}” ${mode === 'append' ? `added after the end (at ${result.start.toFixed(1)} s)` : 'applied'}: ${added.length} clips, ${len}. Undo removes it in one step.`,
  };
}
