/**
 * clips/thumbs.ts — poster frames for clip cards, made on this device from the
 * project's OPFS source (no server thumbnails, no upload). 270×480 JPEGs,
 * framed exactly like the clip, cached in IndexedDB by thumbKey (so moving the
 * in-point or the framing makes a new one). At most two are decoded at a time.
 */
import { openDB, type IDBPDatabase } from 'idb';
import { ALL_FORMATS, BlobSource, CanvasSink, Input, UrlSource, type Source } from 'mediabunny';
import { API_URL } from '../api';
import { localClipMedia } from './clipMedia';
import { clipAspect, clipFrameTime, cropTrackFor, thumbKey, type ClipFraming, type ClipTiming } from './clipMath';
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

/**
 * The clip's poster as a data URL, or null when there is nothing to decode on
 * this device. Decodes from the device's copy — the whole original, or the
 * clip's own part of a linked video; otherwise, for a full-video upload the
 * server streams, a single frame over the Range-capable stream (only that
 * frame's bytes are fetched). Result is cached in IndexedDB by framing.
 */
export function getClipThumb(
  projectId: string,
  clip: ClipTiming & ClipFraming,
  videoKind?: string,
): Promise<string | null> {
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
    const media = await localClipMedia(projectId, clip).catch(() => null);
    let source: Source | null = null;
    if (media) source = new BlobSource(media.file);
    else if (videoKind && videoKind !== 'audio') {
      source = new UrlSource(`${API_URL}/api/projects/${projectId}/video`, {
        requestInit: { credentials: 'include' },
      });
    }
    if (!source) return null;
    const url = await slot(() => renderThumb(source!, clip, media?.offset ?? 0));
    if (url) await (await db()).put('clip-thumbs', url, key).catch(() => undefined);
    return url;
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** `offset`: source time at the decoded file's 0:00 (a clip's part of a linked video). */
async function renderThumb(source: Source, clip: ClipTiming & ClipFraming, offset: number): Promise<string | null> {
  const input = new Input({ formats: ALL_FORMATS, source });
  try {
    const video = await input.getPrimaryVideoTrack();
    if (!video || !(await video.canDecode())) return null;
    const t = clipFrameTime(clip);
    const track = cropTrackFor(clip);
    const sw = video.displayWidth;
    const sh = video.displayHeight;
    // Vertical posters for 9:16 clips, landscape ones for 16:9 clips.
    const [w, h] = clipAspect(clip) === '16:9' ? [THUMB_H, THUMB_W] : [THUMB_W, THUMB_H];
    const sink = new CanvasSink(video, {
      width: w,
      height: h,
      ...(track
        ? { fit: 'fill' as const, crop: integerCrop(cropRect(sw, sh, w, h, cropXAt(track, t - clip.start)), sw, sh) }
        : { fit: 'contain' as const }),
    });
    const frame = await sink.getCanvas(t - offset);
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
