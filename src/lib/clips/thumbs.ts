/**
 * clips/thumbs.ts — poster frames for clip cards, made on this device from the
 * project's OPFS source (no server thumbnails, no upload). 270×480 JPEGs,
 * framed exactly like the clip, cached in IndexedDB by thumbKey (so moving the
 * in-point or the framing makes a new one). At most two are decoded at a time.
 */
import { openDB, type IDBPDatabase } from 'idb';
import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import { getSourceFile } from '../media/localMedia';
import { clipFrameTime, cropTrackFor, thumbKey, type ClipFraming, type ClipTiming } from './clipMath';
import { cropRect, cropXAt, integerCrop } from './cropTrack';

const THUMB_W = 270;
const THUMB_H = 480;
const MAX_PARALLEL = 2;

let dbPromise: Promise<IDBPDatabase> | null = null;
function db() {
  dbPromise ??= openDB('captionflow-clips', 1, {
    upgrade(d) {
      d.createObjectStore('clip-thumbs');
    },
  });
  return dbPromise;
}

let running = 0;
const waiting: Array<() => void> = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) await new Promise<void>((r) => waiting.push(r));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

const inflight = new Map<string, Promise<string | null>>();

/** The clip's poster as a data URL, or null when this device has no copy of the video. */
export function getClipThumb(projectId: string, clip: ClipTiming & ClipFraming): Promise<string | null> {
  const key = thumbKey(clip);
  const pending = inflight.get(key);
  if (pending) return pending;
  const p = (async () => {
    try {
      const cached = (await (await db()).get('clip-thumbs', key)) as string | undefined;
      if (cached) return cached;
    } catch {
      /* no IndexedDB (private mode): just render */
    }
    const file = await getSourceFile(projectId);
    if (!file) return null;
    const url = await slot(() => renderThumb(file, clip));
    if (url) await (await db()).put('clip-thumbs', url, key).catch(() => undefined);
    return url;
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function renderThumb(file: File, clip: ClipTiming & ClipFraming): Promise<string | null> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  try {
    const video = await input.getPrimaryVideoTrack();
    if (!video || !(await video.canDecode())) return null;
    const t = clipFrameTime(clip);
    const track = cropTrackFor(clip);
    const sw = video.displayWidth;
    const sh = video.displayHeight;
    const sink = new CanvasSink(video, {
      width: THUMB_W,
      height: THUMB_H,
      ...(track
        ? { fit: 'fill' as const, crop: integerCrop(cropRect(sw, sh, THUMB_W, THUMB_H, cropXAt(track, t - clip.start)), sw, sh) }
        : { fit: 'contain' as const }),
    });
    const frame = await sink.getCanvas(t);
    if (!frame) return null;
    const canvas = frame.canvas;
    if ('convertToBlob' in canvas) {
      const blob = await (canvas as OffscreenCanvas).convertToBlob({ type: 'image/jpeg', quality: 0.7 });
      return await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(r.error);
        r.readAsDataURL(blob);
      });
    }
    return (canvas as HTMLCanvasElement).toDataURL('image/jpeg', 0.7);
  } catch (err) {
    console.warn('[clips] poster frame failed', err);
    return null;
  } finally {
    input.dispose();
  }
}
