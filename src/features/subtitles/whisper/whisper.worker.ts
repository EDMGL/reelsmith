/**
 * Whisper speech-to-text worker (transformers.js + onnxruntime-web).
 *
 * - WebGPU when the browser has it, otherwise multi-threaded WASM (the page is
 *   cross-origin isolated, so SharedArrayBuffer threads are available).
 * - onnxruntime's WASM binary is served from our own origin (Vite `?url`), not
 *   a CDN. Model weights come from the Hugging Face Hub (CORS-enabled) and are
 *   kept in the browser's Cache Storage after the first download.
 * - Jobs run one at a time; cancel is checked between ~28 s chunks.
 */
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import ortMjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
import type { Cue } from '../formats';
import type { WhisperRequest, WhisperResponse } from './protocol';
import { levelDb, normalizeCues, planChunks, segmentsToCues, type WhisperSegment } from './segmenting';

const onnxWasm = env.backends.onnx?.wasm;
if (onnxWasm) onnxWasm.wasmPaths = { wasm: ortWasmUrl, mjs: ortMjsUrl };
env.allowLocalModels = false;

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<WhisperRequest>) => void) | null;
  postMessage(msg: WhisperResponse): void;
};

/** Chunks quieter than this are not sent to Whisper (it hallucinates on silence). */
const SILENT_CHUNK_DB = -50;

type Device = 'webgpu' | 'wasm';
const loaded = new Map<string, Promise<{ asr: AutomaticSpeechRecognitionPipeline; device: Device }>>();
const cancelled = new Set<number>();
let queue: Promise<void> = Promise.resolve();

async function hasWebGPU(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return false;
  try {
    return !!(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

const mb = (n: number) => `${Math.round(n / 1e6)} MB`;

function load(repo: string, onStatus: (m: string) => void) {
  let p = loaded.get(repo);
  if (p) return p;
  p = (async () => {
    const files = new Map<string, { loaded: number; total: number }>();
    const progress_callback = (info: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (info.status === 'progress' && info.file && info.total) {
        files.set(info.file, { loaded: info.loaded ?? 0, total: info.total });
        let l = 0;
        let t = 0;
        for (const f of files.values()) {
          l += f.loaded;
          t += f.total;
        }
        if (t > 5e6) onStatus(`Downloading model… ${Math.floor((100 * l) / t)}% (${mb(l)} / ${mb(t)})`);
      }
    };
    const create = (device: Device) =>
      pipeline('automatic-speech-recognition', repo, {
        device,
        dtype:
          device === 'webgpu'
            ? { encoder_model: 'fp32', decoder_model_merged: 'q4' }
            : { encoder_model: 'q8', decoder_model_merged: 'q8' },
        progress_callback,
      }) as Promise<AutomaticSpeechRecognitionPipeline>;
    onStatus('Loading model…');
    if (await hasWebGPU()) {
      try {
        return { asr: await create('webgpu'), device: 'webgpu' as const };
      } catch (err) {
        console.warn('[whisper] WebGPU failed, falling back to WASM', err);
        files.clear();
      }
    }
    return { asr: await create('wasm'), device: 'wasm' as const };
  })();
  loaded.set(repo, p);
  p.catch(() => loaded.delete(repo));
  return p;
}

class Aborted extends Error {}

async function transcribe(req: Extract<WhisperRequest, { type: 'transcribe' }>): Promise<void> {
  const { id, repo, samples, sampleRate, language } = req;
  const post = (m: WhisperResponse) => scope.postMessage(m);
  const check = () => {
    if (cancelled.has(id)) throw new Aborted();
  };
  try {
    check();
    const { asr, device } = await load(repo, (message) => post({ type: 'status', id, message }));
    check();
    const chunks = planChunks(samples, sampleRate);
    const total = samples.length || 1;
    const cues: Cue[] = [];
    const accel = device === 'webgpu' ? 'GPU' : 'CPU';
    post({ type: 'progress', id, fraction: 0 });
    for (const [i, ch] of chunks.entries()) {
      check();
      post({ type: 'status', id, message: `Transcribing on ${accel}… chunk ${i + 1}/${chunks.length}` });
      if (levelDb(samples, ch.start, ch.end) > SILENT_CHUNK_DB) {
        const out = (await asr(samples.subarray(ch.start, ch.end), {
          language,
          task: 'transcribe',
          return_timestamps: true,
        })) as { text: string; chunks?: { timestamp: [number, number | null]; text: string }[] };
        const segments: WhisperSegment[] = (out.chunks ?? [{ timestamp: [0, null], text: out.text }]).map((c) => ({
          start: c.timestamp[0] ?? 0,
          end: c.timestamp[1],
          text: c.text,
        }));
        cues.push(...segmentsToCues(segments, ch.start / sampleRate, ch.end / sampleRate));
      }
      post({ type: 'progress', id, fraction: ch.end / total });
    }
    post({ type: 'result', id, cues: normalizeCues(cues) });
  } catch (err) {
    if (err instanceof Aborted) post({ type: 'error', id, message: 'aborted', aborted: true });
    else post({ type: 'error', id, message: err instanceof Error ? err.message : String(err) });
  } finally {
    cancelled.delete(id);
  }
}

scope.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'cancel') cancelled.add(msg.id);
  else queue = queue.then(() => transcribe(msg));
};
