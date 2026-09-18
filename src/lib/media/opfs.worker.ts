/**
 * opfs.worker.ts — the one place that WRITES to the Origin Private File System.
 *
 * Writes go through a dedicated worker because `createSyncAccessHandle()` is
 * worker-only and is the one OPFS write API every browser we support has had
 * for years (Chrome 102, Firefox 111, Safari 15.2). The main-thread
 * `createWritable()` only reached Safari in 26. One code path, no feature
 * matrix. Reads happen on whichever thread needs them via `getFile()`.
 *
 * Protocol: one request → one final reply (`ok` / `error`), with optional
 * `progress` messages in between for long copies.
 */

import type { OpfsReply, OpfsRequest } from './opfsProtocol';

/** 8 MB slices: large enough to keep the copy fast, small enough to keep the
 *  worker's peak memory flat for a 1 GB source. */
const CHUNK = 8 * 1024 * 1024;

function post(msg: OpfsReply) {
  self.postMessage(msg);
}

function splitPath(path: string): { dirs: string[]; name: string } {
  const parts = path.split('/').filter(Boolean);
  const name = parts.pop();
  if (!name) throw new Error(`opfs: bad path "${path}"`);
  return { dirs: parts, name };
}

async function resolveDir(dirs: string[], create: boolean): Promise<FileSystemDirectoryHandle> {
  let dir = await navigator.storage.getDirectory();
  for (const part of dirs) dir = await dir.getDirectoryHandle(part, { create });
  return dir;
}

async function writeFile(id: number, path: string, blob: Blob): Promise<void> {
  const { dirs, name } = splitPath(path);
  const dir = await resolveDir(dirs, true);
  const fh = await dir.getFileHandle(name, { create: true });

  if (typeof fh.createSyncAccessHandle === 'function') {
    const handle = await fh.createSyncAccessHandle();
    try {
      handle.truncate(0);
      let offset = 0;
      while (offset < blob.size) {
        const slice = blob.slice(offset, Math.min(offset + CHUNK, blob.size));
        const buf = await slice.arrayBuffer();
        handle.write(buf, { at: offset });
        offset += buf.byteLength;
        post({ id, kind: 'progress', written: offset, total: blob.size });
      }
      handle.flush();
    } finally {
      handle.close();
    }
    return;
  }

  // Older engines without sync handles in workers: stream through the async
  // writable instead (this is the path Chrome/Firefox also accept).
  const writable = await fh.createWritable();
  try {
    await writable.write(blob);
  } finally {
    await writable.close();
  }
  post({ id, kind: 'progress', written: blob.size, total: blob.size });
}

async function removeFile(path: string): Promise<void> {
  const { dirs, name } = splitPath(path);
  try {
    const dir = await resolveDir(dirs, false);
    await dir.removeEntry(name);
  } catch (err) {
    // Already gone is the outcome we wanted.
    if ((err as DOMException)?.name !== 'NotFoundError') throw err;
  }
}

async function statFile(path: string): Promise<{ size: number; lastModified: number } | null> {
  const { dirs, name } = splitPath(path);
  try {
    const dir = await resolveDir(dirs, false);
    const fh = await dir.getFileHandle(name);
    const file = await fh.getFile();
    return { size: file.size, lastModified: file.lastModified };
  } catch (err) {
    if ((err as DOMException)?.name === 'NotFoundError') return null;
    throw err;
  }
}

async function listDir(path: string): Promise<string[]> {
  const dirs = path.split('/').filter(Boolean);
  try {
    const dir = await resolveDir(dirs, false);
    const names: string[] = [];
    // `keys()` is the async-iterable half of the directory handle.
    for await (const name of (dir as unknown as { keys(): AsyncIterable<string> }).keys()) {
      names.push(name);
    }
    return names;
  } catch (err) {
    if ((err as DOMException)?.name === 'NotFoundError') return [];
    throw err;
  }
}

self.onmessage = async (e: MessageEvent<OpfsRequest>) => {
  const req = e.data;
  try {
    let result: unknown;
    switch (req.op) {
      case 'write':
        await writeFile(req.id, req.path, req.blob);
        break;
      case 'remove':
        await removeFile(req.path);
        break;
      case 'stat':
        result = await statFile(req.path);
        break;
      case 'list':
        result = await listDir(req.path);
        break;
    }
    post({ id: req.id, kind: 'ok', result });
  } catch (err) {
    post({ id: req.id, kind: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
