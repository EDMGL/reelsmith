/**
 * Preview proxies: every video asset gets a light copy (540p, key frame every
 * 0.5 s) that the engine plays in the preview instead of the original. Seeking
 * a phone original (4K HEVC, key frames seconds apart) at every silence cut is
 * what made playback stutter; the proxy makes those seeks cheap. Export always
 * reads the original file, so quality is untouched.
 *
 * - One proxy is built at a time, in a worker, in the background. Until it is
 *   ready the original plays as before; when it lands the preview switches.
 * - Proxies are cached in their own IndexedDB database (not the project's media
 *   store, whose autosave deletes anything that is not a project asset), so a
 *   reload reuses them instantly. Proxies of assets that are gone are pruned.
 */
import { create } from 'zustand';
import { getAssetBlob, useEditorStore, type Id, type MediaAsset, type Project } from '../../core';
import type { ProxyMessage, ProxyResponse } from './protocol';

export const PROXY_SHORT_SIDE = 540;
export const PROXY_KEY_FRAME_INTERVAL = 0.5;
/** Bump when the proxy recipe changes, so old cached copies are rebuilt. */
const PROXY_VERSION = 1;
const cacheKey = (assetId: Id) => `${assetId}@v${PROXY_VERSION}`;

export interface ProxyState {
  /** Building now: asset id -> 0..1. */
  building: Record<Id, number>;
  /** Waiting in the queue. */
  queued: Id[];
  /** Could not be built (the original keeps playing): asset id -> reason. */
  failed: Record<Id, string>;
}

export const useProxyStore = create<ProxyState>()(() => ({ building: {}, queued: [], failed: {} }));

// ---------------------------------------------------------------------------
// Dependencies (swappable in tests)
// ---------------------------------------------------------------------------

export interface ProxyCache {
  get(key: string): Promise<Blob | undefined>;
  put(key: string, blob: Blob): Promise<void>;
  keys(): Promise<string[]>;
  delete(key: string): Promise<void>;
}

export interface ProxyDeps {
  build(blob: Blob, onProgress: (f: number) => void, signal: AbortSignal): Promise<Blob>;
  cache: ProxyCache;
  loadBlob(asset: MediaAsset): Promise<Blob | undefined>;
  makeURL(blob: Blob): string;
  revokeURL(url: string): void;
}

let worker: Worker | null = null;
let nextJob = 1;
const handlers = new Map<number, (m: ProxyResponse) => void>();

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL('./proxy.worker.ts', import.meta.url), { type: 'module', name: 'proxy' });
  w.onmessage = (e: MessageEvent<ProxyResponse>) => handlers.get(e.data.id)?.(e.data);
  w.onerror = (e) => {
    e.preventDefault();
    for (const [id, h] of handlers) h({ type: 'error', id, message: e.message || 'The preview worker crashed.', aborted: false });
    w.terminate();
    if (worker === w) worker = null;
  };
  worker = w;
  return w;
}

function buildInWorker(blob: Blob, onProgress: (f: number) => void, signal: AbortSignal): Promise<Blob> {
  const id = nextJob++;
  const w = getWorker();
  return new Promise((resolve, reject) => {
    const done = () => {
      handlers.delete(id);
      signal.removeEventListener('abort', onAbort);
    };
    const onAbort = () => w.postMessage({ type: 'cancel', id } satisfies ProxyMessage);
    handlers.set(id, (m) => {
      if (m.type === 'progress') onProgress(m.fraction);
      else if (m.type === 'result') {
        done();
        resolve(m.blob);
      } else {
        done();
        reject(m.aborted ? new DOMException('Proxy cancelled', 'AbortError') : new Error(m.message));
      }
    });
    signal.addEventListener('abort', onAbort, { once: true });
    w.postMessage({ type: 'run', id, blob, shortSide: PROXY_SHORT_SIDE, keyFrameInterval: PROXY_KEY_FRAME_INTERVAL } satisfies ProxyMessage);
  });
}

const DB_NAME = 'erdemcut-proxies';
const STORE = 'proxies';
let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB unavailable'));
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

const idbCache: ProxyCache = {
  get: async (k) => (await req((await db()).transaction(STORE, 'readonly').objectStore(STORE).get(k))) as Blob | undefined,
  put: async (k, b) => void (await req((await db()).transaction(STORE, 'readwrite').objectStore(STORE).put(b, k))),
  keys: async () => (await req((await db()).transaction(STORE, 'readonly').objectStore(STORE).getAllKeys())).map(String),
  delete: async (k) => void (await req((await db()).transaction(STORE, 'readwrite').objectStore(STORE).delete(k))),
};

