import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // The history loader runs as an ES-module Web Worker (src/lib/history.worker.ts).
  worker: { format: 'es' },
});
