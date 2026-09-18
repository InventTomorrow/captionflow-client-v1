import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// The proxy target comes from the same VITE_API_URL the app itself uses, so the
// two can never disagree — they did, and a request that silently reached a
// DIFFERENT project's dev server on the shared port looked exactly like a
// database outage.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.VITE_API_URL || 'http://localhost:4610';
  return {
    plugins: [react()],
    // Workers are bundled as ES modules so they share chunks with the app
    // (mediabunny, the kinetic engine) instead of inlining a copy of each.
    worker: { format: 'es' },
    // Libraries reached only from Web Workers or lazy imports are invisible to
    // Vite's startup scan. Without this, the first upload (audio worker) makes
    // the dev server discover them, re-bundle and force-reload the page —
    // mid-upload, which lands the user back on the upload page.
    optimizeDeps: {
      entries: ['index.html', 'src/**/*.worker.ts'],
      include: ['mediabunny', '@mediabunny/aac-encoder', '@mediapipe/tasks-vision', 'idb'],
    },
    server: {
      port: 5610,
      proxy: {
        '/api': {
          target,
          changeOrigin: true,
        },
      },
    },
  };
});
