// Bundles electron/main.mjs (+ server/soundApi.ts) into dist-electron/ (Electron main process).
import { build } from 'esbuild';
await build({
  entryPoints: ['electron/main.mjs'],
  outfile: 'dist-electron/main.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['electron', 'ffmpeg-static'],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
