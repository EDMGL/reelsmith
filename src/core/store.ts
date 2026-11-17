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
import type { AspectPresetId, Clip, ClipboardContent, Id, MediaAsset, Project, SubtitleStyle, TimeRange, Track, TrackKind } from './types';

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
  /**
   * Internal clip clipboard (Cut/Copy/Paste). Not undoable, not persisted, never
   * mirrored to the system clipboard. Survives `loadProject` (paste into another project).
   */
  clipboard: ClipboardContent | null;

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
   * Adds many fully-formed clips as ONE store update and ONE undo step
   * (transaction-aware) — use it instead of looping `addClip` (e.g. subtitle cue
   * import). Each clip is validated like `addClip`; rejected clips (missing /
   * locked / incompatible track, duplicate id, zero duration, overlap with
   * existing clips or with earlier clips of the same batch) are skipped and the
   * others are still added. Returns the ids actually added (input order); [] and
   * no history entry if none. Selection is not changed.
   */
  addClips(clips: readonly Clip[]): Id[];
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
  /**
   * Updates several clips as ONE undo step (transaction-aware). `patch` may be a
   * function of each clip (return null to skip it). Returns how many changed.
   */
  updateClips(ids: readonly Id[], patch: ops.ClipPatch | ((clip: Clip) => ops.ClipPatch | null), label?: string): number;
  removeClips(ids: Id[]): void;
  /** Moves a clip to `start` on `trackId` (default: same track). Rejected (false) on overlap. */
  moveClip(id: Id, start: number, trackId?: Id): boolean;
  /** Moves several clips by `delta` seconds, all-or-nothing. */
  moveClips(ids: Id[], delta: number): boolean;
  /**
   * Moves clips to explicit start/track targets (across tracks), all-or-nothing
   * (see `ops.moveClipsTo`). One undo step. Returns false if rejected.
   */
  moveClipsTo(moves: readonly ops.ClipMove[]): boolean;
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

  // ---- clipboard (internal) ----
  /** Copies clips (default: the selection) to the internal clipboard. Returns how many were copied. */
  copyClips(ids?: readonly Id[]): number;
  /**
   * Cut = copy + delete as ONE undo step (default: the selection; clips on
   * locked tracks are neither copied nor removed). `ripple: true` closes the
   * gaps on their tracks (like `rippleDeleteClips`). Returns how many were cut.
   */
  cutClips(ids?: readonly Id[], opts?: { ripple?: boolean }): number;
  /**
   * Pastes the clipboard so its earliest clip starts at `opts.time` (default:
   * the playhead), see `ops.pasteClips` (creates tracks when needed). `opts.trackId`
   * prefers that track for the top-most group ("Paste here"). One undo step;
   * the pasted clips (new ids) become the selection and are returned.
   */
  pasteClips(opts?: { time?: number; trackId?: Id }): Id[];

  // ---- detach audio ----
  /**
   * "Detach audio" for the given video clips (default: the selection), see
   * `ops.detachAudio`. One undo step. Returns the new audio clip ids.
   */
  detachAudio(ids?: readonly Id[]): Id[];
  /** "Restore audio" (see `ops.restoreAudio`). One undo step. Returns true if anything changed. */
  restoreAudio(ids?: readonly Id[]): boolean;
  /** Adds the clips linked by "Detach audio" to the selection (default: of the selection). */
  selectLinkedClips(ids?: readonly Id[]): void;

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

/** Applies `fn` to every history snapshot; entries whose project is unchanged keep their identity. */
function mapSnapshots(entries: HistoryEntry[], fn: (p: Project) => Project): HistoryEntry[] {
  let changed = false;
  const out = entries.map((e) => {
    const project = fn(e.project);
    if (project === e.project) return e;
    changed = true;
    return { ...e, project };
  });
  return changed ? out : entries;
}

/** Structural equality for plain JSON-like values (small objects such as styles). */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

