/**
 * The editor store (Zustand). Single source of truth for the project document
 * and editor UI state (selection, playhead, zoom, playback flag).
 *
 * Use in React: `const clips = useEditorStore((s) => s.project.clips)`.
 * Use outside React: `useEditorStore.getState().splitClip(id, t)`,
 * `useEditorStore.subscribe(listener)`.
 *
 * Undo/redo: every project-mutating action is one history step, unless called
 * inside a transaction (`beginTransaction`/`commitTransaction`, or
 * `transact(label, fn)`), in which case the whole transaction is one step.
 * Use transactions for continuous gestures (slider drags, live trims).
 * Non-project state (selection, currentTime, zoom, isPlaying) is not undoable.
 *
 * Assets: importing (`addAsset`) and metadata updates (`updateAsset`) are NOT
 * undo steps; they are applied to every history snapshot so undo never "loses"
 * an imported file. Removing an asset (`removeAsset`) IS undoable.
 */
import { create } from 'zustand';
import { detectAspectPreset, getAspectPreset, sanitizeCanvasSize } from './aspect';
import {
  DEFAULT_TRACK_KIND,
  clipContainsTime,
  createClipFromAsset,
  createProject,
  getProjectDuration,
} from './model';
import * as ops from './ops';
import { clamp } from './time';
import type { AspectPresetId, Clip, Id, MediaAsset, Project, SubtitleStyle, TimeRange, Track, TrackKind } from './types';

export const HISTORY_LIMIT = 200;
export const ZOOM_MIN = 2;
export const ZOOM_MAX = 1000;
export const ZOOM_DEFAULT = 60;

export interface HistoryEntry {
  /** Human-readable action label, e.g. "Split clip". */
  label: string;
  project: Project;
}

export type SelectMode = 'replace' | 'toggle' | 'add';

export interface EditorState {
  // ---- document ----
  project: Project;
  // ---- history ----
  past: HistoryEntry[];
  future: HistoryEntry[];
  /** Active transaction (null if none). */
  transaction: { label: string; before: Project; depth: number } | null;
  // ---- UI state (not undoable) ----
  /** Selected clip ids (multi-select). */
  selectedClipIds: Id[];
  selectedTrackId: Id | null;
  /** Playhead position, seconds. */
  currentTime: number;
  isPlaying: boolean;
  /** Incremented on every user seek (`setCurrentTime`); engines watch it to resync. */
  seekNonce: number;
  /** Timeline zoom, pixels per second. */
  zoom: number;
  /** True once the autosaved project has been restored (or there was none). */
  hydrated: boolean;

  // ---- project ----
  setProjectName(name: string): void;
  /** Applies an aspect preset (canvas size). 'custom' keeps the current size. */
  setAspectPreset(id: AspectPresetId): void;
  /** Sets an explicit canvas size (sanitized to even numbers 16..7680). */
  setCanvasSize(width: number, height: number): void;
  setFps(fps: number): void;
  setBackgroundColor(color: string): void;
  /**
   * Patches a shared subtitle style in `project.subtitleStyles` (one undo step,
   * or part of the open transaction). `id` cannot be changed. Returns false
   * (no-op, no history entry) if the style does not exist or nothing changed.
   * Clips referencing the style re-render with it automatically.
   */
  updateSubtitleStyle(id: Id, patch: Partial<Omit<SubtitleStyle, 'id'>>): boolean;
  /** Replaces the whole project (e.g. restore, new project). Clears history and selection. */
  loadProject(project: Project): void;
  /** Starts an empty project keeping the canvas settings. */
  newProject(): void;

  // ---- assets ----
  /** Adds an imported asset (not an undo step). */
  addAsset(asset: MediaAsset): void;
  /** Patches asset metadata such as thumbnail/waveform/hasAudio (not an undo step). */
  updateAsset(id: Id, patch: Partial<Omit<MediaAsset, 'id'>>): void;
  /** Removes an asset and all clips using it (undoable). */
  removeAsset(id: Id): void;

