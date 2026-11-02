/**
 * localMedia.ts — the device-side media store.
 *
 * Video never needs to leave the device for the browser to caption it: the
 * source file lives in the Origin Private File System (OPFS) under
 * `sources/<projectId>.<ext>`, exported renders under `exports/<id>.<ext>`,
 * and a small IndexedDB database (`captionflow-media`, separate from the
 * captions DB in captionDb.ts so their schema versions never collide) keeps
 * the metadata the UI lists. Nothing here talks to the server.
 *
 * Writes go through opfs.worker.ts (see the note there about Safari); reads
 * use `getFile()` on the main thread, which every browser supports.
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { MediaProbe } from './probe';
import type { OpfsReply, OpfsRequest } from './opfsProtocol';

export interface LocalSourceRecord {
  projectId: string;
  /** Original file name, size, MIME and mtime — lets us recognise the same file later. */
  name: string;
  size: number;
  type: string;
  lastModified: number;
  opfsPath: string;
  storedAt: number;
  probe: MediaProbe | null;
}

export interface LocalExportRecord {
  id: string;
  projectId: string;
  title: string;
  template: string;
  quality: string;
  format: string;
  width: number;
  height: number;
  /** Seconds. */
  duration: number;
  exportedAt: number;
  /** Small JPEG data URL, ~5–20 KB. */
  thumbnailDataUrl: string;
  fileSize: number;
  opfsPath: string;
  /** Caption language label for the card, e.g. "Urdu + English". */
  language?: string;
  /** File name of the last download and when it happened. */
  downloadedAs?: string;
  downloadedAt?: number;
  /** Set when this export is a rendered Clips clip. */
  clipId?: string;
}

/**
 * One part of a video that came from a pasted link — the only piece of it this
 * device ever stores: a clip's range, cut by the server (sources/<projectId>~…).
 */
export interface LocalSegmentRecord {
  /** `${projectId}:${start}:${end}` */
  key: string;
  projectId: string;
  /** Source seconds at the file's 0:00, and where it ends. */
  start: number;
  end: number;
  size: number;
  opfsPath: string;
  storedAt: number;
  probe: MediaProbe | null;
}

interface MediaDbSchema extends DBSchema {
  sources: { key: string; value: LocalSourceRecord };
  exports: {
    key: string;
    value: LocalExportRecord;
    indexes: { 'by-exportedAt': number; 'by-project': string };
  };
  segments: { key: string; value: LocalSegmentRecord; indexes: { 'by-project': string } };
}

const DB_NAME = 'captionflow-media';
const DB_VERSION = 2;
/** Parts kept per video; the oldest go first (each is a few MB). */
const MAX_SEGMENTS_PER_PROJECT = 24;

let dbPromise: Promise<IDBPDatabase<MediaDbSchema>> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<MediaDbSchema>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore('sources', { keyPath: 'projectId' });
          const ex = db.createObjectStore('exports', { keyPath: 'id' });
          ex.createIndex('by-exportedAt', 'exportedAt');
          ex.createIndex('by-project', 'projectId');
        }
        if (oldVersion < 2) {
          db.createObjectStore('segments', { keyPath: 'key' }).createIndex('by-project', 'projectId');
        }
      },
    });
  }
  return dbPromise;
}

/** OPFS + IndexedDB + Workers — all three are needed for local media. */
export function isLocalMediaSupported(): boolean {
  try {
    return (
      typeof navigator !== 'undefined' &&
      !!navigator.storage &&
      typeof navigator.storage.getDirectory === 'function' &&
      typeof Worker !== 'undefined' &&
      typeof indexedDB !== 'undefined'
    );
  } catch {
    return false;
  }
}

/* ---------- worker RPC ---------- */

type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  onProgress?: (written: number, total: number) => void;
};

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./opfs.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<OpfsReply>) => {
    const msg = e.data;
    const p = pending.get(msg.id);
    if (!p) return;
    if (msg.kind === 'progress') {
      p.onProgress?.(msg.written, msg.total);
      return;
    }
    pending.delete(msg.id);
    if (msg.kind === 'ok') p.resolve(msg.result);
    else p.reject(new Error(msg.message));
  };
  worker.onerror = (e) => {
    // A crashed worker would leave every caller hanging — fail them all and
    // let the next call spin up a fresh worker.
    const err = new Error(e.message || 'OPFS worker crashed');
    for (const p of pending.values()) p.reject(err);
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

function call<T>(
  req: Omit<Extract<OpfsRequest, { op: 'write' }>, 'id'> | Omit<OpfsRequest, 'id'>,
  onProgress?: (written: number, total: number) => void,
): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress });
    getWorker().postMessage({ ...req, id });
  });
}

/* ---------- OPFS reads (main thread) ---------- */

async function readOpfsFile(opfsPath: string): Promise<File | null> {
  try {
    const parts = opfsPath.split('/').filter(Boolean);
    const name = parts.pop();
    if (!name) return null;
    let dir = await navigator.storage.getDirectory();
    for (const part of parts) dir = await dir.getDirectoryHandle(part);
    const fh = await dir.getFileHandle(name);
    return await fh.getFile();
  } catch {
    return null;
  }
}

