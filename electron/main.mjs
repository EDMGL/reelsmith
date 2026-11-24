// ErdemCut desktop shell. Serves dist/ from a local HTTP server on a FIXED origin
// (http://127.0.0.1:47821) so IndexedDB/OPFS data (projects, proxies) survives restarts.
import { app, BrowserWindow, desktopCapturer, session, shell } from 'electron';
import { createRequire } from 'node:module';
import { chmod, mkdir, rename, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAppServer, listenOnFirstFree } from './server.mjs';
import { createSoundMiddleware, findBin } from '../server/soundApi';

const HOST = '127.0.0.1';
const BASE_PORT = Number(process.env.ERDEMCUT_PORT) || 47821;
const here = dirname(fileURLToPath(import.meta.url));
const req = createRequire(import.meta.url);

// ---- tools ---------------------------------------------------------------

function bundledFfmpeg() {
  try {
    const p = req('ffmpeg-static');
    // Packaged: the binary lives outside the asar archive.
    return typeof p === 'string' ? p.replace('app.asar', 'app.asar.unpacked') : null;
  } catch {
    return null;
  }
}

const YTDLP_FILE = process.platform === 'win32' ? 'yt-dlp.exe' : process.platform === 'darwin' ? 'yt-dlp_macos' : 'yt-dlp';
const ytdlpLocal = () => join(app.getPath('userData'), 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
let ytdlpDownload = null;

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function ensureYtdlp() {
  ytdlpDownload ??= (async () => {
    const dest = ytdlpLocal();
    if (await exists(dest)) return dest;
    await mkdir(dirname(dest), { recursive: true });
    const r = await fetch(`https://github.com/yt-dlp/yt-dlp/releases/latest/download/${YTDLP_FILE}`, { redirect: 'follow' });
    if (!r.ok) throw new Error(`download failed (${r.status})`);
    const tmp = `${dest}.part`;
    await writeFile(tmp, Buffer.from(await r.arrayBuffer()));
    if (process.platform !== 'win32') await chmod(tmp, 0o755);
    await rename(tmp, dest);
    return dest;
  })().catch((e) => {
    ytdlpDownload = null; // retry next time
    throw e;
  });
  return ytdlpDownload;
}

async function resolveTools(ensure) {
  const ffmpeg = findBin('ffmpeg') ?? bundledFfmpeg();
  let ytdlp = findBin('yt-dlp');
  if (!ytdlp) {
    const local = ytdlpLocal();
    if (await exists(local)) ytdlp = local;
    else if (ensure) ytdlp = await ensureYtdlp();
  }
  return { ytdlp, ffmpeg };
}

// ---- window --------------------------------------------------------------

let win = null;

async function start() {
  const root = join(here, '..', 'dist');
  const middleware = createSoundMiddleware({ resolveTools, desktop: true, ytdlpOnDemand: () => true });
  const { port } = await listenOnFirstFree(createAppServer({ root, middleware }), HOST, BASE_PORT);
  const origin = `http://${HOST}:${port}`;
  if (port !== BASE_PORT) console.warn(`Port ${BASE_PORT} busy; using ${port}. Saved projects live per origin and will not be visible here.`);
  console.log(`ErdemCut listening on ${origin}`);

  const ses = session.defaultSession;
  const allowed = new Set(['media', 'display-capture', 'fileSystem', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen', 'persistent-storage', 'unlimited-storage']);
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
  ses.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
        const screen = sources.find((s) => s.id.startsWith('screen')) ?? sources[0];
        if (!screen) return callback({});
        callback(process.platform === 'win32' ? { video: screen, audio: 'loopback' } : { video: screen });
      } catch {
        callback({});
      }
    },
    { useSystemPicker: true },
  );

  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#111114',
    title: 'ErdemCut',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(origin)) {
      e.preventDefault();
      if (/^https?:/i.test(url)) void shell.openExternal(url);
    }
  });
  win.on('closed', () => (win = null));
  await win.loadURL(origin);

  // Warm up yt-dlp in the background so the first search is instant.
  if (!findBin('yt-dlp')) void ensureYtdlp().catch((e) => console.warn('yt-dlp download:', e.message));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(start).catch((e) => {
    console.error(e);
    app.quit();
  });
  app.on('window-all-closed', () => app.quit());
}
