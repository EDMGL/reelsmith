/**
 * Decodes an asset's audio track to mono PCM (browser only).
 * Uses an OfflineAudioContext at ANALYSIS_SAMPLE_RATE (plenty for RMS levels,
 * a third of the memory of 48 kHz). A few recent results are cached per asset.
 */
import { getAssetBlob, type MediaAsset } from '../../core';
import { downmix } from './analysis';

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
  const data = await blob.arrayBuffer();
  const ctx = new OfflineAudioContext(1, 1, ANALYSIS_SAMPLE_RATE);
  let buffer: AudioBuffer;
  try {
    buffer = await ctx.decodeAudioData(data);
  } catch {
    throw new Error(`Could not decode the audio of "${asset.name}" (no audio track or unsupported codec)`);
  }
  const channels: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
  return { samples: downmix(channels), sampleRate: buffer.sampleRate };
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
