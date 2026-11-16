/**
 * Silence feature state + actions (detect, include/exclude, remove, clear).
 * Local Zustand store; the editor store remains the source of truth for the project.
 */
import { create } from 'zustand';
import { getProjectDuration, normalizeRanges, useEditorStore, type Id, type MediaAsset, type Project, type TimeRange } from '../../core';
import { DEFAULT_SILENCE_PARAMS, type SignalAnalysis, type SilenceParams } from './analysis';
import { decodeAssetMono, type MonoAudio } from './decodeAudio';
import { runAnalysis, type RunOptions } from './runAnalysis';
import {
  computeTimelineSilence,
  getAudibleClips,
  lockedTracksAtRisk,
  shiftTimeAfterRemoval,
  type ClipActivity,
} from './timelineSilence';
import type { AnalysisParams } from './workerProtocol';

export type SilenceScope = 'timeline' | 'selection';

export interface DetectedRange extends TimeRange {
  included: boolean;
}

export interface AssetThreshold {
  assetId: Id;
  name: string;
  thresholdDb: number;
  floorDb: number | null;
}

export interface SilenceResult {
  ranges: DetectedRange[];
  /** Clips/tracks the detection ran on (identity check for staleness). */
  clipsRef: Project['clips'];
  tracksRef: Project['tracks'];
  scope: SilenceScope;
  thresholds: AssetThreshold[];
  /** Assets that could not be decoded (treated as having no audio). */
  skipped: string[];
}

export interface SilenceState {
  params: SilenceParams;
  scope: SilenceScope;
  /** Treat stretches with no audible clip as silence (whole-timeline only). */
  includeNoAudio: boolean;
  status: 'idle' | 'running' | 'done' | 'error';
  progress: { fraction: number; label: string };
  error: string | null;
  result: SilenceResult | null;
  /** Message after a removal (e.g. "Removed 4 silences, 3.2 s"). */
  notice: string | null;

  setParams(p: Partial<SilenceParams>): void;
  setScope(s: SilenceScope): void;
  setIncludeNoAudio(v: boolean): void;
  detect(): Promise<void>;
  abort(): void;
  toggleRange(index: number): void;
  setAllIncluded(v: boolean): void;
  clear(): void;
  /** Ripple-deletes the included ranges in ONE store call. Returns true if the timeline changed. */
  removeSelected(): boolean;
}

/** Dependencies (swappable in tests). */
export const silenceDeps = {
  decode: (asset: MediaAsset): Promise<MonoAudio> => decodeAssetMono(asset),
  analyze: (samples: Float32Array, sampleRate: number, params: AnalysisParams, opts: RunOptions): Promise<SignalAnalysis> =>
    runAnalysis(samples, sampleRate, params, opts),
};

let controller: AbortController | null = null;

export function isStale(result: SilenceResult | null, project: Project): boolean {
  return !!result && (result.clipsRef !== project.clips || result.tracksRef !== project.tracks);
}

export function includedRanges(result: SilenceResult | null): TimeRange[] {
  return normalizeRanges((result?.ranges ?? []).filter((r) => r.included));
}

export function riskyLockedTracks(project: Project, result: SilenceResult | null): string[] {
  return lockedTracksAtRisk(project, includedRanges(result));
}

