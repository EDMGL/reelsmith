/**
 * Runs `analyzeSignal` in a module Web Worker (transferring a copy of the
 * samples), with progress and abort. Falls back to running inline (on the
 * calling thread) where Worker is unavailable, e.g. in unit tests.
 */
import { abortError, analyzeSignal, type SignalAnalysis } from './analysis';
import type { AnalysisParams, WorkerRequest, WorkerResponse } from './workerProtocol';

export interface RunOptions {
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

let nextId = 1;

export function runAnalysis(
  samples: Float32Array,
  sampleRate: number,
  params: AnalysisParams,
  opts: RunOptions = {},
): Promise<SignalAnalysis> {
  if (opts.signal?.aborted) return Promise.reject(abortError());
  if (typeof Worker === 'undefined') {
    return Promise.resolve().then(() =>
      analyzeSignal(samples, sampleRate, params, { onProgress: opts.onProgress, shouldAbort: () => !!opts.signal?.aborted }),
    );
  }
  return new Promise<SignalAnalysis>((resolve, reject) => {
    const worker = new Worker(new URL('./silence.worker.ts', import.meta.url), { type: 'module', name: 'silence-analysis' });
    const id = nextId++;
    const finish = () => {
      worker.terminate();
      opts.signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      finish();
      reject(abortError());
    };
    opts.signal?.addEventListener('abort', onAbort);
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const m = e.data;
      if (m.id !== id) return;
      if (m.type === 'progress') opts.onProgress?.(m.fraction);
      else if (m.type === 'result') {
        finish();
        resolve(m.result);
      } else {
        finish();
        reject(new Error(m.message));
      }
    };
    worker.onerror = (e) => {
      finish();
      reject(new Error(e.message || 'Silence analysis worker failed to start'));
    };
    // Transfer a copy so the caller's (cached) buffer stays usable.
    const copy = samples.slice();
    const req: WorkerRequest = { id, samples: copy, sampleRate, params };
    worker.postMessage(req, [copy.buffer]);
  });
}
