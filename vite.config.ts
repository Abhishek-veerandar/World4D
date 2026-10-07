import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative asset paths, so the same build works at a domain root (Vercel,
  // Netlify), under a sub-path (GitHub Pages: /World4D/) or from any folder.
  base: './',
  // The history loader runs as an ES-module Web Worker (src/lib/history.worker.ts).
  worker: { format: 'es' },
});
