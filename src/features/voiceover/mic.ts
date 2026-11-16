/**
 * Microphone access + recording (browser only): getUserMedia with voice
 * processing (echo cancellation, noise suppression, auto gain), a live level
 * meter (AnalyserNode) and a MediaRecorder.
 */

export interface MicSession {
  /** Starts recording; resolves once the recorder is actually running. */
  start(): Promise<void>;
  /** Stops recording and resolves with the recorded blob. */
  stop(): Promise<Blob>;
  /** Current input level 0..1 (RMS, roughly perceptual). */
  level(): number;
  /** Releases the microphone (also after stop). */
  close(): void;
}

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return undefined;
}

export async function openMic(deviceId?: string): Promise<MicSession> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser cannot record audio.');
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  let ctx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  try {
    ctx = new AudioContext();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
  } catch {
    analyser = null;
  }
  const buf = new Float32Array(1024);
  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    for (const t of stream.getTracks()) t.stop();
    void ctx?.close().catch(() => undefined);
  };
  return {
    start: () =>
      new Promise<void>((resolve, reject) => {
        recorder.onstart = () => resolve();
        recorder.onerror = (e) => reject((e as unknown as { error?: Error }).error ?? new Error('Recording failed'));
        recorder.start(250);
      }),
    stop: () =>
      new Promise<Blob>((resolve) => {
        if (recorder.state === 'inactive') return resolve(new Blob(chunks, { type: recorder.mimeType || mimeType }));
        recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || mimeType }));
        recorder.stop();
      }),
    level: () => {
      if (!analyser) return 0;
      analyser.getFloatTimeDomainData(buf);
      let e = 0;
      for (let i = 0; i < buf.length; i++) e += buf[i]! * buf[i]!;
      const db = 10 * Math.log10(e / buf.length + 1e-12);
      return Math.min(1, Math.max(0, (db + 60) / 60));
    },
    close,
  };
}

export async function listMics(): Promise<{ id: string; label: string }[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === 'audioinput')
    .map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
}

/** Decodes a recorded blob to PCM. */
export async function decodeRecording(blob: Blob): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(1, 1, 48000);
  return ctx.decodeAudioData(await blob.arrayBuffer());
}
