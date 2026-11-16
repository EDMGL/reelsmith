/**
 * On-device Whisper transcription providers. The heavy worker (transformers.js
 * + onnxruntime) is only created on the first `transcribe` call, so it costs
 * nothing at startup.
 */
import type { Cue } from '../formats';
import { throwIfAborted, type TranscriptionOptions, type TranscriptionProvider } from '../transcription';
import { WHISPER_MODELS, type WhisperModel, type WhisperRequest, type WhisperResponse } from './protocol';

const SAMPLE_RATE = 16000;

let worker: Worker | null = null;
let nextId = 1;
const jobs = new Map<number, (msg: WhisperResponse) => void>();

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module', name: 'whisper' });
  w.onmessage = (e: MessageEvent<WhisperResponse>) => jobs.get(e.data.id)?.(e.data);
  w.onerror = (e) => {
    e.preventDefault();
    const message = e.message || 'The speech-to-text worker crashed.';
    for (const [id, handler] of jobs) handler({ type: 'error', id, message });
    w.terminate();
    if (worker === w) worker = null;
  };
  worker = w;
  return w;
}

async function toMonoSamples(audio: AudioBuffer | Blob): Promise<Float32Array> {
  let buffer: AudioBuffer;
  if ('getChannelData' in audio) buffer = audio;
  else {
    const ctx = new OfflineAudioContext(1, 1, SAMPLE_RATE);
    buffer = await ctx.decodeAudioData(await audio.arrayBuffer());
  }
  if (buffer.sampleRate !== SAMPLE_RATE || buffer.numberOfChannels !== 1) {
    const ctx = new OfflineAudioContext(1, Math.ceil(buffer.duration * SAMPLE_RATE), SAMPLE_RATE);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.start();
    buffer = await ctx.startRendering();
  }
  return buffer.getChannelData(0).slice();
}

function run(model: WhisperModel, samples: Float32Array, opts: TranscriptionOptions): Promise<Cue[]> {
  const id = nextId++;
  const w = getWorker();
  return new Promise<Cue[]>((resolve, reject) => {
    const done = () => {
      jobs.delete(id);
      opts.signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      w.postMessage({ type: 'cancel', id } satisfies WhisperRequest);
      done();
      reject(new DOMException('Transcription aborted', 'AbortError'));
    };
    jobs.set(id, (msg) => {
      if (msg.type === 'status') opts.onStatus?.(msg.message);
      else if (msg.type === 'progress') opts.onProgress?.(msg.fraction);
      else if (msg.type === 'result') {
        done();
        resolve(msg.cues);
      } else {
        done();
        reject(msg.aborted ? new DOMException('Transcription aborted', 'AbortError') : new Error(msg.message));
      }
    });
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    const req: WhisperRequest = { type: 'transcribe', id, repo: model.repo, samples, sampleRate: SAMPLE_RATE, language: opts.language };
    w.postMessage(req, [samples.buffer]);
  });
}

export function createWhisperProvider(model: WhisperModel): TranscriptionProvider {
  return {
    id: model.id,
    label: model.label,
    async transcribe(audio, opts = {}) {
      throwIfAborted(opts.signal);
      const samples = await toMonoSamples(audio);
      throwIfAborted(opts.signal);
      return run(model, samples, opts);
    },
  };
}

export const whisperProviders: readonly TranscriptionProvider[] = WHISPER_MODELS.map(createWhisperProvider);
