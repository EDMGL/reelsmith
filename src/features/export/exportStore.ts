/**
 * Export dialog state and the start/cancel controller.
 */
import { create } from 'zustand';
import { getEngine, getProjectDuration, useEditorStore } from '../../core';
import { browserCodecSupport, selectCodecs, type CodecChoice, type CodecSupportApi } from './codecs';
import { browserExportDeps, isAbortError, runExport, type ExportDeps, type ExportProgress } from './pipeline';
import { defaultSettings, planExport, type ExportSettings } from './plan';
import { pickSaveHandle, triggerDownload, writeToHandle, type SaveHandle } from './save';

export type ExportStatus = 'idle' | 'running' | 'done' | 'error' | 'cancelled';

export interface ExportResult {
  url: string;
  fileName: string;
  size: number;
  mimeType: string;
  savedTo: 'download' | 'file';
  seconds: number;
}

export interface ExportState {
  open: boolean;
  settings: ExportSettings | null;
  codecs: CodecChoice | null;
  codecError: string | null;
  probing: boolean;
  status: ExportStatus;
  progress: ExportProgress | null;
  error: string | null;
  result: ExportResult | null;

  openDialog(): void;
  closeDialog(): void;
  updateSettings(patch: Partial<ExportSettings>): void;
  start(): Promise<void>;
  cancel(): void;
}

/** Swappable in tests. */
export const exportDeps: {
  codecApi: CodecSupportApi;
  makeDeps: (engine: ExportDeps['engine']) => ExportDeps;
  pickSaveHandle: typeof pickSaveHandle;
  download: typeof triggerDownload;
} = {
  codecApi: browserCodecSupport,
  makeDeps: browserExportDeps,
  pickSaveHandle,
  download: triggerDownload,
};

let controller: AbortController | null = null;
let probeSeq = 0;

async function probe(set: (p: Partial<ExportState>) => void, get: () => ExportState) {
  const settings = get().settings;
  if (!settings) return;
  const seq = ++probeSeq;
  const plan = planExport(useEditorStore.getState().project, settings);
  set({ probing: true });
  try {
    const codecs = await selectCodecs(
      {
        width: plan.width,
        height: plan.height,
        fps: plan.fps,
        videoBitrate: plan.videoBitrate,
        audioBitrate: plan.audioBitrate,
        sampleRate: plan.sampleRate,
        channels: plan.channels,
        preferred: settings.format,
      },
      exportDeps.codecApi,
    );
    if (seq === probeSeq) set({ codecs, codecError: null, probing: false });
  } catch (e) {
    if (seq === probeSeq) set({ codecs: null, codecError: e instanceof Error ? e.message : String(e), probing: false });
  }
}

export const useExportStore = create<ExportState>()((set, get) => ({
  open: false,
  settings: null,
  codecs: null,
  codecError: null,
  probing: false,
  status: 'idle',
  progress: null,
  error: null,
  result: null,

  openDialog: () => {
    const project = useEditorStore.getState().project;
    const prev = get().settings;
    const settings = prev ? { ...prev, fps: prev.fps || project.fps } : defaultSettings(project);
    if (get().status !== 'running') set({ status: 'idle', error: null, progress: null });
    set({ open: true, settings });
    void probe(set, get);
  },

  closeDialog: () => {
    if (get().status === 'running') return;
    set({ open: false });
  },

  updateSettings: (patch) => {
    const s = get().settings;
    if (!s) return;
    const next = { ...s, ...patch };
    set({ settings: next });
    if (patch.resolution !== undefined || patch.fps !== undefined || patch.quality !== undefined || patch.format !== undefined) void probe(set, get);
  },

  start: async () => {
    const { settings, codecs, status } = get();
    if (!settings || !codecs || status === 'running') return;
    const engine = getEngine();
    if (!engine) {
      set({ status: 'error', error: 'The playback engine is not loaded, so frames cannot be rendered.' });
      return;
    }
    const editor = useEditorStore.getState();
    const project = editor.project;
    if (getProjectDuration(project) <= 0) {
      set({ status: 'error', error: 'Nothing to export: the timeline is empty.' });
      return;
    }
    const plan = planExport(project, settings);
    const fileName = `${plan.fileName}${codecs.extension}`;

    // Ask for the destination first, while the click's user activation is valid.
    let handle: SaveHandle | null = null;
    try {
      handle = await exportDeps.pickSaveHandle(fileName, codecs.mimeType, codecs.extension);
    } catch (e) {
      if (isAbortError(e)) return; // user dismissed the picker
      handle = null; // picker failed: fall back to a download
    }

    editor.pause();
    const old = get().result;
    if (old) URL.revokeObjectURL(old.url);
    const ctl = new AbortController();
    controller = ctl;
    set({ status: 'running', error: null, result: null, progress: null });
    const t0 = performance.now();
    try {
      const blob = await runExport(plan, codecs, exportDeps.makeDeps(engine), {
        signal: ctl.signal,
        onProgress: (progress) => {
          if (controller === ctl) set({ progress });
        },
      });
      const url = URL.createObjectURL(blob);
      let savedTo: ExportResult['savedTo'] = 'download';
      if (handle) {
        try {
          await writeToHandle(handle, blob);
          savedTo = 'file';
        } catch {
          exportDeps.download(url, fileName);
        }
      } else {
        exportDeps.download(url, fileName);
      }
      set({
        status: 'done',
        result: { url, fileName, size: blob.size, mimeType: blob.type || codecs.mimeType, savedTo, seconds: (performance.now() - t0) / 1000 },
      });
    } catch (e) {
      if (isAbortError(e)) set({ status: 'cancelled', error: null });
      else set({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    } finally {
      if (controller === ctl) controller = null;
    }
  },

  cancel: () => {
    controller?.abort();
  },
}));
