/**
 * Silence feature state + actions (detect, include/exclude, remove, clear).
 * Local Zustand store; the editor store remains the source of truth for the project.
 */
import { create } from 'zustand';
import { getProjectDuration, normalizeRanges, useEditorStore, type Id, type MediaAsset, type Project, type TimeRange } from '../../core';
import type { SignalAnalysis, SilenceParams } from './analysis';
import { DEFAULT_PRESET_ID, presetParams } from './presets';
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

  /** Changing parameters/scope re-runs detection automatically (debounced) while a result is shown. */
  setParams(p: Partial<SilenceParams>): void;
  applyPreset(id: string): void;
  setScope(s: SilenceScope): void;
  setIncludeNoAudio(v: boolean): void;
  detect(): Promise<void>;
  /** Detects and immediately removes every detected silence (one undo step). */
  detectAndRemove(): Promise<boolean>;
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
let redetectTimer: ReturnType<typeof setTimeout> | null = null;
/** Delay before re-running detection after a parameter change, ms. */
export const REDETECT_DELAY_MS = 350;

function scheduleRedetect(get: () => SilenceState): void {
  const { result, status } = get();
  if (!result || (status !== 'done' && status !== 'running')) return;
  if (redetectTimer) clearTimeout(redetectTimer);
  redetectTimer = setTimeout(() => {
    redetectTimer = null;
    const s = get();
    if (s.result && !isStale(s.result, useEditorStore.getState().project)) void s.detect();
  }, REDETECT_DELAY_MS);
}

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
  params: presetParams(DEFAULT_PRESET_ID),
  scope: 'timeline',
  includeNoAudio: false,
  status: 'idle',
  progress: { fraction: 0, label: '' },
  error: null,
  result: null,
  notice: null,

  setParams: (p) => {
    set({ params: { ...get().params, ...p } });
    scheduleRedetect(get);
  },
  applyPreset: (id) => {
    const { windowMs, hysteresisDb, thresholdDb } = get().params;
    set({ params: { ...presetParams(id), windowMs, hysteresisDb, thresholdDb } });
    scheduleRedetect(get);
  },
  setScope: (scope) => {
    set({ scope });
    scheduleRedetect(get);
  },
  setIncludeNoAudio: (includeNoAudio) => {
    set({ includeNoAudio });
    scheduleRedetect(get);
  },

  detectAndRemove: async () => {
    await get().detect();
    const s = get();
    if (s.status !== 'done' || !s.result) return false;
    if (s.result.ranges.length === 0) {
      set({ result: null, status: 'idle', notice: 'No silences found with these settings.' });
      return false;
    }
    return s.removeSelected();
  },

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
    if (redetectTimer) clearTimeout(redetectTimer);
    redetectTimer = null;
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
