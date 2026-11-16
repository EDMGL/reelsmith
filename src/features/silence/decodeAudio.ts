/**
 * Decodes an asset's audio track to mono PCM (browser only).
 * Uses an OfflineAudioContext at ANALYSIS_SAMPLE_RATE (plenty for RMS levels,
 * a third of the memory of 48 kHz). A few recent results are cached per asset.
 */
import { decodeMediaAudio, getAssetBlob, type MediaAsset } from '../../core';

export const ANALYSIS_SAMPLE_RATE = 16000;
const CACHE_SIZE = 4;

export interface MonoAudio {
  samples: Float32Array;
  sampleRate: number;
}

const cache = new Map<string, Promise<MonoAudio>>();

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

async function decode(asset: MediaAsset): Promise<MonoAudio> {
  const blob = await loadBlob(asset);
  // Streams large files (multi-GB phone videos) instead of reading them whole.
  let buffer: AudioBuffer | null;
  try {
    buffer = await decodeMediaAudio(blob, { sampleRate: ANALYSIS_SAMPLE_RATE, channels: 1 });
  } catch (e) {
    throw new Error(`Could not decode the audio of "${asset.name}" (${e instanceof Error ? e.message : 'unsupported codec'})`);
  }
  if (!buffer) throw new Error(`"${asset.name}" has no audio track`);
  return { samples: buffer.getChannelData(0), sampleRate: buffer.sampleRate };
}

export function decodeAssetMono(asset: MediaAsset): Promise<MonoAudio> {
  const hit = cache.get(asset.id);
  if (hit) {
    cache.delete(asset.id);
    cache.set(asset.id, hit);
    return hit;
  }
  const p = decode(asset);
  cache.set(asset.id, p);
  p.catch(() => cache.delete(asset.id));
  while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  return p;
}