  // ---- tracks ----
  /** Adds a track and returns its id. */
  addTrack(kind: TrackKind, opts?: { name?: string; order?: number }): Id;
  /** Removes a track and its clips. */
  removeTrack(id: Id): void;
  updateTrack(id: Id, patch: Partial<Pick<Track, 'name' | 'muted' | 'locked' | 'hidden'>>): void;
  /** Moves a track to a new compositing order. */
  moveTrack(id: Id, toOrder: number): void;

  // ---- clips ----
  /** Adds a fully-formed clip at its trackId/start. Returns false if rejected (overlap, locked, incompatible). */
  addClip(clip: Clip): boolean;
  /**
   * Inserts a clip choosing a track automatically (see `ops.placeClip`): uses
   * `opts.trackId` if given, else the first compatible free track, else
   * creates a new track. `start` defaults to the end of the chosen track.
   * Returns the clip id or null if rejected. Selects the new clip.
   */
  insertClip(clip: Clip, opts?: { trackId?: Id; start?: number }): Id | null;
  /** Creates a clip for an asset (full source range) and inserts it like `insertClip`. */
  addAssetClip(assetId: Id, opts?: { trackId?: Id; start?: number }): Id | null;
  /** Generic update (see `ops.updateClip`). Returns false if rejected. */
  updateClip(id: Id, patch: ops.ClipPatch): boolean;
  removeClips(ids: Id[]): void;
  /** Moves a clip to `start` on `trackId` (default: same track). Rejected (false) on overlap. */
  moveClip(id: Id, start: number, trackId?: Id): boolean;
  /** Moves several clips by `delta` seconds, all-or-nothing. */
  moveClips(ids: Id[], delta: number): boolean;
  /** Moves one edge to timeline `time`, clamped to source bounds and neighbours. */
  trimClip(id: Id, edge: ops.TrimEdge, time: number): boolean;
  /** Splits a clip at timeline `time`. Returns the id of the right part, or null. */
  splitClip(id: Id, time: number): Id | null;
  /**
   * Splits at the playhead: the selected clips under the playhead, or (if none
   * selected) every unlocked clip under the playhead. One undo step.
   */
  splitAtPlayhead(): Id[];
  /**
   * Removes time ranges and closes the gaps (see `ops.rippleDeleteRanges`).
   * Default: all (unlocked) tracks, so tracks stay in sync. One undo step.
   */
  rippleDeleteRanges(ranges: TimeRange[], opts?: { trackIds?: Id[] }): boolean;
  /** Deletes clips and closes the gap on their own tracks. */
  rippleDeleteClips(ids: Id[]): void;
  /** Duplicates clips after the selection span; selects and returns the copies. */
  duplicateClips(ids: Id[]): Id[];

  // ---- selection ----
  selectClips(ids: Id[], mode?: SelectMode): void;
  clearSelection(): void;
  selectTrack(id: Id | null): void;

  // ---- playback / view ----
  /** User seek: sets the playhead (>= 0) and bumps `seekNonce`. */
  setCurrentTime(t: number): void;
  /** Engine-only: advances the playhead during playback without bumping `seekNonce`. */
  setPlaybackTime(t: number): void;
  play(): void;
  pause(): void;
  togglePlay(): void;
  setZoom(pxPerSecond: number): void;

  // ---- history ----
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Opens a transaction; nested calls are counted. Mutations until commit form ONE undo step. */
  beginTransaction(label: string): void;
  /** Closes the innermost transaction; the outermost commit pushes one history entry (if anything changed). */
  commitTransaction(): void;
  /** Aborts the whole transaction and restores the project as it was at `beginTransaction`. */
  cancelTransaction(): void;
  /** Runs `fn` inside a transaction (committed even if `fn` throws, then rethrows). */
  transact<R>(label: string, fn: () => R): R;
  /** Drops all history (e.g. after loading). */
  clearHistory(): void;
}

function pruneSelection(project: Project, ids: Id[]): Id[] {
  const next = ids.filter((id) => project.clips[id]);
  return next.length === ids.length ? ids : next;
}

