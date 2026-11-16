/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

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
  plugins: [react()],
  server: { headers: isolationHeaders },
  preview: { headers: isolationHeaders },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
