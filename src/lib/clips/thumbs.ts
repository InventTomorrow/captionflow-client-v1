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
import { clipAspect, clipFrameTime, clipLayout, cropTrackFor, thumbKey, type ClipFraming, type ClipTiming } from './clipMath';
import { cropRect, cropXAt, integerCrop } from './cropTrack';
import { drawLayout, type LayoutContext } from './layout';

/** Longest side of the uncropped frame a framed poster (or a layout card) is composed from. */
const SOURCE_FRAME_MAX = 640;

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
    const layout = clipLayout(clip);
    if (layout) {
      // A framing layout: compose the poster from the whole frame, as the preview and export do.
      const frame = await uncroppedFrame(video, t - offset);
      if (!frame) return null;
      const out = new OffscreenCanvas(THUMB_W, THUMB_H);
      const ctx = out.getContext('2d');
      if (!ctx) return null;
      drawLayout(ctx as unknown as LayoutContext, THUMB_W, THUMB_H, layout, frame.width, frame.height, (c, sx, sy, sw, sh, dx, dy, dw, dh) =>
        (c as unknown as OffscreenCanvasRenderingContext2D).drawImage(frame.canvas, sx, sy, sw, sh, dx, dy, dw, dh),
      );
      return await toDataUrl(out);
    }
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
    return await toDataUrl(frame.canvas);
  } catch (err) {
    console.warn('[clips] poster frame failed', err);
    return null;
  } finally {
    input.dispose();
  }
}

type DecodableTrack = NonNullable<Awaited<ReturnType<Input['getPrimaryVideoTrack']>>>;

/** One whole (uncropped, upright) frame at time t, at most SOURCE_FRAME_MAX on its longest side. */
async function uncroppedFrame(video: DecodableTrack, t: number) {
  const sw = video.displayWidth;
  const sh = video.displayHeight;
  const scale = Math.min(1, SOURCE_FRAME_MAX / Math.max(sw, sh));
  const width = Math.max(2, Math.round(sw * scale));
  const height = Math.max(2, Math.round(sh * scale));
  const sink = new CanvasSink(video, { width, height, fit: 'fill' });
  const frame = await sink.getCanvas(Math.max(0, t));
  return frame ? { canvas: frame.canvas as OffscreenCanvas | HTMLCanvasElement, width, height } : null;
}

async function toDataUrl(canvas: OffscreenCanvas | HTMLCanvasElement): Promise<string> {
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
}

export interface SourceFrame {
  /** JPEG data URL of the whole frame. */
  url: string;
  /** Its pixel size (the source's proportions, scaled down). */
  width: number;
  height: number;
}

const sourceFrames = new Map<string, Promise<SourceFrame | null>>();

/**
 * The clip's whole, uncropped poster frame — what the framing editor and the
 * layout cards are drawn from. Same sources as getClipThumb (the device's copy,
 * or a single frame of the server stream); kept in memory for the session.
 */
export function getSourceFrame(
  projectId: string,
  clip: ClipTiming & ClipFraming,
  videoKind?: string,
): Promise<SourceFrame | null> {
  const key = `${projectId}:${clip._id}:${clip.start.toFixed(2)}`;
  const known = sourceFrames.get(key);
  if (known) return known;
  const p = (async () => {
    const media = await localClipMedia(projectId, clip).catch(() => null);
    let source: Source | null = null;
    if (media) source = new BlobSource(media.file);
    else if (videoKind && videoKind !== 'audio') {
      source = new UrlSource(`${API_URL}/api/projects/${projectId}/video`, { requestInit: { credentials: 'include' } });
    }
    if (!source) return null;
    const src = source;
    return slot(async () => {
      const input = new Input({ formats: ALL_FORMATS, source: src });
      try {
        const video = await input.getPrimaryVideoTrack();
        if (!video || !(await video.canDecode())) return null;
        const frame = await uncroppedFrame(video, clipFrameTime(clip) - (media?.offset ?? 0));
        if (!frame) return null;
        return { url: await toDataUrl(frame.canvas), width: frame.width, height: frame.height };
      } catch (err) {
        console.warn('[clips] source frame failed', err);
        return null;
      } finally {
        input.dispose();
      }
    });
  })();
  // A miss (media not on the device yet) is retried next time.
  void p.then((r) => {
    if (!r) sourceFrames.delete(key);
  });
  sourceFrames.set(key, p);
  return p;
}