function mapSnapshots(entries: HistoryEntry[], fn: (p: Project) => Project): HistoryEntry[] {
  return entries.map((e) => ({ ...e, project: fn(e.project) }));
}

export const useEditorStore = create<EditorState>()((set, get) => {
  /**
   * Applies a pure project operation as one history step (or as part of the
   * open transaction). Returns false if the op returned null/same project.
   */
  const apply = (label: string, fn: (p: Project) => Project | null): boolean => {
    const s = get();
    const next = fn(s.project);
    if (!next || next === s.project) return false;
    const selectedClipIds = pruneSelection(next, s.selectedClipIds);
    if (s.transaction) {
      set({ project: next, selectedClipIds });
    } else {
      set({
        project: next,
        selectedClipIds,
        past: [...s.past, { label, project: s.project }].slice(-HISTORY_LIMIT),
        future: [],
      });
    }
    return true;
  };

  const restore = (target: Project, past: HistoryEntry[], future: HistoryEntry[]) => {
    const s = get();
    set({
      project: target,
      past,
      future,
      selectedClipIds: pruneSelection(target, s.selectedClipIds),
      selectedTrackId: target.tracks.some((t) => t.id === s.selectedTrackId) ? s.selectedTrackId : null,
    });
  };

  return {
    project: createProject(),
    past: [],
    future: [],
    transaction: null,
    selectedClipIds: [],
    selectedTrackId: null,
    currentTime: 0,
    isPlaying: false,
    seekNonce: 0,
    zoom: ZOOM_DEFAULT,
    hydrated: false,

    // ---- project ----
    setProjectName: (name) => apply('Rename project', (p) => (p.name === name ? null : { ...p, name })),
    setAspectPreset: (id) =>
      apply('Change aspect ratio', (p) => {
        const preset = getAspectPreset(id);
        if (!preset) return p.aspectPreset === id ? null : { ...p, aspectPreset: id };
        if (p.aspectPreset === id && p.width === preset.width && p.height === preset.height) return null;
        return { ...p, aspectPreset: id, width: preset.width, height: preset.height };
      }),
    setCanvasSize: (w, h) =>
      apply('Change canvas size', (p) => {
        const { width, height } = sanitizeCanvasSize(w, h);
        if (width === p.width && height === p.height) return null;
        return { ...p, width, height, aspectPreset: detectAspectPreset(width, height) };
      }),
    setFps: (fps) =>
      apply('Change frame rate', (p) => {
        const f = clamp(Math.round(fps), 1, 120);
        return f === p.fps ? null : { ...p, fps: f };
      }),
    setBackgroundColor: (color) =>
      apply('Change background', (p) => (p.backgroundColor === color ? null : { ...p, backgroundColor: color })),
    updateSubtitleStyle: (id, patch) =>
      apply('Edit subtitle style', (p) => {
        const base = p.subtitleStyles[id];
        if (!base) return null;
        const next: SubtitleStyle = { ...base, ...patch, id: base.id };
        const changed = (Object.keys(next) as (keyof SubtitleStyle)[]).some(
          (k) => JSON.stringify(next[k]) !== JSON.stringify(base[k]),
        );
        return changed ? { ...p, subtitleStyles: { ...p.subtitleStyles, [id]: next } } : null;
      }),
    loadProject: (project) =>
      set({
        project,
        past: [],
        future: [],
        transaction: null,
        selectedClipIds: [],
        selectedTrackId: null,
        currentTime: 0,
        isPlaying: false,
        seekNonce: get().seekNonce + 1,
      }),
    newProject: () => {
      const p = get().project;
      get().loadProject(createProject({ width: p.width, height: p.height, fps: p.fps, aspectPreset: p.aspectPreset }));
    },

    // ---- assets ----
    addAsset: (asset) => {
      const add = (p: Project): Project => ({ ...p, assets: { ...p.assets, [asset.id]: asset } });
      const s = get();
      set({
        project: add(s.project),
        past: mapSnapshots(s.past, add),
        future: mapSnapshots(s.future, add),
        transaction: s.transaction ? { ...s.transaction, before: add(s.transaction.before) } : null,
      });
    },
    updateAsset: (id, patch) => {
      const upd = (p: Project): Project =>
        p.assets[id] ? { ...p, assets: { ...p.assets, [id]: { ...p.assets[id]!, ...patch, id } } } : p;
      const s = get();
      if (!s.project.assets[id] && !s.past.some((e) => e.project.assets[id])) return;
      set({
        project: upd(s.project),
        past: mapSnapshots(s.past, upd),
        future: mapSnapshots(s.future, upd),
        transaction: s.transaction ? { ...s.transaction, before: upd(s.transaction.before) } : null,
      });
    },
    removeAsset: (id) => {
      apply('Remove media', (p) => ops.removeAsset(p, id));
    },

    // ---- tracks ----
    addTrack: (kind, opts) => {
      let id = '';
      apply('Add track', (p) => {
        const r = ops.addTrack(p, kind, opts);
        id = r.trackId;
        return r.project;
      });
      return id;
    },
    removeTrack: (id) => {
      apply('Remove track', (p) => ops.removeTrack(p, id));
    },
    updateTrack: (id, patch) => {
      apply('Update track', (p) => ops.updateTrack(p, id, patch));
    },
    moveTrack: (id, toOrder) => {
      apply('Reorder track', (p) => ops.moveTrack(p, id, toOrder));
    },

    // ---- clips ----
    addClip: (clip) => apply('Add clip', (p) => ops.addClip(p, clip)),
    insertClip: (clip, opts = {}) => {
      let id: Id | null = null;
      apply('Add clip', (p) => {
        const r = ops.placeClip(p, clip, { ...opts, preferredKind: DEFAULT_TRACK_KIND[clip.type] });
        if (!r) return null;
        id = r.clip.id;
        return r.project;
      });
      if (id) set({ selectedClipIds: [id] });
      return id;
    },
    addAssetClip: (assetId, opts = {}) => {
      const asset = get().project.assets[assetId];
      if (!asset) return null;
      const clip = createClipFromAsset(asset, { trackId: '', start: 0 });
      return get().insertClip(clip, opts);
    },
    updateClip: (id, patch) => apply('Edit clip', (p) => ops.updateClip(p, id, patch)),
    removeClips: (ids) => {
      apply(ids.length > 1 ? 'Delete clips' : 'Delete clip', (p) => ops.removeClips(p, ids));
    },
    moveClip: (id, start, trackId) => apply('Move clip', (p) => ops.moveClip(p, id, start, trackId)),
    moveClips: (ids, delta) => apply('Move clips', (p) => ops.moveClips(p, ids, delta)),
    trimClip: (id, edge, time) => apply('Trim clip', (p) => ops.trimClip(p, id, edge, time)),
    splitClip: (id, time) => {
      let newId: Id | null = null;
      apply('Split clip', (p) => {
        const r = ops.splitClip(p, id, time);
        if (!r) return null;
        newId = r.newClipId;
        return r.project;
      });
      return newId;
    },
    splitAtPlayhead: () => {
      const s = get();
      const t = s.currentTime;
      const under = (ids: Id[]) => ids.filter((id) => s.project.clips[id] && clipContainsTime(s.project.clips[id]!, t));
      let targets = under(s.selectedClipIds);
      if (targets.length === 0) targets = under(Object.keys(s.project.clips));
      const created: Id[] = [];
      apply('Split', (p) => {
        let cur = p;
        for (const id of targets) {
          const r = ops.splitClip(cur, id, t);
          if (r) {
            cur = r.project;
            created.push(r.newClipId);
          }
        }
        return cur;
      });
      return created;
    },
    rippleDeleteRanges: (ranges, opts = {}) =>
      apply('Ripple delete', (p) => ops.rippleDeleteRanges(p, ranges, opts.trackIds)),
    rippleDeleteClips: (ids) => {
      apply('Ripple delete', (p) => ops.rippleDeleteClips(p, ids));
    },
    duplicateClips: (ids) => {
      let newIds: Id[] = [];
      apply('Duplicate', (p) => {
        const r = ops.duplicateClips(p, ids);
        if (!r) return null;
        newIds = r.newIds;
        return r.project;
      });
      if (newIds.length) set({ selectedClipIds: newIds });
      return newIds;
    },

    // ---- selection ----
    selectClips: (ids, mode = 'replace') => {
      const s = get();
      const valid = ids.filter((id) => s.project.clips[id]);
      let next: Id[];
      if (mode === 'replace') next = valid;
      else if (mode === 'add') next = [...new Set([...s.selectedClipIds, ...valid])];
      else {
        const set0 = new Set(s.selectedClipIds);
        valid.forEach((id) => (set0.has(id) ? set0.delete(id) : set0.add(id)));
        next = [...set0];
      }
      set({ selectedClipIds: next });
    },
    clearSelection: () => set({ selectedClipIds: [] }),
    selectTrack: (id) => set({ selectedTrackId: id }),

    // ---- playback / view ----
    setCurrentTime: (t) => set((s) => ({ currentTime: Math.max(0, Number.isFinite(t) ? t : 0), seekNonce: s.seekNonce + 1 })),
    setPlaybackTime: (t) => set({ currentTime: Math.max(0, t) }),
    play: () => {
      const s = get();
      if (s.isPlaying) return;
      const dur = getProjectDuration(s.project);
      if (dur > 0 && s.currentTime >= dur - 1e-3) s.setCurrentTime(0);
      set({ isPlaying: true });
    },
    pause: () => set({ isPlaying: false }),
    togglePlay: () => (get().isPlaying ? get().pause() : get().play()),
    setZoom: (z) => set({ zoom: clamp(z, ZOOM_MIN, ZOOM_MAX) }),

    // ---- history ----
    undo: () => {
      const s = get();
      if (s.transaction) s.commitTransaction();
      const { past, future, project } = get();
      const entry = past[past.length - 1];
      if (!entry) return;
      restore(entry.project, past.slice(0, -1), [...future, { label: entry.label, project }]);
    },
    redo: () => {
      const s = get();
      if (s.transaction) s.commitTransaction();
      const { past, future, project } = get();
      const entry = future[future.length - 1];
      if (!entry) return;
      restore(entry.project, [...past, { label: entry.label, project }], future.slice(0, -1));
    },
    canUndo: () => get().past.length > 0,
    canRedo: () => get().future.length > 0,
    beginTransaction: (label) => {
      const s = get();
      if (s.transaction) set({ transaction: { ...s.transaction, depth: s.transaction.depth + 1 } });
      else set({ transaction: { label, before: s.project, depth: 1 } });
    },
    commitTransaction: () => {
      const s = get();
      const tx = s.transaction;
      if (!tx) return;
      if (tx.depth > 1) {
        set({ transaction: { ...tx, depth: tx.depth - 1 } });
        return;
      }
      if (tx.before === s.project) {
        set({ transaction: null });
        return;
      }
      set({
        transaction: null,
        past: [...s.past, { label: tx.label, project: tx.before }].slice(-HISTORY_LIMIT),
        future: [],
      });
    },
    cancelTransaction: () => {
      const s = get();
      if (!s.transaction) return;
      const before = s.transaction.before;
      set({ transaction: null, project: before, selectedClipIds: pruneSelection(before, s.selectedClipIds) });
    },
    transact: (label, fn) => {
      get().beginTransaction(label);
      try {
        return fn();
      } finally {
        get().commitTransaction();
      }
    },
    clearHistory: () => set({ past: [], future: [] }),
  };
});

/** Shorthand for `useEditorStore.getState()`. */
export const getEditorState = (): EditorState => useEditorStore.getState();

/** Selector: the single selected clip, or null if 0 or >1 clips are selected. */
export function selectSingleSelectedClip(s: EditorState): Clip | null {
  return s.selectedClipIds.length === 1 ? (s.project.clips[s.selectedClipIds[0]!] ?? null) : null;
}

/** Selector: project duration (end of last clip). */
export function selectProjectDuration(s: EditorState): number {
  return getProjectDuration(s.project);
}