export const useSilenceStore = create<SilenceState>()((set, get) => ({
  params: { ...DEFAULT_SILENCE_PARAMS },
  scope: 'timeline',
  includeNoAudio: false,
  status: 'idle',
  progress: { fraction: 0, label: '' },
  error: null,
  result: null,
  notice: null,

  setParams: (p) => set({ params: { ...get().params, ...p } }),
  setScope: (scope) => set({ scope }),
  setIncludeNoAudio: (includeNoAudio) => set({ includeNoAudio }),

  detect: async () => {
    controller?.abort();
    const ctl = new AbortController();
    controller = ctl;
    const { params, scope, includeNoAudio } = get();
    const editor = useEditorStore.getState();
    const project = editor.project;
    set({ status: 'running', error: null, notice: null, progress: { fraction: 0, label: 'Preparing…' } });
    try {
      const clips = getAudibleClips(project, scope === 'selection' ? editor.selectedClipIds : undefined);
      if (clips.length === 0) {
        throw new Error(
          scope === 'selection'
            ? 'Select a video or audio clip that has audible sound (unmuted track, volume > 0).'
            : 'The timeline has no audible video or audio clips.',
        );
      }
      const assetIds = [...new Set(clips.map((c) => c.assetId))];
      const analysis = new Map<Id, SignalAnalysis>();
      const thresholds: AssetThreshold[] = [];
      const skipped: string[] = [];
      for (let i = 0; i < assetIds.length; i++) {
        const asset = project.assets[assetIds[i]!]!;
        const base = i / assetIds.length;
        const step = 1 / assetIds.length;
        set({ progress: { fraction: base, label: `Decoding audio: ${asset.name}` } });
        let mono: MonoAudio;
        try {
          mono = await silenceDeps.decode(asset);
        } catch (e) {
          skipped.push(`${asset.name}: ${e instanceof Error ? e.message : String(e)}`);
          continue;
        }
        if (ctl.signal.aborted) return;
        set({ progress: { fraction: base + step * 0.3, label: `Analyzing: ${asset.name}` } });
        const a = await silenceDeps.analyze(mono.samples, mono.sampleRate, params, {
          signal: ctl.signal,
          onProgress: (f) => {
            if (controller === ctl) set({ progress: { fraction: base + step * (0.3 + 0.7 * f), label: `Analyzing: ${asset.name}` } });
          },
        });
        analysis.set(asset.id, a);
        thresholds.push({ assetId: asset.id, name: asset.name, thresholdDb: a.thresholdDb, floorDb: a.floorDb });
      }
      if (ctl.signal.aborted) return;
      const activities: ClipActivity[] = clips
        .filter((c) => analysis.has(c.assetId))
        .map((c) => ({ clip: c, activeSource: analysis.get(c.assetId)!.active }));
      if (activities.length === 0) throw new Error(`No audio could be analyzed. ${skipped.join(' ')}`);
      const ranges = computeTimelineSilence(activities, {
        params,
        duration: getProjectDuration(project),
        includeNoAudio: scope === 'timeline' && includeNoAudio,
        fps: project.fps,
      });
      set({
        status: 'done',
        progress: { fraction: 1, label: 'Done' },
        result: {
          ranges: ranges.map((r) => ({ ...r, included: true })),
          clipsRef: project.clips,
          tracksRef: project.tracks,
          scope,
          thresholds,
          skipped,
        },
      });
    } catch (e) {
      if (ctl.signal.aborted || (e instanceof Error && e.name === 'AbortError')) return;
      set({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    } finally {
      if (controller === ctl) controller = null;
    }
  },

  abort: () => {
    controller?.abort();
    controller = null;
    set({ status: get().result ? 'done' : 'idle', progress: { fraction: 0, label: 'Cancelled' } });
  },

  toggleRange: (index) => {
    const r = get().result;
    if (!r || !r.ranges[index]) return;
    const ranges = r.ranges.map((x, i) => (i === index ? { ...x, included: !x.included } : x));
    set({ result: { ...r, ranges } });
  },

  setAllIncluded: (v) => {
    const r = get().result;
    if (r) set({ result: { ...r, ranges: r.ranges.map((x) => ({ ...x, included: v })) } });
  },

  clear: () => {
    controller?.abort();
    controller = null;
    set({ result: null, status: 'idle', error: null, notice: null, progress: { fraction: 0, label: '' } });
  },

  removeSelected: () => {
    const result = get().result;
    const editor = useEditorStore.getState();
    if (!result || isStale(result, editor.project)) return false;
    const ranges = includedRanges(result);
    if (ranges.length === 0) return false;
    const before = getProjectDuration(editor.project);
    const t = editor.currentTime;
    const ok = editor.rippleDeleteRanges(ranges);
    if (!ok) {
      set({ notice: 'Nothing was removed (all affected tracks are locked?).' });
      return false;
    }
    const after = useEditorStore.getState();
    const newDur = getProjectDuration(after.project);
    after.setCurrentTime(Math.min(Math.max(0, shiftTimeAfterRemoval(t, ranges)), newDur));
    set({
      result: null,
      status: 'idle',
      progress: { fraction: 0, label: '' },
      notice: `Removed ${ranges.length} silence${ranges.length === 1 ? '' : 's'} (${(before - newDur).toFixed(2)} s). Undo restores them in one step.`,
    });
    return true;
  },
}));
