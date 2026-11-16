/**
 * Silence-analysis worker: runs `analyzeSignal` off the main thread and
 * reports progress. Abort = the caller terminates the worker.
 */
import { analyzeSignal } from './analysis';
import type { WorkerRequest, WorkerResponse } from './workerProtocol';

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(msg: WorkerResponse): void;
};

scope.onmessage = (e) => {
  const { id, samples, sampleRate, params } = e.data;
  let last = -1;
  try {
    const result = analyzeSignal(samples, sampleRate, params, {
      onProgress: (fraction) => {
        if (fraction - last >= 0.02 || fraction === 1) {
          last = fraction;
          scope.postMessage({ type: 'progress', id, fraction });
        }
      },
    });
    scope.postMessage({ type: 'result', id, result });
  } catch (err) {
    scope.postMessage({ type: 'error', id, message: err instanceof Error ? err.message : String(err) });
  }
};
