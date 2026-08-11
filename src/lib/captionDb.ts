import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Caption } from '../stores/captionStore';

interface CaptionDBSchema extends DBSchema {
  captions: {
    key: string;
    value: Caption & { projectId: string };
    indexes: { 'by-project': string };
  };
}

let dbPromise: Promise<IDBPDatabase<CaptionDBSchema>> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<CaptionDBSchema>('captionflow', 1, {
      upgrade(db) {
        const store = db.createObjectStore('captions', { keyPath: '_id' });
        store.createIndex('by-project', 'projectId');
      },
    });
  }
  return dbPromise;
}

export async function getAllForProject(projectId: string): Promise<Caption[]> {
  const db = await getDb();
  const rows = await db.getAllFromIndex('captions', 'by-project', projectId);
  return rows.sort((a, b) => a.sequence - b.sequence);
}

export async function replaceAllForProject(projectId: string, captions: Caption[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('captions', 'readwrite');
  const existingKeys = await tx.store.index('by-project').getAllKeys(projectId);
  await Promise.all(existingKeys.map((k) => tx.store.delete(k)));
  await Promise.all(
    captions.filter((c) => c._id).map((c) => tx.store.put({ ...c, projectId })),
  );
  await tx.done;
}

export async function upsertOne(projectId: string, caption: Caption): Promise<void> {
  if (!caption._id) return;
  const db = await getDb();
  await db.put('captions', { ...caption, projectId });
}

export async function deleteAllForProject(projectId: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('captions', 'readwrite');
  const keys = await tx.store.index('by-project').getAllKeys(projectId);
  await Promise.all(keys.map((k) => tx.store.delete(k)));
  await tx.done;
}

export async function listAllProjectIds(): Promise<string[]> {
  const db = await getDb();
  const all = await db.getAll('captions');
  return [...new Set(all.map((c) => c.projectId))];
}
