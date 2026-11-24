/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { soundApi } from './server/soundApi';

/**
 * Cross-origin isolation headers: required for SharedArrayBuffer (worker/WASM
 * based export). Consequence: every resource the page loads must be same-origin
 * (or served with CORP/CORS headers). Do NOT load fonts/scripts from CDNs.
 * blob: and data: URLs (imported media, thumbnails) are unaffected.
 */
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  plugins: [react(), soundApi()],
  server: { headers: isolationHeaders },
  preview: { headers: isolationHeaders },
  // Pre-bundle the Whisper worker's dependency up front: otherwise Vite discovers it the first time
  // the worker starts and reloads the page mid-transcription.
  optimizeDeps: { include: ['@huggingface/transformers'] },
  worker: { format: 'es' },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
