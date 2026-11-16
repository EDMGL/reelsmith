/**
 * Noise reduction jobs + project edits.
 *
 * Cleaning a file creates a NEW asset ("<name> (clean)") and points every clip
 * that used the old one at it, in one undo step. The new asset remembers its
 * source (`derivedFrom`), so it can be re-done with another strength (always
 * from the original audio, never stacked) or reverted with "Restore original".
 */
import { create } from 'zustand';
import { createId, getAssetBlob, useEditorStore, type Id, type MediaAsset, type Project } from '../../core';
import type { DenoiseMessage, DenoiseResponse } from './protocol';
import { DENOISE_STRENGTHS, type DenoiseOptions, type DenoiseStrength } from './spectralGate';

export const DENOISE_OPERATION = 'denoise';

export interface DenoiseOutput {
  blob: Blob;
  extension: string;
  hasVideo: boolean;
}

export interface Job {
  fraction: number;
  label: string;
}

interface DenoiseState {
  /** Running jobs, keyed by the ORIGINAL asset id. */
  jobs: Record<Id, Job>;
  /** Last error / info message per original asset id. */
  messages: Record<Id, { kind: 'info' | 'error'; text: string }>;
}

export const useDenoiseStore = create<DenoiseState>()(() => ({ jobs: {}, messages: {} }));

// ---------------------------------------------------------------------------
// Worker plumbing (swappable in tests)
// ---------------------------------------------------------------------------

let worker: Worker | null = null;
let nextId = 1;
const handlers = new Map<number, (m: DenoiseResponse) => void>();

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL('./denoise.worker.ts', import.meta.url), { type: 'module', name: 'denoise' });
  w.onmessage = (e: MessageEvent<DenoiseResponse>) => handlers.get(e.data.id)?.(e.data);
  w.onerror = (e) => {
    e.preventDefault();
    for (const [id, h] of handlers) h({ type: 'error', id, message: e.message || 'The noise reduction worker crashed.' });
    w.terminate();
    if (worker === w) worker = null;
  };
  worker = w;
  return w;
}

function processInWorker(blob: Blob, options: DenoiseOptions, onProgress: (j: Job) => void, signal: AbortSignal): Promise<DenoiseOutput> {
  const id = nextId++;
  const w = getWorker();
  return new Promise((resolve, reject) => {
    const done = () => {
      handlers.delete(id);
      signal.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      w.postMessage({ type: 'cancel', id } satisfies DenoiseMessage);
      done();
      reject(new DOMException('Noise reduction cancelled', 'AbortError'));
    };
    handlers.set(id, (m) => {
      if (m.type === 'progress') onProgress({ fraction: m.fraction, label: m.label });
      else if (m.type === 'result') {
        done();
        resolve({ blob: m.blob, extension: m.extension, hasVideo: m.hasVideo });
      } else {
        done();
        reject(m.aborted ? new DOMException('Noise reduction cancelled', 'AbortError') : new Error(m.message));
      }
    });
    signal.addEventListener('abort', onAbort, { once: true });
    w.postMessage({ type: 'run', id, blob, options } satisfies DenoiseMessage);
  });
}

async function loadBlob(asset: MediaAsset): Promise<Blob> {
  if (asset.blob) return asset.blob;
  try {
    const b = await getAssetBlob(asset.id);
    if (b) return b;
  } catch {
    /* IndexedDB unavailable: try the object URL */
  }
  if (asset.objectURL) return (await fetch(asset.objectURL)).blob();
  throw new Error(`Media file "${asset.name}" is not available`);
}