function extensionOf(name: string, type: string): string {
  const m = /\.([a-z0-9]{2,5})$/i.exec(name);
  if (m) return `.${m[1].toLowerCase()}`;
  if (type.includes('quicktime')) return '.mov';
  if (type.includes('webm')) return '.webm';
  if (type.includes('matroska')) return '.mkv';
  return '.mp4';
}

let persistRequested = false;
async function requestPersistence() {
  if (persistRequested) return;
  persistRequested = true;
  try {
    // Asking once is enough; a granted "persistent" bucket is exempt from
    // the browser's under-pressure eviction, which matters for 1 GB sources.
    await navigator.storage.persist?.();
  } catch {
    /* best effort */
  }
}

/* ---------- sources ---------- */

/**
 * Copy the picked File into OPFS and remember it for this project. Runs in
 * parallel with the upload — the caller awaits it before leaving the page.
 */
export async function storeSourceFile(
  projectId: string,
  file: File,
  probe: MediaProbe | null,
  onProgress?: (written: number, total: number) => void,
): Promise<LocalSourceRecord> {
  void requestPersistence();
  const opfsPath = `sources/${projectId}${extensionOf(file.name, file.type)}`;
  await call<void>({ op: 'write', path: opfsPath, blob: file }, onProgress);
  const record: LocalSourceRecord = {
    projectId,
    name: file.name,
    size: file.size,
    type: file.type,
    lastModified: file.lastModified,
    opfsPath,
    storedAt: Date.now(),
    probe,
  };
  const db = await getDb();
  await db.put('sources', record);
  return record;
}

export async function listSources(): Promise<LocalSourceRecord[]> {
  if (!isLocalMediaSupported()) return [];
  const db = await getDb();
  const rows = await db.getAll('sources');
  return rows.sort((a, b) => b.storedAt - a.storedAt);
}

export async function getSourceRecord(projectId: string): Promise<LocalSourceRecord | null> {
  if (!isLocalMediaSupported()) return null;
  const db = await getDb();
  return (await db.get('sources', projectId)) ?? null;
}

/**
 * The stored source as a File, or null when there is none on this device.
 * A record whose file has vanished (storage cleared, OPFS evicted) is
 * dropped so the UI never advertises a copy it cannot read.
 */
export async function getSourceFile(projectId: string): Promise<File | null> {
  const rec = await getSourceRecord(projectId);
  if (!rec) return null;
  const file = await readOpfsFile(rec.opfsPath);
  if (!file) {
    const db = await getDb();
    await db.delete('sources', projectId);
    return null;
  }
  return file;
}

export async function deleteSource(projectId: string): Promise<void> {
  if (!isLocalMediaSupported()) return;
  const db = await getDb();
  const rec = await db.get('sources', projectId);
  if (rec) await call<void>({ op: 'remove', path: rec.opfsPath }).catch(() => undefined);
  await db.delete('sources', projectId);
  await deleteSegments(projectId);
}

/* ---------- parts of link-imported videos ---------- */

const ms = (t: number) => Math.round(t * 1000);

/** Keep one part of a link-imported video; parts it makes redundant (inside it) go. */
export async function storeSegmentFile(
  projectId: string,
  start: number,
  end: number,
  file: Blob,
  probe: MediaProbe | null,
): Promise<LocalSegmentRecord> {
  void requestPersistence();
  const key = `${projectId}:${ms(start)}:${ms(end)}`;
  const opfsPath = `sources/${projectId}~${ms(start)}-${ms(end)}.mp4`;
  await call<void>({ op: 'write', path: opfsPath, blob: file });
  const record: LocalSegmentRecord = { key, projectId, start, end, size: file.size, opfsPath, storedAt: Date.now(), probe };
  const db = await getDb();
  await db.put('segments', record);
  const others = (await db.getAllFromIndex('segments', 'by-project', projectId)).filter((s) => s.key !== key);
  const inside = others.filter((s) => s.start >= start && s.end <= end);
  const overflow = others
    .filter((s) => !inside.includes(s))
    .sort((a, b) => a.storedAt - b.storedAt)
    .slice(0, Math.max(0, others.length - inside.length - (MAX_SEGMENTS_PER_PROJECT - 1)));
  for (const s of [...inside, ...overflow]) await deleteSegment(s);
  return record;
}

/** The stored part covering [start, end] (the shortest one), or null. Records whose file vanished are dropped. */
export async function findSegment(
  projectId: string,
  range: { start: number; end: number },
): Promise<{ record: LocalSegmentRecord; file: File } | null> {
  if (!isLocalMediaSupported()) return null;
  const db = await getDb();
  const covering = (await db.getAllFromIndex('segments', 'by-project', projectId))
    // Times are stored to the millisecond; allow that much rounding.
    .filter((s) => s.start <= range.start + 0.002 && s.end >= range.end - 0.002)
    .sort((a, b) => a.end - a.start - (b.end - b.start));
  for (const record of covering) {
    const file = await readOpfsFile(record.opfsPath);
    if (file) return { record, file };
    await db.delete('segments', record.key);
  }
  return null;
}

