// Tiny static server for the packaged app: serves dist/ with the cross-origin-isolation
// headers the editor needs (SharedArrayBuffer / WebCodecs / onnx) and mounts the sound API.
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
};

const ISOLATION = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

async function fileInfo(p) {
  try {
    const s = await stat(p);
    return s.isFile() ? s : null;
  } catch {
    return null;
  }
}

export function createAppServer({ root, middleware }) {
  const serveStatic = async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let rel;
    try {
      rel = decodeURIComponent(url.pathname);
    } catch {
      res.statusCode = 400;
      return void res.end();
    }
    let file = normalize(join(root, rel));
    if (file !== root && !file.startsWith(root + sep)) {
      res.statusCode = 403;
      return void res.end();
    }
    let info = await fileInfo(file);
    if (!info && !extname(rel)) {
      // SPA fallback (only for extension-less paths; missing assets stay 404).
      file = join(root, 'index.html');
      info = await fileInfo(file);
    }
    if (!info) {
      res.statusCode = 404;
      return void res.end('Not found');
    }
    const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
    res.setHeader('Content-Type', type);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', file.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600');
    let start = 0;
    let end = info.size - 1;
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
    if (m && (m[1] || m[2])) {
      if (m[1]) {
        start = Number(m[1]);
        if (m[2]) end = Math.min(Number(m[2]), end);
      } else {
        start = Math.max(0, info.size - Number(m[2]));
      }
      if (start > end || start >= info.size) {
        res.statusCode = 416;
        res.setHeader('Content-Range', `bytes */${info.size}`);
        return void res.end();
      }
      res.statusCode = 206;
      res.setHeader('Content-Range', `bytes ${start}-${end}/${info.size}`);
    }
    res.setHeader('Content-Length', String(end - start + 1));
    if (req.method === 'HEAD') return void res.end();
    const rs = createReadStream(file, { start, end });
    rs.on('error', () => res.destroy());
    res.on('close', () => rs.destroy());
    rs.pipe(res);
  };

  return createServer((req, res) => {
    for (const [k, v] of Object.entries(ISOLATION)) res.setHeader(k, v);
    const fallthrough = () => void serveStatic(req, res).catch(() => {
      res.statusCode = 500;
      res.end();
    });
    if (middleware) middleware(req, res, fallthrough);
    else fallthrough();
  });
}

/** Listens on `port`; if busy, tries the next ports. Resolves with { server, port }. */
export async function listenOnFirstFree(server, host, firstPort, attempts = 10) {
  for (let i = 0; i < attempts; i++) {
    const port = firstPort + i;
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.off('error', reject);
          resolve();
        });
      });
      return { server, port };
    } catch (e) {
      if (e?.code !== 'EADDRINUSE') throw e;
    }
  }
  throw new Error(`No free port in ${firstPort}-${firstPort + attempts - 1}`);
}
