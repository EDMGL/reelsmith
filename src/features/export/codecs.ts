/**
 * Codec capability detection and fallback selection.
 *
 * Preference (format MP4 chosen):  MP4 H.264+AAC -> MP4 H.264+Opus -> WebM VP9+Opus -> WebM VP8+Opus
 * Preference (format WebM chosen): WebM VP9+Opus -> WebM VP8+Opus -> MP4 H.264+AAC -> MP4 H.264+Opus
 * A container is only chosen with audio if one of its audio codecs encodes; if
 * no container has a working audio encoder the first container with a working
 * video encoder is used WITHOUT audio (reported to the user).
 */
import type { FormatPreference } from './plan';

export type Container = 'mp4' | 'webm';
/** Codec ids as understood by the muxer (mediabunny names). */
export type VideoCodecId = 'avc' | 'vp9' | 'vp8';
export type AudioCodecId = 'aac' | 'opus';

export interface VideoCandidate {
  codec: VideoCodecId;
  label: string;
  config: VideoEncoderConfig;
}
export interface AudioCandidate {
  codec: AudioCodecId;
  label: string;
  config: AudioEncoderConfig;
}

export interface CodecChoice {
  container: Container;
  video: VideoCandidate;
  audio: AudioCandidate | null;
  /** e.g. "MP4 (H.264 + AAC)". */
  label: string;
  extension: '.mp4' | '.webm';
  mimeType: 'video/mp4' | 'video/webm';
  /** Human-readable explanation when this is not the requested/ideal combination, else null. */
  fallbackNote: string | null;
}

export interface CodecSupportApi {
  video(config: VideoEncoderConfig): Promise<boolean>;
  audio(config: AudioEncoderConfig): Promise<boolean>;
}

export interface CodecRequest {
  width: number;
  height: number;
  fps: number;
  videoBitrate: number;
  audioBitrate: number;
  sampleRate: number;
  channels: number;
  preferred: FormatPreference;
}

/** WebCodecs-backed support checks (false when WebCodecs is missing or the check throws). */
export const browserCodecSupport: CodecSupportApi = {
  async video(config) {
    if (typeof VideoEncoder === 'undefined') return false;
    try {
      return !!(await VideoEncoder.isConfigSupported(config)).supported;
    } catch {
      return false;
    }
  },
  async audio(config) {
    if (typeof AudioEncoder === 'undefined') return false;
    try {
      return !!(await AudioEncoder.isConfigSupported(config)).supported;
    } catch {
      return false;
    }
  },
};

const AVC_LEVELS: readonly [idc: number, maxFs: number, maxMbps: number][] = [
  [30, 1620, 40500],
  [31, 3600, 108000],
  [32, 5120, 216000],
  [40, 8192, 245760],
  [42, 8704, 522240],
  [50, 22080, 589824],
  [51, 36864, 983040],
  [52, 36864, 2073600],
  [60, 139264, 4177920],
];

/** Smallest H.264 level that fits the frame size and macroblock rate. */
export function avcLevel(width: number, height: number, fps: number): number {
  const mbw = Math.ceil(width / 16);
  const mbh = Math.ceil(height / 16);
  const fs = mbw * mbh;
  const mbps = fs * fps;
  for (const [idc, maxFs, maxMbps] of AVC_LEVELS) {
    const maxDim = Math.sqrt(8 * maxFs);
    if (fs <= maxFs && mbps <= maxMbps && mbw <= maxDim && mbh <= maxDim) return idc;
  }
  return 62;
}

/** e.g. avcCodecString('high', 1080, 1920, 30) = "avc1.640028". */
export function avcCodecString(profile: 'high' | 'main' | 'baseline', width: number, height: number, fps: number): string {
  const p = { high: '6400', main: '4d00', baseline: '4200' }[profile];
  return `avc1.${p}${avcLevel(width, height, fps).toString(16).padStart(2, '0')}`;
}

/** VP9 profile 0, 8-bit, level from the picture size / frame rate. */
export function vp9CodecString(width: number, height: number, fps: number): string {
  const px = width * height;
  const hi = fps > 30;
  let level: string;
  if (px <= 245760) level = '21';
  else if (px <= 552960) level = '30';
  else if (px <= 983040) level = hi ? '40' : '31';
  else if (px <= 2228224) level = hi ? '41' : '40';
  else if (px <= 8912896) level = hi ? '51' : '50';
  else level = hi ? '61' : '60';
  return `vp09.00.${level}.08`;
}

