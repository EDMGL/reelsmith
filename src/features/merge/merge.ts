/**
 * "Merge clips": bakes a run of clips (e.g. the many pieces left by silence
 * removal, plus their detached audio) into ONE video file at the project size,
 * and swaps the pieces for a single clip covering exactly the same time span.
 *
 * Subtitles, text and every clip that is not merged keep their timeline times,
 * so captions stay in sync. One long clip also plays far smoother than dozens
 * of cuts (each cut is a seek), and the baked file is project-sized instead of
 * a multi-GB 4K phone original.
 */
import {
  clipEnd,
  createClipFromAsset,
  getEngine,
  getTrack,
  useEditorStore,
  type Clip,
  type Id,
  type MediaAsset,
  type Project,
} from '../../core';
import { browserCodecSupport, selectCodecs, type CodecSupportApi } from '../export/codecs';
import { browserExportDeps, runExport, type ExportDeps, type ExportProgress } from '../export/pipeline';
import { planExport, sanitizeFileName } from '../export/plan';
import { importFile } from '../media/importMedia';

const EPS = 1e-6;

/** Clip types that are baked (pictures and sound). Text/subtitles stay live. */
const MERGEABLE = new Set<Clip['type']>(['video', 'audio', 'image']);

export interface MergePlan {
  clipIds: Id[];
  start: number;
  end: number;
  /** Track that receives the merged clip (the earliest picture clip's track). */
  trackId: Id;
}

export type MergePlanResult = { ok: true; plan: MergePlan } | { ok: false; error: string };

const overlaps = (c: Clip, a: number, b: number) => c.start < b - EPS && clipEnd(c) > a + EPS;

/**
 * Which clips to merge for a selection:
 * - the selected video/audio/image clips,
 * - their "Detach audio" partners (both directions),
 * - every other mergeable clip on the target track inside the span (so the
 *   merged clip fits without overlapping anything).
 */
export function planMerge(project: Project, selectedIds: readonly Id[]): MergePlanResult {
  const ids = new Set<Id>();
  for (const id of selectedIds) {
    const c = project.clips[id];
    if (c && MERGEABLE.has(c.type)) ids.add(id);
  }
  if (ids.size === 0) return { ok: false, error: 'Select the clips to merge (video, audio or image clips).' };

  const addPartners = () => {
    for (const id of [...ids]) {
      const c = project.clips[id];
      if (c?.type === 'video' && c.detachedAudioClipId && project.clips[c.detachedAudioClipId]) ids.add(c.detachedAudioClipId);
      if (c?.type === 'audio' && c.detachedFromClipId && project.clips[c.detachedFromClipId]) ids.add(c.detachedFromClipId);
    }
    // Pieces split from one detached clip all point at the same partner id; also
    // pick up the audio pieces that point at any selected video piece.
    for (const c of Object.values(project.clips)) {
      if (c.type === 'audio' && c.detachedFromClipId && ids.has(c.detachedFromClipId)) ids.add(c.id);
    }
  };
  addPartners();

  const pictures = () =>
    [...ids].map((id) => project.clips[id]!).filter((c) => c.type === 'video' || c.type === 'image').sort((a, b) => a.start - b.start);
  if (pictures().length === 0) return { ok: false, error: 'Merging needs at least one video or image clip in the selection.' };
  const trackId = pictures()[0]!.trackId;

  let start = Infinity;
  let end = -Infinity;
  for (let guard = 0; guard < 10; guard++) {
    const before = ids.size;
    start = Math.min(...[...ids].map((id) => project.clips[id]!.start));
    end = Math.max(...[...ids].map((id) => clipEnd(project.clips[id]!)));
    for (const c of Object.values(project.clips)) {
      if (c.trackId === trackId && overlaps(c, start, end)) {
        if (!MERGEABLE.has(c.type)) return { ok: false, error: `"${c.name}" sits between the clips on the same track and cannot be merged.` };
        ids.add(c.id);
      }
    }
    addPartners();
    if (ids.size === before) break;
  }

  for (const id of ids) {
    const c = project.clips[id]!;
    const track = getTrack(project, c.trackId);
    if (track?.locked) return { ok: false, error: `Track "${track.name}" is locked; unlock it to merge "${c.name}".` };
  }
  if (!(end - start > EPS)) return { ok: false, error: 'Nothing to merge.' };
  if (ids.size < 2) return { ok: false, error: 'Select at least two clips to merge.' };
  return { ok: true, plan: { clipIds: [...ids], start, end, trackId } };
}