export const denoiseDeps = {
  process: processInWorker,
  loadBlob,
  makeURL: (b: Blob) => URL.createObjectURL(b),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The untouched source of `asset` (itself unless it is a denoised copy whose original still exists). */
export function originalOf(project: Project, asset: MediaAsset): MediaAsset {
  const from = asset.derivedFrom;
  if (from?.operation === DENOISE_OPERATION) return project.assets[from.assetId] ?? asset;
  return asset;
}

export function denoisedStrength(asset: MediaAsset): DenoiseStrength | null {
  if (asset.derivedFrom?.operation !== DENOISE_OPERATION) return null;
  const s = asset.derivedFrom.params?.strength;
  return typeof s === 'string' && s in DENOISE_STRENGTHS ? (s as DenoiseStrength) : null;
}

export function clipsUsing(project: Project, assetId: Id): Id[] {
  return Object.values(project.clips)
    .filter((c) => 'assetId' in c && c.assetId === assetId)
    .map((c) => c.id);
}

function stem(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

/**
 * Points every clip using `fromId` at `toId` (one undo step). A denoised `fromId`
 * that ends up unused is removed from the library. Returns how many clips moved.
 */
export function swapAsset(fromId: Id, toId: Id, label: string): number {
  const S = useEditorStore.getState;
  let moved = 0;
  S().transact(label, () => {
    for (const id of clipsUsing(S().project, fromId)) if (S().updateClip(id, { assetId: toId })) moved++;
    const from = S().project.assets[fromId];
    if (from?.derivedFrom?.operation === DENOISE_OPERATION && clipsUsing(S().project, fromId).length === 0) S().removeAsset(fromId);
  });
  return moved;
}

const controllers = new Map<Id, AbortController>();

function setJob(id: Id, job: Job | null): void {
  const jobs = { ...useDenoiseStore.getState().jobs };
  if (job) jobs[id] = job;
  else delete jobs[id];
  useDenoiseStore.setState({ jobs });
}

function setMessage(id: Id, msg: { kind: 'info' | 'error'; text: string } | null): void {
  const messages = { ...useDenoiseStore.getState().messages };
  if (msg) messages[id] = msg;
  else delete messages[id];
  useDenoiseStore.setState({ messages });
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Cleans the audio of `assetId` (or of its original, if it is already a cleaned copy). */
export async function reduceNoise(assetId: Id, strength: DenoiseStrength): Promise<boolean> {
  const project = useEditorStore.getState().project;
  const current = project.assets[assetId];
  if (!current) return false;
  const source = originalOf(project, current);
  if (controllers.has(source.id)) return false;
  const ctl = new AbortController();
  controllers.set(source.id, ctl);
  setMessage(source.id, null);
  setJob(source.id, { fraction: 0, label: 'Preparing…' });
  try {
    const blob = await denoiseDeps.loadBlob(source);
    const { label: _l, hint: _h, ...options } = DENOISE_STRENGTHS[strength];
    const out = await denoiseDeps.process(blob, options, (j) => setJob(source.id, j), ctl.signal);
    const cleaned: MediaAsset = {
      ...source,
      id: createId(),
      name: `${stem(source.name)} (clean).${out.extension.replace(/^\./, '')}`,
      kind: out.hasVideo ? source.kind : 'audio',
      mimeType: out.blob.type || source.mimeType,
      size: out.blob.size,
      blob: out.blob,
      objectURL: denoiseDeps.makeURL(out.blob),
      status: 'ready',
      hasAudio: true,
      derivedFrom: { assetId: source.id, operation: DENOISE_OPERATION, params: { strength } },
    };
    // The user may have switched clips to another asset meanwhile: swap whatever now uses `current`.
    useEditorStore.getState().addAsset(cleaned);
    const moved = swapAsset(current.id, cleaned.id, 'Reduce noise');
    setMessage(source.id, {
      kind: moved ? 'info' : 'error',
      text: moved
        ? `Noise reduced (${DENOISE_STRENGTHS[strength].label}) on ${moved} clip${moved === 1 ? '' : 's'}. Undo or "Restore original" to compare.`
        : 'Cleaned file was added to the library, but no clip could use it (locked tracks?).',
    });
    return moved > 0;
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === 'AbortError';
    setMessage(source.id, aborted ? { kind: 'info', text: 'Noise reduction cancelled.' } : { kind: 'error', text: `Noise reduction failed: ${e instanceof Error ? e.message : String(e)}` });
    return false;
  } finally {
    controllers.delete(source.id);
    setJob(source.id, null);
  }
}

export function cancelNoiseReduction(sourceAssetId: Id): void {
  controllers.get(sourceAssetId)?.abort();
}

/** Points clips using a cleaned copy back at the original file. */
export function restoreOriginal(cleanedAssetId: Id): boolean {
  const project = useEditorStore.getState().project;
  const asset = project.assets[cleanedAssetId];
  if (!asset) return false;
  const original = originalOf(project, asset);
  if (original.id === asset.id) return false;
  const moved = swapAsset(asset.id, original.id, 'Restore original audio');
  setMessage(original.id, moved ? { kind: 'info', text: 'Original audio restored.' } : { kind: 'error', text: 'Nothing restored (locked tracks?).' });
  return moved > 0;
}
