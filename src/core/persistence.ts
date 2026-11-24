/**
 * Autosave / restore.
 * - Project JSON (without blobs/objectURLs) -> localStorage key `PROJECT_STORAGE_KEY`.
 * - Asset blobs -> IndexedDB database `erdemcut`, object store `assets` (key = asset id).
 * On restore, blobs are loaded and fresh object URLs created; assets whose blob
 * is gone get `status: 'missing'`.
 */
import { DEFAULT_SUBTITLE_STYLE_ID, defaultSubtitleStyle } from './model';
import { useEditorStore } from './store';
import type { MediaAsset, Project } from './types';

export const PROJECT_STORAGE_KEY = 'erdemcut:project:v1';
const DB_NAME = 'erdemcut';
const STORE = 'assets';

export type SerializedAsset = Omit<MediaAsset, 'objectURL' | 'blob' | 'previewURL'>;
export type SerializedProject = Omit<Project, 'assets'> & { assets: Record<string, SerializedAsset> };

/** Strips runtime-only fields so the project can be JSON-stringified. */
export function serializeProject(project: Project): SerializedProject {
  const assets: Record<string, SerializedAsset> = {};
  for (const [id, a] of Object.entries(project.assets)) {
    const { objectURL: _u, blob: _b, previewURL: _p, ...rest } = a;
    assets[id] = rest;
  }
  return { ...project, assets };
}

/**
 * Rebuilds a Project from JSON. `blobs` maps asset id -> Blob (missing ones
 * get status 'missing'). `makeURL` defaults to URL.createObjectURL.
 * Returns null if the data is not a recognizable project.
 */
export function deserializeProject(
  data: unknown,
  blobs: Map<string, Blob>,
  makeURL: (b: Blob) => string = (b) => URL.createObjectURL(b),
): Project | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Partial<SerializedProject>;
  if (d.version !== 1 || !Array.isArray(d.tracks) || typeof d.clips !== 'object' || !d.clips) return null;
  const assets: Record<string, MediaAsset> = {};
  for (const [id, a] of Object.entries(d.assets ?? {})) {
    const blob = blobs.get(id);
    assets[id] = blob ? { ...a, blob, objectURL: makeURL(blob), status: 'ready' } : { ...a, objectURL: '', status: 'missing' };
  }
  const subtitleStyles = { [DEFAULT_SUBTITLE_STYLE_ID]: defaultSubtitleStyle(), ...(d.subtitleStyles ?? {}) };
  return { ...(d as SerializedProject), assets, subtitleStyles };
}

// ---------------------------------------------------------------------------
// IndexedDB blob storage
// ---------------------------------------------------------------------------

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB unavailable'));
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putAssetBlob(id: string, blob: Blob): Promise<void> {
  const db = await openDb();
  await reqToPromise(db.transaction(STORE, 'readwrite').objectStore(STORE).put(blob, id));
}

export async function getAssetBlob(id: string): Promise<Blob | undefined> {
  const db = await openDb();
  return (await reqToPromise(db.transaction(STORE, 'readonly').objectStore(STORE).get(id))) as Blob | undefined;
}

export async function deleteAssetBlob(id: string): Promise<void> {
  const db = await openDb();
  await reqToPromise(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id));
}

export async function listAssetBlobIds(): Promise<string[]> {
  const db = await openDb();
  return (await reqToPromise(db.transaction(STORE, 'readonly').objectStore(STORE).getAllKeys())).map(String);
}

// ---------------------------------------------------------------------------
// Save / restore
// ---------------------------------------------------------------------------

const storedBlobIds = new Set<string>();

/**
 * Saves the project JSON and syncs blobs (stores new ones; deletes blobs no
 * longer referenced by the project or any undo snapshot).
 */