export async function listSegments(): Promise<LocalSegmentRecord[]> {
  if (!isLocalMediaSupported()) return [];
  return (await getDb()).getAll('segments');
}

export async function deleteSegment(record: LocalSegmentRecord): Promise<void> {
  await call<void>({ op: 'remove', path: record.opfsPath }).catch(() => undefined);
  await (await getDb()).delete('segments', record.key);
}

export async function deleteSegments(projectId: string): Promise<void> {
  if (!isLocalMediaSupported()) return;
  const db = await getDb();
  for (const s of await db.getAllFromIndex('segments', 'by-project', projectId)) await deleteSegment(s);
}

/* ---------- exports ---------- */

export async function storeExportFile(
  id: string,
  blob: Blob,
  ext: 'mp4' | 'webm',
  onProgress?: (written: number, total: number) => void,
): Promise<string> {
  void requestPersistence();
  const opfsPath = `exports/${id}.${ext}`;
  await call<void>({ op: 'write', path: opfsPath, blob }, onProgress);
  return opfsPath;
}

/** Path for an export the worker writes directly (streaming), so the record
 *  can be created before the bytes exist. */
export function exportOpfsPath(id: string, ext: 'mp4' | 'webm'): string {
  return `exports/${id}.${ext}`;
}

export async function saveExportRecord(record: LocalExportRecord): Promise<void> {
  const db = await getDb();
  await db.put('exports', record);
}

export async function listExports(): Promise<LocalExportRecord[]> {
  if (!isLocalMediaSupported()) return [];
  const db = await getDb();
  const rows = await db.getAllFromIndex('exports', 'by-exportedAt');
  return rows.reverse(); // newest first
}

export async function getExportFile(opfsPath: string): Promise<File | null> {
  return readOpfsFile(opfsPath);
}

/** Remove a file by OPFS path (e.g. a partial render left by a killed worker). */
export async function removeLocalFile(opfsPath: string): Promise<void> {
  if (!isLocalMediaSupported()) return;
  await call<void>({ op: 'remove', path: opfsPath }).catch(() => undefined);
}

export async function latestExportForProject(projectId: string): Promise<LocalExportRecord | null> {
  if (!isLocalMediaSupported()) return null;
  const db = await getDb();
  const rows = await db.getAllFromIndex('exports', 'by-project', projectId);
  return rows.sort((a, b) => b.exportedAt - a.exportedAt)[0] ?? null;
}

/** The newest render of one clip on this device. */
export async function latestExportForClip(projectId: string, clipId: string): Promise<LocalExportRecord | null> {
  if (!isLocalMediaSupported()) return null;
  const db = await getDb();
  const rows = await db.getAllFromIndex('exports', 'by-project', projectId);
  return rows.filter((r) => r.clipId === clipId).sort((a, b) => b.exportedAt - a.exportedAt)[0] ?? null;
}

/** Remember that an export was downloaded (shown on its card). */
export async function markExportDownloaded(id: string, fileName: string): Promise<void> {
  const db = await getDb();
  const rec = await db.get('exports', id);
  if (!rec) return;
  await db.put('exports', { ...rec, downloadedAs: fileName, downloadedAt: Date.now() });
}

export async function deleteExport(id: string): Promise<void> {
  const db = await getDb();
  const rec = await db.get('exports', id);
  if (rec) await call<void>({ op: 'remove', path: rec.opfsPath }).catch(() => undefined);
  await db.delete('exports', id);
}

/* ---------- quota ---------- */

export async function getStorageInfo(): Promise<{ usedMB: number; quotaMB: number; percentUsed: number }> {
  try {
    const est = await navigator.storage.estimate();
    const used = (est.usage ?? 0) / (1024 * 1024);
    const quota = (est.quota ?? 0) / (1024 * 1024);
    return {
      usedMB: Math.round(used),
      quotaMB: Math.round(quota),
      percentUsed: quota > 0 ? Math.round((used / quota) * 100) : 0,
    };
  } catch {
    return { usedMB: 0, quotaMB: 0, percentUsed: 0 };
  }
}

/**
 * When the origin's storage passes `thresholdPercent`, drop the oldest fifth
 * of stored exports. Sources are never evicted here — an editor session may
 * still need them; they go when the project is deleted or exported.
 */
export async function evictOldExportsIfNeeded(thresholdPercent = 80): Promise<number> {
  const { percentUsed } = await getStorageInfo();
  if (percentUsed < thresholdPercent) return 0;
  const all = await listExports(); // newest first
  const victims = all.slice(Math.floor(all.length * 0.8));
  for (const v of victims) await deleteExport(v.id);
  return victims.length;
}
