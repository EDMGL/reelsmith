/**
 * Local "Find sound" API (Vite dev/preview middleware): searches YouTube and
 * extracts a video's audio as MP3 with yt-dlp + ffmpeg on THIS machine. The
 * browser cannot fetch YouTube itself (CORS), so the dev server does it.
 *
 *   GET /api/sound/status            -> { ytdlp: boolean, ffmpeg: boolean }
 *   GET /api/sound/search?q=...      -> [{ id, title, channel, duration, thumbnail }]
 *   GET /api/sound/audio?id=<11 ch>  -> audio/mpeg (cached in the OS temp dir)
 *   GET /api/sound/stream?id=<11 ch> -> the original audio stream, proxied with
 *     Range support, for instant previews (no download / conversion first).
 *     Search results' stream URLs are resolved ahead of time.
 *   GET /api/sound/prepare?id=       -> 204; resolves a stream URL in the background (hover)
 *   GET /api/sound/thumb?id=<11 ch>  -> the video thumbnail, served same-origin
 *     (the app is cross-origin isolated, so it cannot load i.ytimg.com directly)
 *
 * Processes are spawned with argument arrays (no shell); ids are validated.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

const ID_RE = /^[A-Za-z0-9_-]{11}$/;
const MAX_RESULTS = 12;
/** Longer videos are refused (an hour-long mix is not a soundtrack). */
const MAX_SECONDS = 20 * 60;
const CACHE_DIR = join(tmpdir(), 'erdemcut-sounds');
const EXTRA_PATHS = ['/opt/homebrew/bin', '/usr/local/bin'];

function findBin(name: string): string | null {
  for (const dir of [...(process.env.PATH ?? '').split(':'), ...EXTRA_PATHS]) {
    if (dir && existsSync(join(dir, name))) return join(dir, name);
  }
  return null;
}

function run(bin: string, args: string[], timeoutMs: number): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const env = { ...process.env, PATH: [...EXTRA_PATHS, process.env.PATH ?? ''].join(':') };
    const p = spawn(bin, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    const timer = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, out, err });
    });
    p.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: -1, out, err: String(e) });
    });
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function lastLine(s: string): string {
  return s.trim().split('\n').filter(Boolean).pop()?.replace(/^ERROR:\s*/, '') ?? 'unknown error';
}

export interface SoundResult {
  id: string;
  title: string;
  channel: string;
  duration: number | null;
  thumbnail: string | null;
}

export function parseSearch(out: string): SoundResult[] {
  const results: SoundResult[] = [];
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    try {
      const j = JSON.parse(line) as Record<string, unknown>;
      const id = String(j.id ?? '');
      if (!ID_RE.test(id)) continue;
      const duration = typeof j.duration === 'number' ? j.duration : null;
      // Live streams / 24-7 radios and long mixes cannot become a soundtrack.
      if (j.live_status === 'is_live' || j.live_status === 'is_upcoming' || duration === null || duration > MAX_SECONDS) continue;
      const thumbs = Array.isArray(j.thumbnails) ? (j.thumbnails as { url?: string }[]) : [];
      results.push({
        id,
        title: String(j.title ?? id),
        channel: String(j.channel ?? j.uploader ?? ''),
        duration,
        thumbnail: thumbs.length ? `/api/sound/thumb?id=${id}` : null,
      });
    } catch {
      /* not a JSON line */
    }
  }
  return results.slice(0, MAX_RESULTS);
}