export async function saveProject(): Promise<void> {
  const s = useEditorStore.getState();
  try {
    localStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(serializeProject(s.project)));
  } catch (e) {
    console.warn('[autosave] could not write project JSON', e);
  }
  try {
    const referenced = new Map<string, Blob | undefined>();
    for (const p of [s.project, ...s.past.map((e) => e.project), ...s.future.map((e) => e.project)]) {
      for (const a of Object.values(p.assets)) if (!referenced.has(a.id) || a.blob) referenced.set(a.id, a.blob);
    }
    for (const [id, blob] of referenced) {
      if (blob && !storedBlobIds.has(id)) {
        await putAssetBlob(id, blob);
        storedBlobIds.add(id);
      }
    }
    for (const id of await listAssetBlobIds()) {
      if (!referenced.has(id)) {
        await deleteAssetBlob(id);
        storedBlobIds.delete(id);
      }
    }
  } catch (e) {
    console.warn('[autosave] could not sync media blobs', e);
  }
}

/** Restores the autosaved project into the store (if any) and sets `hydrated`. */
export async function restoreProject(): Promise<boolean> {
  let ok = false;
  try {
    const raw = localStorage.getItem(PROJECT_STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw) as SerializedProject;
      const blobs = new Map<string, Blob>();
      for (const id of Object.keys(data.assets ?? {})) {
        try {
          const b = await getAssetBlob(id);
          if (b) {
            blobs.set(id, b);
            storedBlobIds.add(id);
          }
        } catch {
          /* IndexedDB unavailable: asset becomes 'missing' */
        }
      }
      const project = deserializeProject(data, blobs);
      if (project) {
        useEditorStore.getState().loadProject(project);
        ok = true;
      }
    }
  } catch (e) {
    console.warn('[autosave] restore failed', e);
  }
  useEditorStore.setState({ hydrated: true });
  return ok;
}

/** Default idle delay (ms) after the last project change before autosaving. */
export const AUTOSAVE_DELAY_MS = 1000;

export interface AutosaveOptions {
  /** Idle time after the last change, ms. */
  delayMs?: number;
  /** Writes the project (default `saveProject`). */
  save?: () => Promise<void> | void;
  /** Runs `cb` when the main thread is idle (default requestIdleCallback, else immediately). */
  whenIdle?: (cb: () => void) => void;
}

function defaultWhenIdle(cb: () => void): void {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (typeof ric === 'function') ric(cb, { timeout: 2000 });
  else cb();
}

/**
 * Debounced autosave. Serializing a large project (hundreds of subtitle clips
 * with word timings) is main-thread work, so it is kept off the hot paths:
 * - it runs `delayMs` after the LAST project change (bursts coalesce to one save),
 * - never while playing or while a transaction (drag, slider, typing burst) is
 *   open: the save waits for the pause / commit,
 * - inside an idle callback when the browser offers one.
 * `beforeunload` still flushes synchronously. Returns a stop function.
 */
export function startAutosave(delayOrOpts: number | AutosaveOptions = {}): () => void {
  const opts = typeof delayOrOpts === 'number' ? { delayMs: delayOrOpts } : delayOrOpts;
  const delayMs = opts.delayMs ?? AUTOSAVE_DELAY_MS;
  const save = opts.save ?? saveProject;
  const whenIdle = opts.whenIdle ?? defaultWhenIdle;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dirty = false;
  let stopped = false;
  const busy = () => {
    const s = useEditorStore.getState();
    return s.isPlaying || !!s.transaction;
  };
  const run = () => {
    timer = undefined;
    if (stopped || !dirty) return;
    if (busy()) return; // re-armed when playback stops / the transaction ends
    whenIdle(() => {
      if (stopped || !dirty || busy()) return;
      dirty = false;
      void save();
    });
  };
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(run, delayMs);
  };
  const unsub = useEditorStore.subscribe((s, prev) => {
    if (!s.hydrated) return;
    if (s.project !== prev.project) {
      dirty = true;
      arm();
    } else if (dirty && !busy() && (s.isPlaying !== prev.isPlaying || s.transaction !== prev.transaction) && timer === undefined) {
      arm(); // became idle with unsaved changes
    }
  });
  const flush = () => {
    clearTimeout(timer);
    if (!dirty) return;
    try {
      localStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(serializeProject(useEditorStore.getState().project)));
      dirty = false;
    } catch {
      /* ignore */
    }
  };
  window.addEventListener('beforeunload', flush);
  return () => {
    stopped = true;
    unsub();
    clearTimeout(timer);
    window.removeEventListener('beforeunload', flush);
  };
}