async function loadAssetBlob(asset: MediaAsset): Promise<Blob | undefined> {
  if (asset.blob) return asset.blob;
  try {
    const b = await getAssetBlob(asset.id);
    if (b) return b;
  } catch {
    /* IndexedDB unavailable */
  }
  return undefined;
}

export const proxyDeps: ProxyDeps = {
  build: buildInWorker,
  cache: idbCache,
  loadBlob: loadAssetBlob,
  makeURL: (b) => URL.createObjectURL(b),
  revokeURL: (u) => URL.revokeObjectURL(u),
};

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

/** Assets that need a proxy: ready videos without one, not already handled. */
export function proxyCandidates(project: Project, handled: ReadonlySet<Id>): MediaAsset[] {
  return Object.values(project.assets).filter((a) => a.kind === 'video' && a.status === 'ready' && !a.previewURL && !handled.has(a.id));
}

const handled = new Set<Id>();
const queue: Id[] = [];
let pumping = false;
let current: { id: Id; ctl: AbortController } | null = null;

function setState(patch: (s: ProxyState) => Partial<ProxyState>): void {
  useProxyStore.setState((s) => patch(s));
}

function enqueue(project: Project): void {
  for (const a of proxyCandidates(project, handled)) {
    handled.add(a.id);
    queue.push(a.id);
  }
  setState(() => ({ queued: [...queue] }));
  void pump();
}

async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    while (queue.length) {
      const id = queue.shift()!;
      setState(() => ({ queued: [...queue] }));
      await makeProxy(id);
    }
  } finally {
    pumping = false;
  }
}

function attach(assetId: Id, blob: Blob): void {
  const S = useEditorStore.getState();
  if (!S.project.assets[assetId]) return;
  S.updateAsset(assetId, { previewURL: proxyDeps.makeURL(blob) });
}

/** Cached or freshly built proxy for one asset; failures leave the original in use. */
async function makeProxy(assetId: Id): Promise<void> {
  const asset = useEditorStore.getState().project.assets[assetId];
  if (!asset || asset.previewURL) return;
  try {
    const cached = await proxyDeps.cache.get(cacheKey(assetId)).catch(() => undefined);
    if (cached) {
      attach(assetId, cached);
      return;
    }
    const source = await proxyDeps.loadBlob(asset);
    if (!source) return;
    const ctl = new AbortController();
    current = { id: assetId, ctl };
    setState((s) => ({ building: { ...s.building, [assetId]: 0 } }));
    const proxy = await proxyDeps.build(source, (f) => setState((s) => (assetId in s.building ? { building: { ...s.building, [assetId]: f } } : {})), ctl.signal);
    await proxyDeps.cache.put(cacheKey(assetId), proxy).catch((e) => console.warn('[proxy] could not cache preview copy', e));
    attach(assetId, proxy);
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') handled.delete(assetId);
    else {
      const text = e instanceof Error ? e.message : String(e);
      console.warn(`[proxy] no preview copy for ${asset.name}: ${text}`);
      setState((s) => ({ failed: { ...s.failed, [assetId]: text } }));
    }
  } finally {
    if (current?.id === assetId) current = null;
    setState((s) => {
      const { [assetId]: _done, ...building } = s.building;
      return { building };
    });
  }
}

/** Deletes cached proxies whose asset is no longer in the project (or its undo history). */
export async function pruneProxies(): Promise<void> {
  const s = useEditorStore.getState();
  const live = new Set<string>();
  for (const p of [s.project, ...s.past.map((e) => e.project), ...s.future.map((e) => e.project)]) {
    for (const id of Object.keys(p.assets)) live.add(cacheKey(id));
  }
  try {
    for (const k of await proxyDeps.cache.keys()) if (!live.has(k)) await proxyDeps.cache.delete(k);
  } catch {
    /* IndexedDB unavailable */
  }
}

/** Starts watching the project for videos that need a proxy. Returns a stop function. */
export function startProxies(): () => void {
  let pruned = false;
  const check = (project: Project, hydrated: boolean) => {
    if (!hydrated) return;
    if (!pruned) {
      pruned = true;
      void pruneProxies();
    }
    // A cancelled/removed asset can come back with undo: let it be picked up again.
    if (current && !project.assets[current.id]) current.ctl.abort();
    enqueue(project);
  };
  const s = useEditorStore.getState();
  check(s.project, s.hydrated);
  return useEditorStore.subscribe((st, prev) => {
    if (st.project.assets !== prev.project.assets || st.hydrated !== prev.hydrated) check(st.project, st.hydrated);
  });
}

/** Test helper: forget all queue state. */
export function resetProxiesForTests(): void {
  handled.clear();
  queue.length = 0;
  pumping = false;
  current = null;
  useProxyStore.setState({ building: {}, queued: [], failed: {} });
}
