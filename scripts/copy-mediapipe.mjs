/**
 * copy-mediapipe.mjs — put MediaPipe's vision WASM where the app serves it.
 *
 * The "text behind person" preview (src/lib/kinetic/segmenter.ts) loads the
 * MediaPipe runtime from this app's own origin — never a CDN — so the wasm
 * files have to be under public/. They are ~20 MB and change with the npm
 * package, so they are NOT committed: this copies them from node_modules on
 * every install (package.json "postinstall"), and public/mediapipe/wasm is
 * gitignored. The small .tflite model next to it IS committed.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, '..', 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const DEST = path.join(here, '..', 'public', 'mediapipe', 'wasm');

if (!existsSync(SRC)) {
  console.log('[mediapipe] @mediapipe/tasks-vision not installed; skipping wasm copy');
  process.exit(0);
}

mkdirSync(DEST, { recursive: true });
let n = 0;
for (const f of readdirSync(SRC)) {
  copyFileSync(path.join(SRC, f), path.join(DEST, f));
  n++;
}
console.log(`[mediapipe] copied ${n} wasm file(s) to public/mediapipe/wasm`);
