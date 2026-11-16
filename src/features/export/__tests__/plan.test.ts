import { describe, expect, it } from 'vitest';
import { createProject, type Project } from '../../../core';
import {
  AUDIO_BITRATE,
  MAX_VIDEO_BITRATE,
  MIN_VIDEO_BITRATE,
  even,
  fpsOptions,
  frameCount,
  frameDurationUs,
  frameTimestampUs,
  isKeyFrame,
  keyFrameEvery,
  planExport,
  resolutionOptions,
  sanitizeFileName,
  scaledSize,
  videoBitrate,
} from '../plan';

describe('export plan math', () => {
  it('scales presets on the short side, keeps aspect, even dimensions', () => {
    expect(scaledSize(1080, 1920, 'project')).toEqual({ width: 1080, height: 1920 });
    expect(scaledSize(1080, 1920, 720)).toEqual({ width: 720, height: 1280 });
    expect(scaledSize(1920, 1080, 480)).toEqual({ width: 854, height: 480 });
    expect(scaledSize(1080, 1350, 480)).toEqual({ width: 480, height: 600 });
    const odd = scaledSize(1001, 777, 'project');
    expect(odd.width % 2).toBe(0);
    expect(odd.height % 2).toBe(0);
    for (const p of [480, 720, 1080] as const) {
      const s = scaledSize(2520, 1080, p);
      expect(s.width % 2 + (s.height % 2)).toBe(0);
    }
    expect(even(1)).toBe(2);
  });

  it('offers only downscaling presets', () => {
    const opts = resolutionOptions(1080, 1920).map((o) => o.value);
    expect(opts).toEqual(['project', 720, 480]);
    expect(resolutionOptions(3840, 2160).map((o) => o.value)).toEqual(['project', 1440, 1080, 720, 480]);
  });

  it('fps options include the project fps', () => {
    expect(fpsOptions(30)).toEqual([24, 25, 30, 60]);
    expect(fpsOptions(50)).toEqual([24, 25, 30, 50, 60]);
  });

  it('frame count covers the whole duration', () => {
    expect(frameCount(10, 30)).toBe(300);
    expect(frameCount(10.01, 30)).toBe(301);
    expect(frameCount(0.1, 30)).toBe(3);
    expect(frameCount(0, 30)).toBe(0);
    expect(frameCount(0.001, 30)).toBe(1);
  });

  it('timestamps/durations are microseconds without drift', () => {
    expect(frameTimestampUs(0, 30)).toBe(0);
    expect(frameTimestampUs(1, 30)).toBe(33333);
    expect(frameTimestampUs(2, 30)).toBe(66667);
    expect(frameTimestampUs(30, 30)).toBe(1_000_000);
    let sum = 0;
    for (let i = 0; i < 30 * 60; i++) sum += frameDurationUs(i, 30);
    expect(sum).toBe(60_000_000);
    expect(frameDurationUs(0, 25)).toBe(40000);
  });

  it('key frame every ~2 s', () => {
    expect(keyFrameEvery(30)).toBe(60);
    expect(keyFrameEvery(25)).toBe(50);
    expect(keyFrameEvery(60)).toBe(120);
    expect(isKeyFrame(0, 30)).toBe(true);
    expect(isKeyFrame(59, 30)).toBe(false);
    expect(isKeyFrame(60, 30)).toBe(true);
  });

  it('bitrate presets scale with pixels and fps, clamped', () => {
    expect(videoBitrate(1080, 1920, 30, 'medium')).toBe(Math.round(1080 * 1920 * 30 * 0.08));
    expect(videoBitrate(1080, 1920, 30, 'high')).toBeGreaterThan(videoBitrate(1080, 1920, 30, 'medium'));
    expect(videoBitrate(1080, 1920, 30, 'low')).toBeLessThan(videoBitrate(1080, 1920, 30, 'medium'));
    expect(videoBitrate(16, 16, 1, 'low')).toBe(MIN_VIDEO_BITRATE);
    expect(videoBitrate(7680, 4320, 60, 'high')).toBe(MAX_VIDEO_BITRATE);
    expect(AUDIO_BITRATE.medium).toBe(128000);
  });

  it('sanitizes file names', () => {
    expect(sanitizeFileName('My: video/clip?.mp4')).toBe('My_ video_clip_');
    expect(sanitizeFileName('   ')).toBe('export');
    expect(sanitizeFileName('a.webm')).toBe('a');
  });

  it('planExport combines everything (empty project = 0 frames)', () => {
    const p: Project = createProject({ fps: 30 });
    const empty = planExport(p, { fileName: 'x', resolution: 720, fps: 25, quality: 'medium', format: 'mp4' });
    expect(empty.frameCount).toBe(0);
    expect(empty).toMatchObject({ width: 720, height: 1280, fps: 25, keyFrameEvery: 50, sampleRate: 48000, channels: 2 });
  });
});
