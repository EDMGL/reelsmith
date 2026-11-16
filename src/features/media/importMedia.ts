/**
 * Media import: detects kind, probes metadata, makes thumbnails and (best
 * effort) audio waveforms. Browser-only (uses media elements, canvas, Web Audio).
 */
import { createId, putAssetBlob, useEditorStore, type AssetKind, type MediaAsset } from '../../core';

const EXT_KIND: Record<string, AssetKind> = {
  mp4: 'video', m4v: 'video', mov: 'video', webm: 'video', mkv: 'video', ogv: 'video',
  mp3: 'audio', wav: 'audio', m4a: 'audio', aac: 'audio', ogg: 'audio', oga: 'audio', flac: 'audio', opus: 'audio',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', avif: 'image', bmp: 'image', svg: 'image',
};

export function detectKind(file: Pick<File, 'type' | 'name'>): AssetKind | null {
  const t = file.type;
  if (t.startsWith('video/')) return 'video';
  if (t.startsWith('audio/')) return 'audio';
  if (t.startsWith('image/')) return 'image';
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return EXT_KIND[ext] ?? null;
}

const THUMB_W = 192;
const WAVEFORM_POINTS = 1200;
/** Files above this size skip waveform decoding (keeps memory sane). */
const MAX_DECODE_BYTES = 300 * 1024 * 1024;
const PROBE_TIMEOUT = 20000;

function once(el: EventTarget, ok: string, timeout = PROBE_TIMEOUT): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => cleanup(new Error(`timeout waiting for ${ok}`)), timeout);
    const onOk = () => cleanup();
    const onErr = () => cleanup(new Error('media error'));
    function cleanup(err?: Error) {
      clearTimeout(timer);
      el.removeEventListener(ok, onOk);
      el.removeEventListener('error', onErr);
      if (err) reject(err);
      else resolve();
    }
    el.addEventListener(ok, onOk);
    el.addEventListener('error', onErr);
  });
}

function drawThumb(source: CanvasImageSource, w: number, h: number): string | undefined {
  if (!w || !h) return undefined;
  const canvas = document.createElement('canvas');
  canvas.width = THUMB_W;
  canvas.height = Math.max(1, Math.round((THUMB_W * h) / w));
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  try {
    return canvas.toDataURL('image/jpeg', 0.72);
  } catch {
    return undefined;
  }
}

interface Probe {
  duration: number | null;
  width: number;
  height: number;
  hasAudio: boolean;
  thumbnail?: string;
}

async function probeVideo(url: string): Promise<Probe> {
  const v = document.createElement('video');
  v.preload = 'auto';
  v.muted = true;
  v.playsInline = true;
  v.src = url;
  await once(v, 'loadedmetadata');
  let duration = v.duration;
  if (!Number.isFinite(duration)) {
    // Some WebM files report Infinity until seeked to the end.
    v.currentTime = 1e9;
    await once(v, 'seeked').catch(() => undefined);
    duration = v.duration;
    v.currentTime = 0;
  }
  const el = v as HTMLVideoElement & { mozHasAudio?: boolean; audioTracks?: { length: number } };
  const hasAudio = el.mozHasAudio ?? (el.audioTracks ? el.audioTracks.length > 0 : true);
  let thumbnail: string | undefined;
  try {
    v.currentTime = Math.min(1, (Number.isFinite(duration) ? duration : 0) * 0.1);
    await once(v, 'seeked', 8000);
    thumbnail = drawThumb(v, v.videoWidth, v.videoHeight);
  } catch {
    /* thumbnail is optional */
  }
  const out = { duration: Number.isFinite(duration) ? duration : 0, width: v.videoWidth, height: v.videoHeight, hasAudio, thumbnail };
  v.removeAttribute('src');
  v.load();
  return out;
}

async function probeAudio(url: string): Promise<Probe> {
  const a = document.createElement('audio');
  a.preload = 'metadata';
  a.src = url;
  await once(a, 'loadedmetadata');
  return { duration: Number.isFinite(a.duration) ? a.duration : 0, width: 0, height: 0, hasAudio: true };
}

async function probeImage(url: string): Promise<Probe> {
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  await img.decode();
  const w = img.naturalWidth || 1080;
  const h = img.naturalHeight || 1080;
  return { duration: null, width: w, height: h, hasAudio: false, thumbnail: drawThumb(img, w, h) };
}

/**
 * Decodes the audio track and returns normalized peaks; `null` if there is no
 * decodable audio; `undefined` if decoding was skipped (file too large / no Web Audio).
 */
export async function computeWaveform(blob: Blob, points = WAVEFORM_POINTS): Promise<number[] | null | undefined> {
  if (blob.size > MAX_DECODE_BYTES || typeof OfflineAudioContext === 'undefined') return undefined;
  try {
    const buf = await blob.arrayBuffer();
    const ctx = new OfflineAudioContext(1, 1, 44100);
    const audio = await ctx.decodeAudioData(buf);
    const data = audio.getChannelData(0);
    const bucket = Math.max(1, Math.floor(data.length / points));
    const peaks: number[] = [];
    let max = 0;
    for (let i = 0; i < data.length; i += bucket) {
      let p = 0;
      const end = Math.min(data.length, i + bucket);
      for (let j = i; j < end; j += 4) p = Math.max(p, Math.abs(data[j]!));
      peaks.push(p);
      max = Math.max(max, p);
    }
    return peaks.map((p) => Math.round((max > 0 ? p / max : 0) * 100) / 100);
  } catch {
    return null;
  }
}

/** Imports one file into the store. Returns the asset id, or null if unsupported/failed. */
export async function importFile(file: File): Promise<string | null> {
  const kind = detectKind(file);
  if (!kind) return null;
  const objectURL = URL.createObjectURL(file);
  let probe: Probe;
  try {
    probe = kind === 'video' ? await probeVideo(objectURL) : kind === 'audio' ? await probeAudio(objectURL) : await probeImage(objectURL);
  } catch (e) {
    console.warn(`[media] could not read ${file.name}`, e);
    URL.revokeObjectURL(objectURL);
    return null;
  }
  const asset: MediaAsset = {
    id: createId('asset'),
    kind,
    name: file.name,
    mimeType: file.type,
    size: file.size,
    ...probe,
    status: 'ready',
    objectURL,
    blob: file,
  };
  const store = useEditorStore.getState();
  store.addAsset(asset);
  // Persist the blob right away so a quick reload doesn't lose it.
  putAssetBlob(asset.id, file).catch((e) => console.warn('[media] could not store blob', e));
  if (kind !== 'image') {
    void computeWaveform(file).then((waveform) => {
      if (waveform) useEditorStore.getState().updateAsset(asset.id, { waveform, hasAudio: true });
      else if (waveform === null && kind === 'video') useEditorStore.getState().updateAsset(asset.id, { hasAudio: false });
    });
  }
  return asset.id;
}

export async function importFiles(files: Iterable<File>): Promise<{ imported: string[]; failed: string[] }> {
  const imported: string[] = [];
  const failed: string[] = [];
  for (const f of files) {
    const id = await importFile(f);
    if (id) imported.push(id);
    else failed.push(f.name);
  }
  return { imported, failed };
}