/** The project reduced to the merged clips, shifted so the span starts at 0. */
export function subProject(project: Project, plan: MergePlan): Project {
  const clips: Project['clips'] = {};
  for (const id of plan.clipIds) {
    const c = project.clips[id]!;
    clips[id] = { ...c, start: c.start - plan.start } as Clip;
  }
  return { ...project, clips };
}

/** True if none of the planned clips changed since `before` (the user may edit while we render). */
export function planStillValid(before: Project, after: Project, plan: MergePlan): boolean {
  return plan.clipIds.every((id) => after.clips[id] === before.clips[id]);
}

export interface MergeDeps {
  codecApi: CodecSupportApi;
  makeExportDeps: (engine: ExportDeps['engine']) => ExportDeps;
  importFile: (file: File) => Promise<string | null>;
}

export const mergeDeps: MergeDeps = {
  codecApi: browserCodecSupport,
  makeExportDeps: browserExportDeps,
  importFile,
};

export interface MergeRun {
  signal?: AbortSignal;
  onProgress?: (p: ExportProgress) => void;
}

/** Renders the selection into one file and swaps the clips for it (one undo step). Returns the new clip id. */
export async function mergeSelection(run: MergeRun = {}): Promise<Id> {
  const editor = useEditorStore.getState();
  const project = editor.project;
  const planned = planMerge(project, editor.selectedClipIds);
  if (!planned.ok) throw new Error(planned.error);
  const plan = planned.plan;

  const engine = getEngine();
  if (!engine?.forProject) throw new Error('The render engine is not loaded.');
  const sub = subProject(project, plan);
  const settings = { fileName: sanitizeFileName(`${project.name} merged`), resolution: 'project' as const, fps: project.fps, quality: 'high' as const, format: 'mp4' as const };
  const ep = planExport(sub, settings);
  const codecs = await selectCodecs(
    {
      width: ep.width,
      height: ep.height,
      fps: ep.fps,
      videoBitrate: ep.videoBitrate,
      audioBitrate: ep.audioBitrate,
      sampleRate: ep.sampleRate,
      channels: ep.channels,
      preferred: 'mp4',
    },
    mergeDeps.codecApi,
  );

  const renderer = engine.forProject(sub);
  let blob: Blob;
  try {
    blob = await runExport(ep, codecs, mergeDeps.makeExportDeps(renderer), run);
  } finally {
    renderer.dispose();
  }

  const file = new File([blob], `${ep.fileName}${codecs.extension}`, { type: codecs.mimeType });
  const assetId = await mergeDeps.importFile(file);
  if (!assetId) throw new Error('The merged file could not be read back.');

  const S = useEditorStore.getState;
  if (!planStillValid(project, S().project, plan)) {
    throw new Error('The clips changed while merging, so nothing was replaced. The merged file is in the media library.');
  }
  const asset = S().project.assets[assetId] as MediaAsset;
  const clip = createClipFromAsset(asset, { trackId: plan.trackId, start: plan.start, name: 'Merged clip' });
  if (clip.type !== 'video') throw new Error('The merged file has no picture.');
  const dur = Math.min(plan.end - plan.start, clip.sourceOut);
  const merged = { ...clip, sourceOut: dur, duration: dur };
  S().beginTransaction('Merge clips');
  S().removeClips(plan.clipIds);
  if (!S().addClip(merged)) {
    S().cancelTransaction();
    throw new Error('The merged clip could not be placed on the timeline. The merged file is in the media library.');
  }
  S().commitTransaction();
  S().selectClips([merged.id]);
  return merged.id;
}
