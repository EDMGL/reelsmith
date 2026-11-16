/**
 * Browser capture: screen (getDisplayMedia), camera + microphone
 * (getUserMedia), MediaRecorder per output, and a remux step that turns the
 * recorder's WebM/MP4 (no duration, no seek index) into a normal seekable file.
 */

export interface Sources {
  screen: boolean;
  camera: boolean;
  mic: boolean;
}

export interface OpenStreams {
  screen: MediaStream | null;
  camera: MediaStream | null;
  mic: MediaStream | null;
}

export async function openCamera(deviceId?: string): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
    audio: false,
  });
}

export async function openMicStream(deviceId?: string): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: false,
  });
}

export async function openScreen(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('This browser cannot record the screen.');
  return navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: 30 }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    // Lets the user tick "Share tab/system audio" in the picker.
    audio: true,
  });
}

export function stopStream(s: MediaStream | null | undefined): void {
  s?.getTracks().forEach((t) => t.stop());
}

function pickMime(): string | undefined {
  for (const t of ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4']) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t;
  }
  return undefined;
}

export interface Take {
  start(): void;
  stop(): Promise<Blob>;
}

/** A MediaRecorder over `tracks`. */
export function recordTracks(tracks: MediaStreamTrack[], videoBitsPerSecond: number): Take {
  const stream = new MediaStream(tracks);
  const mimeType = pickMime();
  const rec = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond, audioBitsPerSecond: 128_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
  return {
    start: () => rec.start(1000),
    stop: () =>
      new Promise<Blob>((resolve) => {
        const done = () => resolve(new Blob(chunks, { type: rec.mimeType || mimeType || 'video/webm' }));
        if (rec.state === 'inactive') return done();
        rec.onstop = done;
        rec.stop();
      }),
  };
}

/**
 * Re-packages a MediaRecorder blob without re-encoding so it has a duration
 * and a seek index (cues / sample tables). Falls back to the original blob.
 */
export async function makeSeekable(blob: Blob): Promise<{ blob: Blob; ext: string }> {
  const isMp4 = blob.type.includes('mp4');
  try {
    const mb = await import('mediabunny');
    const input = new mb.Input({ source: new mb.BlobSource(blob), formats: mb.ALL_FORMATS });
    const format = isMp4 ? new mb.Mp4OutputFormat({ fastStart: 'in-memory' }) : new mb.WebMOutputFormat();
    const output = new mb.Output({ format, target: new mb.BufferTarget() });
    const conversion = await mb.Conversion.init({ input, output });
    if (!conversion.isValid) throw new Error('nothing to convert');
    await conversion.execute();
    input.dispose();
    const buf = output.target.buffer;
    if (!buf) throw new Error('empty output');
    return { blob: new Blob([buf], { type: format.mimeType }), ext: format.fileExtension };
  } catch (e) {
    console.warn('[recorder] remux failed, keeping the raw recording', e);
    return { blob, ext: isMp4 ? '.mp4' : '.webm' };
  }
}
