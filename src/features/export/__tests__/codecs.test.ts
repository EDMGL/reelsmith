import { describe, expect, it } from 'vitest';
import { avcCodecString, avcLevel, selectCodecs, vp9CodecString, type CodecSupportApi } from '../codecs';

const req = {
  width: 1080,
  height: 1920,
  fps: 30,
  videoBitrate: 5_000_000,
  audioBitrate: 128_000,
  sampleRate: 48000,
  channels: 2,
  preferred: 'mp4' as const,
};

function api(supported: { video: string[]; audio: string[] }): CodecSupportApi & { seen: string[] } {
  const seen: string[] = [];
  return {
    seen,
    async video(c) {
      seen.push(c.codec);
      return supported.video.some((p) => c.codec.startsWith(p));
    },
    async audio(c) {
      seen.push(c.codec);
      return supported.audio.some((p) => c.codec.startsWith(p));
    },
  };
}

describe('codec strings', () => {
  it('picks the smallest sufficient H.264 level', () => {
    expect(avcLevel(1080, 1920, 30)).toBe(40);
    expect(avcLevel(1920, 1080, 60)).toBe(42);
    expect(avcLevel(1280, 720, 30)).toBe(31);
    expect(avcLevel(3840, 2160, 30)).toBe(51);
    expect(avcCodecString('high', 1080, 1920, 30)).toBe('avc1.640028');
    expect(avcCodecString('baseline', 1280, 720, 30)).toBe('avc1.42001f');
  });
  it('VP9 string', () => {
    expect(vp9CodecString(1920, 1080, 30)).toBe('vp09.00.40.08');
    expect(vp9CodecString(1280, 720, 60)).toBe('vp09.00.40.08');
  });
});

describe('selectCodecs fallback', () => {
  it('MP4 H.264 + AAC when everything is supported', async () => {
    const c = await selectCodecs(req, api({ video: ['avc1', 'vp09', 'vp8'], audio: ['mp4a', 'opus'] }));
    expect(c.container).toBe('mp4');
    expect(c.video.codec).toBe('avc');
    expect(c.video.config.codec).toBe('avc1.640028');
    expect(c.video.config).toMatchObject({ width: 1080, height: 1920, bitrate: 5_000_000, framerate: 30, avc: { format: 'avc' } });
    expect(c.audio?.codec).toBe('aac');
    expect(c.audio?.config).toMatchObject({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 });
    expect(c.extension).toBe('.mp4');
    expect(c.fallbackNote).toBeNull();
  });

  it('falls back to a lower H.264 profile', async () => {
    const c = await selectCodecs(req, api({ video: ['avc1.4200'], audio: ['mp4a'] }));
    expect(c.video.config.codec).toBe('avc1.420028');
    expect(c.fallbackNote).toBeNull();
  });

  it('MP4 with Opus when AAC encoding is unavailable', async () => {
    const c = await selectCodecs(req, api({ video: ['avc1', 'vp09'], audio: ['opus'] }));
    expect(c.container).toBe('mp4');
    expect(c.audio?.codec).toBe('opus');
    expect(c.label).toBe('MP4 (H.264 + Opus)');
    expect(c.fallbackNote).toMatch(/AAC audio encoding is not available/);
  });

  it('WebM VP9 + Opus when H.264 is unavailable', async () => {
    const c = await selectCodecs(req, api({ video: ['vp09', 'vp8'], audio: ['opus'] }));
    expect(c.container).toBe('webm');
    expect(c.video.codec).toBe('vp9');
    expect(c.extension).toBe('.webm');
    expect(c.mimeType).toBe('video/webm');
    expect(c.fallbackNote).toMatch(/Using WebM \(VP9 \+ Opus\) instead of MP4/);
  });

  it('WebM VP8 when VP9 is unavailable', async () => {
    const c = await selectCodecs({ ...req, preferred: 'webm' }, api({ video: ['vp8'], audio: ['opus'] }));
    expect(c.video.codec).toBe('vp8');
    expect(c.fallbackNote).toMatch(/VP9 encoding is not available/);
  });

  it('prefers WebM when asked', async () => {
    const c = await selectCodecs({ ...req, preferred: 'webm' }, api({ video: ['avc1', 'vp09'], audio: ['mp4a', 'opus'] }));
    expect(c.label).toBe('WebM (VP9 + Opus)');
    expect(c.fallbackNote).toBeNull();
  });

  it('prefers a container with audio; else video-only with a warning', async () => {
    // H.264 works but no audio encoder in MP4 terms and none at all -> MP4 video only.
    const c = await selectCodecs(req, api({ video: ['avc1'], audio: [] }));
    expect(c.container).toBe('mp4');
    expect(c.audio).toBeNull();
    expect(c.fallbackNote).toMatch(/NO sound/);
  });

  it('throws a readable error when no video encoder works', async () => {
    await expect(selectCodecs(req, api({ video: [], audio: ['opus'] }))).rejects.toThrow(/video encoding|cannot encode/);
  });
});

describe('hardware encoding preference', () => {
  it('uses prefer-hardware when supported', async () => {
    const configs: VideoEncoderConfig[] = [];
    const a: CodecSupportApi = {
      async video(c) {
        configs.push(c);
        return true;
      },
      async audio() {
        return true;
      },
    };
    const c = await selectCodecs(req, a);
    expect(c.video.config.hardwareAcceleration).toBe('prefer-hardware');
    expect(c.video.config.latencyMode).toBe('quality');
    expect(configs).toHaveLength(1);
  });
  it('falls back to the same config without a preference', async () => {
    const a: CodecSupportApi = {
      async video(c) {
        return c.hardwareAcceleration === undefined;
      },
      async audio() {
        return true;
      },
    };
    const c = await selectCodecs(req, a);
    expect(c.video.codec).toBe('avc');
    expect(c.video.config.codec).toBe('avc1.640028');
    expect(c.video.config.hardwareAcceleration).toBeUndefined();
  });
});