async function search(res: ServerResponse, q: string, ytdlp: string): Promise<void> {
  const query = q.trim().slice(0, 120);
  if (!query) return json(res, 400, { error: 'Empty search' });
  const r = await run(ytdlp, ['--flat-playlist', '--dump-json', '--no-warnings', '--', `ytsearch${MAX_RESULTS * 3}:${query}`], 30_000);
  if (r.code !== 0) return json(res, 502, { error: `Search failed: ${lastLine(r.err)}` });
  const results = parseSearch(r.out);
  json(res, 200, results);
  // The first previews start instantly when their stream URL is already known.
  for (const x of results.slice(0, PREFETCH)) void resolveStream(x.id, ytdlp).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Preview streaming
// ---------------------------------------------------------------------------

/** How many top results get their stream URL resolved right after a search. */
const PREFETCH = 4;
/** googlevideo URLs live ~6 h; re-resolve well before. */
const STREAM_TTL_MS = 60 * 60_000;
const streams = new Map<string, { url: string; at: number }>();
const resolving = new Map<string, Promise<string>>();

function resolveStream(id: string, ytdlp: string): Promise<string> {
  const have = streams.get(id);
  if (have && Date.now() - have.at < STREAM_TTL_MS) return Promise.resolve(have.url);
  let p = resolving.get(id);
  if (!p) {
    p = (async () => {
      const r = await run(ytdlp, ['-g', '-f', 'bestaudio[ext=m4a]/bestaudio', '--no-playlist', '--no-warnings', '--', `https://www.youtube.com/watch?v=${id}`], 30_000);
      const url = r.out.split('\n').find((l) => l.startsWith('https://'));
      if (!url) throw new Error(`Could not open the audio: ${lastLine(r.err)}`);
      streams.set(id, { url: url.trim(), at: Date.now() });
      if (streams.size > 200) streams.delete(streams.keys().next().value!);
      return url.trim();
    })().finally(() => resolving.delete(id));
    resolving.set(id, p);
  }
  return p;
}

const PASS_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges'];

async function stream(req: IncomingMessage, res: ServerResponse, id: string, ytdlp: string): Promise<void> {
  if (!ID_RE.test(id)) return json(res, 400, { error: 'Bad video id' });
  const ctl = new AbortController();
  res.on('close', () => ctl.abort());
  const headers: Record<string, string> = {};
  if (typeof req.headers.range === 'string') headers.range = req.headers.range;
  try {
    let upstream = await fetch(await resolveStream(id, ytdlp), { headers, signal: ctl.signal });
    if (upstream.status === 403 || upstream.status === 410) {
      // Expired / bound URL: resolve again once.
      streams.delete(id);
      upstream = await fetch(await resolveStream(id, ytdlp), { headers, signal: ctl.signal });
    }
    if (!upstream.ok || !upstream.body) return json(res, 502, { error: `Audio stream failed (${upstream.status})` });
    res.statusCode = upstream.status;
    for (const h of PASS_HEADERS) {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    Readable.fromWeb(upstream.body as never).on('error', () => res.destroy()).pipe(res);
  } catch (e) {
    if (!ctl.signal.aborted) json(res, 502, { error: e instanceof Error ? e.message : String(e) });
  }
}

const inflight = new Map<string, Promise<string>>();

async function cachedFile(id: string): Promise<string | null> {
  const f = join(CACHE_DIR, `${id}.mp3`);
  try {
    return (await stat(f)).size > 0 ? f : null;
  } catch {
    return null;
  }
}

async function download(id: string, ytdlp: string, ffmpegDir: string): Promise<string> {
  const have = await cachedFile(id);
  if (have) return have;
  await mkdir(CACHE_DIR, { recursive: true });
  const r = await run(
    ytdlp,
    [
      '--no-playlist',
      '--no-warnings',
      '-f',
      'bestaudio/best',
      '-x',
      '--audio-format',
      'mp3',
      '--audio-quality',
      '2',
      '--match-filter',
      `duration <= ${MAX_SECONDS}`,
      '--ffmpeg-location',
      ffmpegDir,
      '-o',
      join(CACHE_DIR, '%(id)s.%(ext)s'),
      '--',
      `https://www.youtube.com/watch?v=${id}`,
    ],
    5 * 60_000,
  );
  const file = await cachedFile(id);
  if (!file) {
    const skipped = /does not pass filter/i.test(r.out + r.err);
    throw new Error(skipped ? `Videos longer than ${MAX_SECONDS / 60} minutes are not supported.` : `Download failed: ${lastLine(r.err)}`);
  }
  return file;
}

async function audio(res: ServerResponse, id: string, ytdlp: string, ffmpeg: string): Promise<void> {
  if (!ID_RE.test(id)) return json(res, 400, { error: 'Bad video id' });
  let p = inflight.get(id);
  if (!p) {
    p = download(id, ytdlp, join(ffmpeg, '..')).finally(() => inflight.delete(id));
    inflight.set(id, p);
  }
  try {
    const data = await readFile(await p);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', String(data.length));
    // Same-origin isolation (COEP) is satisfied: this is our own origin.
    res.end(data);
  } catch (e) {
    json(res, 502, { error: e instanceof Error ? e.message : String(e) });
  }
}

async function thumb(res: ServerResponse, id: string): Promise<void> {
  if (!ID_RE.test(id)) return json(res, 400, { error: 'Bad video id' });
  try {
    const r = await fetch(`https://i.ytimg.com/vi/${id}/mqdefault.jpg`);
    if (!r.ok) return json(res, 404, { error: 'No thumbnail' });
    const data = Buffer.from(await r.arrayBuffer());
    res.statusCode = 200;
    res.setHeader('Content-Type', r.headers.get('content-type') ?? 'image/jpeg');
    res.setHeader('Cache-Control', 'max-age=86400');
    res.end(data);
  } catch {
    json(res, 502, { error: 'Thumbnail unavailable' });
  }
}

async function handle(req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (!url.pathname.startsWith('/api/sound/')) return next();
  const ytdlp = findBin('yt-dlp');
  const ffmpeg = findBin('ffmpeg');
  const route = url.pathname.slice('/api/sound/'.length);
  if (route === 'thumb') return thumb(res, url.searchParams.get('id') ?? '');
  if (route === 'status') return json(res, 200, { ytdlp: !!ytdlp, ffmpeg: !!ffmpeg });
  if (!ytdlp || !ffmpeg) return json(res, 503, { error: 'yt-dlp and ffmpeg are needed: brew install yt-dlp ffmpeg' });
  if (route === 'search') return search(res, url.searchParams.get('q') ?? '', ytdlp);
  if (route === 'audio') return audio(res, url.searchParams.get('id') ?? '', ytdlp, ffmpeg);
  if (route === 'stream') return stream(req, res, url.searchParams.get('id') ?? '', ytdlp);
  if (route === 'prepare') {
    // Hover hint: resolve the stream URL now so the preview starts at once.
    const id = url.searchParams.get('id') ?? '';
    if (ID_RE.test(id)) void resolveStream(id, ytdlp).catch(() => undefined);
    res.statusCode = 204;
    return void res.end();
  }
  json(res, 404, { error: 'Unknown route' });
}

export function soundApi(): Plugin {
  // Must return nothing: a function returned from configureServer is run as a post-middleware hook.
  const mount = (server: { middlewares: { use: (fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => unknown } }): void => {
    server.middlewares.use((req, res, next) => void handle(req, res, next).catch((e) => json(res, 500, { error: String(e) })));
  };
  return { name: 'erdemcut-sound-api', configureServer: mount, configurePreviewServer: mount };
}
