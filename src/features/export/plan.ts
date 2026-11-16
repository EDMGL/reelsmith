/**
 * Pure export planning math: output size, frame grid, timestamps, bitrates,
 * key-frame cadence, file names. No DOM.
 */
import { getProjectDuration, type Project } from '../../core';

/** 'project' = project canvas size; numbers = target SHORT side in px ("1080p" for any aspect). */
export type ResolutionPreset = 'project' | 2160 | 1440 | 1080 | 720 | 480;
export type QualityPreset = 'low' | 'medium' | 'high';
export type FormatPreference = 'mp4' | 'webm';

export interface ExportSettings {
  fileName: string;
  resolution: ResolutionPreset;
  fps: number;
  quality: QualityPreset;
  format: FormatPreference;
}

export const RESOLUTION_PRESETS: readonly Exclude<ResolutionPreset, 'project'>[] = [2160, 1440, 1080, 720, 480];
export const FPS_OPTIONS: readonly number[] = [24, 25, 30, 60];
export const KEYFRAME_INTERVAL_SEC = 2;
export const AUDIO_SAMPLE_RATE = 48000;
export const AUDIO_CHANNELS = 2;

/** Bits per pixel per frame for H.264-class codecs. */
export const QUALITY_BPP: Readonly<Record<QualityPreset, number>> = { low: 0.04, medium: 0.08, high: 0.15 };
export const AUDIO_BITRATE: Readonly<Record<QualityPreset, number>> = { low: 96_000, medium: 128_000, high: 192_000 };
export const MIN_VIDEO_BITRATE = 500_000;
export const MAX_VIDEO_BITRATE = 60_000_000;

/** Nearest even integer >= 2 (encoders need even sizes for 4:2:0). */
export function even(x: number): number {
  return Math.max(2, Math.round(x / 2) * 2);
}

/** Output size for a preset, keeping the project aspect ratio; always even. */
export function scaledSize(projectWidth: number, projectHeight: number, preset: ResolutionPreset): { width: number; height: number } {
  if (preset === 'project') return { width: even(projectWidth), height: even(projectHeight) };
  const scale = preset / Math.min(projectWidth, projectHeight);
  return { width: even(projectWidth * scale), height: even(projectHeight * scale) };
}

export interface ResolutionOption {
  value: ResolutionPreset;
  label: string;
  width: number;
  height: number;
}

/** "Project" plus every preset smaller than the project's short side (no upscaling). */
export function resolutionOptions(projectWidth: number, projectHeight: number): ResolutionOption[] {
  const p = scaledSize(projectWidth, projectHeight, 'project');
  const out: ResolutionOption[] = [{ value: 'project', label: `Project (${p.width}×${p.height})`, ...p }];
  const short = Math.min(projectWidth, projectHeight);
  for (const r of RESOLUTION_PRESETS) {
    if (r >= short) continue;
    const s = scaledSize(projectWidth, projectHeight, r);
    out.push({ value: r, label: `${r}p (${s.width}×${s.height})`, ...s });
  }
  return out;
}

/** Frame rate choices: project fps first, then the standard ones. */
export function fpsOptions(projectFps: number): number[] {
  return [...new Set([projectFps, ...FPS_OPTIONS])].sort((a, b) => a - b);
}

export function videoBitrate(width: number, height: number, fps: number, quality: QualityPreset): number {
  const raw = Math.round(width * height * fps * QUALITY_BPP[quality]);
  return Math.min(MAX_VIDEO_BITRATE, Math.max(MIN_VIDEO_BITRATE, raw));
}

/** Number of frames covering [0, duration): ceil(duration * fps); 0 for an empty project. */
export function frameCount(duration: number, fps: number): number {
  if (!(duration > 0) || !(fps > 0)) return 0;
  return Math.max(1, Math.ceil(duration * fps - 1e-6));
}

/** Presentation timestamp of frame i in microseconds (rounded, drift-free). */
export function frameTimestampUs(i: number, fps: number): number {
  return Math.round((i * 1_000_000) / fps);
}

/** Duration of frame i in microseconds (difference of consecutive timestamps). */
export function frameDurationUs(i: number, fps: number): number {
  return frameTimestampUs(i + 1, fps) - frameTimestampUs(i, fps);
}

/** Key frame every KEYFRAME_INTERVAL_SEC seconds (in frames). */
export function keyFrameEvery(fps: number): number {
  return Math.max(1, Math.round(fps * KEYFRAME_INTERVAL_SEC));
}

export function isKeyFrame(i: number, fps: number): boolean {
  return i % keyFrameEvery(fps) === 0;
}

/** Removes characters that are invalid in file names and any extension. */
export function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_')
    .replace(/\.(mp4|webm|mov|mkv)$/i, '')
    .trim()
    .replace(/^\.+/, '');
  return cleaned.slice(0, 120) || 'export';
}

export interface ExportPlan {
  width: number;
  height: number;
  fps: number;
  /** Seconds (= project duration). */
  duration: number;
  frameCount: number;
  videoBitrate: number;
  audioBitrate: number;
  keyFrameEvery: number;
  sampleRate: number;
  channels: number;
  /** Without extension. */
  fileName: string;
}

export function planExport(project: Project, settings: ExportSettings): ExportPlan {
  const { width, height } = scaledSize(project.width, project.height, settings.resolution);
  const fps = settings.fps > 0 ? settings.fps : project.fps;
  const duration = getProjectDuration(project);
  return {
    width,
    height,
    fps,
    duration,
    frameCount: frameCount(duration, fps),
    videoBitrate: videoBitrate(width, height, fps, settings.quality),
    audioBitrate: AUDIO_BITRATE[settings.quality],
    keyFrameEvery: keyFrameEvery(fps),
    sampleRate: AUDIO_SAMPLE_RATE,
    channels: AUDIO_CHANNELS,
    fileName: sanitizeFileName(settings.fileName),
  };
}

export function defaultSettings(project: Project): ExportSettings {
  return { fileName: sanitizeFileName(project.name), resolution: 'project', fps: project.fps, quality: 'medium', format: 'mp4' };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatClock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