function sameIds(a: readonly Id[], b: readonly Id[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
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
    clipboard: null,

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
        const changed = !sameValue(next, base);
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
      const add = (p: Project): Project => (p.assets[asset.id] === asset ? p : { ...p, assets: { ...p.assets, [asset.id]: asset } });
      const s = get();
      set({
        project: add(s.project),
        past: mapSnapshots(s.past, add),
        future: mapSnapshots(s.future, add),
        transaction: s.transaction ? { ...s.transaction, before: add(s.transaction.before) } : null,
      });
    },
    updateAsset: (id, patch) => {
      // Snapshots usually share the same asset object: patch it once and reuse the result.
      const cache = new Map<MediaAsset, MediaAsset>();
      const upd = (p: Project): Project => {
        const a = p.assets[id];
        if (!a) return p;
        let next = cache.get(a);
        if (!next) {
          next = { ...a, ...patch, id };
          cache.set(a, next);
        }
        return { ...p, assets: { ...p.assets, [id]: next } };
      };
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
    addClips: (clips) => {
      let added: Id[] = [];
      apply(clips.length > 1 ? 'Add clips' : 'Add clip', (p) => {
        const r = ops.addClips(p, clips);
        if (!r) return null;
        added = r.added;
        return r.project;
      });
      return added;
    },
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
    updateClips: (ids, patch, label = ids.length > 1 ? 'Edit clips' : 'Edit clip') => {
      let changed = 0;
      get().transact(label, () => {
        for (const id of ids) {
          const clip = get().project.clips[id];
          if (!clip) continue;
          const p = typeof patch === 'function' ? patch(clip) : patch;
          if (p && get().updateClip(id, p)) changed++;
        }
      });
      return changed;
    },
    removeClips: (ids) => {
      apply(ids.length > 1 ? 'Delete clips' : 'Delete clip', (p) => ops.removeClips(p, ids));
    },
    moveClip: (id, start, trackId) => apply('Move clip', (p) => ops.moveClip(p, id, start, trackId)),
    moveClips: (ids, delta) => apply('Move clips', (p) => ops.moveClips(p, ids, delta)),
    moveClipsTo: (moves) => apply(moves.length > 1 ? 'Move clips' : 'Move clip', (p) => ops.moveClipsTo(p, moves)),
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

    // ---- clipboard ----
    copyClips: (ids) => {
      const s = get();
      const content = ops.copyClips(s.project, ids ?? s.selectedClipIds);
      if (!content) return 0;
      set({ clipboard: content });
      return content.clips.length;
    },
    cutClips: (ids, opts = {}) => {
      const s = get();
      const editable = (ids ?? s.selectedClipIds).filter((id) => ops.isClipEditable(s.project, id));
      const content = ops.copyClips(s.project, editable);
      if (!content) return 0;
      const ok = apply(opts.ripple ? 'Ripple cut' : 'Cut', (p) =>
        opts.ripple ? ops.rippleDeleteClips(p, editable) : ops.removeClips(p, editable),
      );
      if (!ok) return 0;
      set({ clipboard: content });
      return content.clips.length;
    },
    pasteClips: (opts = {}) => {
      const s = get();
      if (!s.clipboard) return [];
      const content = s.clipboard;
      let newIds: Id[] = [];
      apply('Paste', (p) => {
        const r = ops.pasteClips(p, content, opts.time ?? s.currentTime, { trackId: opts.trackId });
        if (!r) return null;
        newIds = r.newIds;
        return r.project;
      });
      if (newIds.length) set({ selectedClipIds: newIds });
      return newIds;
    },

    // ---- detach audio ----
    detachAudio: (ids) => {
      const s = get();
      let audioIds: Id[] = [];
      apply('Detach audio', (p) => {
        const r = ops.detachAudio(p, ids ?? s.selectedClipIds);
        if (!r) return null;
        audioIds = r.audioIds;
        return r.project;
      });
      return audioIds;
    },
    restoreAudio: (ids) => apply('Restore audio', (p) => ops.restoreAudio(p, ids ?? get().selectedClipIds)),
    selectLinkedClips: (ids) => {
      const s = get();
      const base = ids ?? s.selectedClipIds;
      const linked = ops.linkedClipIds(s.project, base);
      if (linked.length) s.selectClips([...base, ...linked], 'add');
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
      // Same selection: keep the array identity (no re-render of selection subscribers).
      if (sameIds(next, s.selectedClipIds)) return;
      set({ selectedClipIds: next });
    },
    clearSelection: () => {
      if (get().selectedClipIds.length) set({ selectedClipIds: [] });
    },
    selectTrack: (id) => {
      if (get().selectedTrackId !== id) set({ selectedTrackId: id });
    },

    // ---- playback / view ----
    setCurrentTime: (t) => set((s) => ({ currentTime: Math.max(0, Number.isFinite(t) ? t : 0), seekNonce: s.seekNonce + 1 })),
    // Hot path (called by the engine every frame): only `currentTime` changes, nothing is derived.
    setPlaybackTime: (t) => {
      const currentTime = t > 0 ? t : 0;
      if (currentTime !== get().currentTime) set({ currentTime });
    },
    play: () => {
      const s = get();
      if (s.isPlaying) return;
      const dur = getProjectDuration(s.project);
      if (dur > 0 && s.currentTime >= dur - 1e-3) s.setCurrentTime(0);
      set({ isPlaying: true });
    },
    pause: () => set({ isPlaying: false }),
    togglePlay: () => (get().isPlaying ? get().pause() : get().play()),
    setZoom: (z) => {
      const zoom = clamp(Number.isFinite(z) ? z : ZOOM_DEFAULT, ZOOM_MIN, ZOOM_MAX);
      if (zoom !== get().zoom) set({ zoom });
    },

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
