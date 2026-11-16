import { createClipFromAsset, createProject, createTextClip } from '../model';
import type { MediaAsset, Project, VideoClip } from '../types';

export function makeAsset(id: string, duration = 10, kind: MediaAsset['kind'] = 'video'): MediaAsset {
  return {
    id,
    kind,
    name: `${id}.mp4`,
    mimeType: 'video/mp4',
    size: 1,
    duration: kind === 'image' ? null : duration,
    width: 1920,
    height: 1080,
    hasAudio: true,
    status: 'ready',
    objectURL: `blob:${id}`,
  };
}

/** Project with tracks V (video, order 0) and A (audio) and a 10s asset. */
export function makeProject(): { project: Project; v: string; a: string } {
  const p = createProject();
  const v = p.tracks.find((t) => t.kind === 'video')!.id;
  const a = p.tracks.find((t) => t.kind === 'audio')!.id;
  return { project: { ...p, assets: { asset1: makeAsset('asset1') } }, v, a };
}

export function videoClip(project: Project, id: string, trackId: string, start: number, sourceIn = 0, sourceOut = 4): VideoClip {
  const c = createClipFromAsset(project.assets.asset1!, { trackId, start }) as VideoClip;
  return { ...c, id, sourceIn, sourceOut, duration: sourceOut - sourceIn };
}

export function withClips(project: Project, ...clips: ReturnType<typeof videoClip | typeof createTextClip>[]): Project {
  return { ...project, clips: { ...project.clips, ...Object.fromEntries(clips.map((c) => [c.id, c])) } };
}
