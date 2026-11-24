import { createProject, getAspectPreset, type MediaAsset, type Project } from '../../../core';
import type { TemplateAspect } from '../types';

export function asset(id: string, kind: MediaAsset['kind'], w: number, h: number, duration: number | null = null): MediaAsset {
  return { id, kind, name: `${id}.${kind === 'image' ? 'jpg' : kind === 'video' ? 'mp4' : 'wav'}`, mimeType: '', size: 1, duration, width: w, height: h, hasAudio: kind !== 'image', status: 'ready', objectURL: `blob:${id}` };
}

/** Landscape 30 s video, portrait photo, square photo, short 1 s video. */
export const ASSETS = {
  wideVideo: asset('wide', 'video', 1920, 1080, 30),
  tallPhoto: asset('tall', 'image', 1080, 1920),
  squarePhoto: asset('square', 'image', 1000, 1000),
  shortVideo: asset('short', 'video', 1080, 1920, 1),
};

export function projectFor(aspect: TemplateAspect = '9:16', assets: MediaAsset[] = Object.values(ASSETS)): Project {
  const p = getAspectPreset(aspect)!;
  const base = createProject({ width: p.width, height: p.height, aspectPreset: aspect });
  return { ...base, assets: Object.fromEntries(assets.map((a) => [a.id, a])) };
}