function videoCandidates(container: Container, r: CodecRequest): VideoCandidate[] {
  const base = {
    width: r.width,
    height: r.height,
    bitrate: r.videoBitrate,
    framerate: r.fps,
    latencyMode: 'quality' as const,
    bitrateMode: 'variable' as const,
  };
  if (container === 'mp4') {
    return (['high', 'main', 'baseline'] as const).map((profile) => ({
      codec: 'avc' as const,
      label: 'H.264',
      config: { ...base, codec: avcCodecString(profile, r.width, r.height, r.fps), avc: { format: 'avc' as const } },
    }));
  }
  return [
    { codec: 'vp9', label: 'VP9', config: { ...base, codec: vp9CodecString(r.width, r.height, r.fps) } },
    { codec: 'vp8', label: 'VP8', config: { ...base, codec: 'vp8' } },
  ];
}

function audioCandidates(container: Container, r: CodecRequest): AudioCandidate[] {
  const base = { sampleRate: r.sampleRate, numberOfChannels: r.channels, bitrate: r.audioBitrate };
  const opus: AudioCandidate = { codec: 'opus', label: 'Opus', config: { ...base, codec: 'opus' } };
  if (container === 'mp4') return [{ codec: 'aac', label: 'AAC', config: { ...base, codec: 'mp4a.40.2' } }, opus];
  return [opus];
}

async function firstSupported<T extends { config: unknown }>(list: T[], check: (c: T['config']) => Promise<boolean>): Promise<T | null> {
  for (const c of list) if (await check(c.config)) return c;
  return null;
}

function describe(container: Container, video: VideoCandidate, audio: AudioCandidate | null): string {
  return `${container === 'mp4' ? 'MP4' : 'WebM'} (${video.label}${audio ? ` + ${audio.label}` : ', no audio'})`;
}

/**
 * Picks the best supported container/codec combination, or throws a readable
 * error when this browser cannot encode video at all.
 */
export async function selectCodecs(r: CodecRequest, api: CodecSupportApi = browserCodecSupport): Promise<CodecChoice> {
  const order: Container[] = r.preferred === 'mp4' ? ['mp4', 'webm'] : ['webm', 'mp4'];
  const options: { container: Container; video: VideoCandidate; audio: AudioCandidate | null }[] = [];
  for (const container of order) {
    const video = await firstSupported(videoCandidates(container, r), (c) => api.video(c));
    if (!video) continue;
    const audio = await firstSupported(audioCandidates(container, r), (c) => api.audio(c));
    options.push({ container, video, audio });
    if (audio) break;
  }
  if (options.length === 0) {
    throw new Error(
      typeof VideoEncoder === 'undefined'
        ? 'This browser does not support video encoding (WebCodecs VideoEncoder is unavailable). Try a recent Chrome, Edge or Safari.'
        : `This browser cannot encode ${r.width}×${r.height} video with H.264, VP9 or VP8. Try a lower resolution.`,
    );
  }
  const pick = options.find((o) => o.audio) ?? options[0]!;
  const ideal = r.preferred === 'mp4' ? 'MP4 (H.264 + AAC)' : 'WebM (VP9 + Opus)';
  const label = describe(pick.container, pick.video, pick.audio);
  let fallbackNote: string | null = null;
  if (label !== ideal) {
    const reasons: string[] = [];
    if (pick.container !== r.preferred) {
      reasons.push(
        r.preferred === 'mp4'
          ? 'H.264 video (or a matching audio encoder) is not available in this browser'
          : 'VP9/VP8 video (or Opus audio) is not available in this browser',
      );
    } else if (pick.container === 'mp4' && pick.audio?.codec === 'opus') {
      reasons.push('AAC audio encoding is not available in this browser');
    } else if (pick.video.codec === 'vp8') {
      reasons.push('VP9 encoding is not available in this browser');
    }
    if (!pick.audio) reasons.push('no audio encoder is available, the file will have NO sound');
    fallbackNote = `Using ${label} instead of ${ideal}${reasons.length ? `: ${reasons.join('; ')}` : ''}.`;
  }
  return {
    container: pick.container,
    video: pick.video,
    audio: pick.audio,
    label,
    extension: pick.container === 'mp4' ? '.mp4' : '.webm',
    mimeType: pick.container === 'mp4' ? 'video/mp4' : 'video/webm',
    fallbackNote,
  };
}
