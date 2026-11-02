/**
 * clips/clipMedia.ts — the video a clip is previewed, framed and rendered
 * from on this device: the project's whole original (uploaded here), or, for
 * a video that came from a pasted link, just that clip's part of it — cut by
 * the server on request, fetched once and kept. Nothing else of a linked video
 * is ever downloaded.
 *
 * `offset` is the source time at the file's 0:00, so a clip at [start, end]
 * is [start - offset, end - offset] in `file` (0 for a whole original).
 */
import { API_URL } from '../api';
import { findSegment, getSourceFile, getSourceRecord, storeSegmentFile } from '../media/localMedia';
import { probeMediaFile, type MediaProbe } from '../media/probe';
import { connectSocket } from '../socket';
import { pollClipSegment, requestClipSegment, type ClipSegmentView } from './api';
import type { TimeRange } from './clipMath';

export interface ClipMedia {
  file: File;
  offset: number;
  probe: MediaProbe | null;
  /** The whole original (not a part). */
  whole: boolean;
  /** This call downloaded it. */
  fetched?: boolean;
}

/** 0..100 over the server's cut (0–90) and this device's download (90–100). */
export type FetchProgress = (percent: number) => void;

export class ClipMediaError extends Error {}

const round3 = (t: number) => Math.round(t * 1000) / 1000;

/** This device's media for [start, end], without fetching anything. */
export async function localClipMedia(projectId: string, range: TimeRange): Promise<ClipMedia | null> {
  const whole = await getSourceFile(projectId).catch(() => null);
  if (whole) {
    const probe = (await getSourceRecord(projectId).catch(() => null))?.probe ?? null;
    return { file: whole, offset: 0, probe, whole: true };
  }
  const part = await findSegment(projectId, range).catch(() => null);
  return part ? { file: part.file, offset: part.record.start, probe: part.record.probe, whole: false } : null;
}

/** The part asked for: the clip a quarter second wider each side, so rounding never loses a frame. */
export function partRange(range: TimeRange, duration?: number): TimeRange {
  const start = Math.max(0, range.start - 0.25);
  const end = duration && duration > 0 ? Math.min(duration, range.end + 0.25) : range.end + 0.25;
  return { start: round3(start), end: round3(end) };
}

/**
 * The clip's media: what this device has, else — `imported` — its part of the
 * linked video, fetched now. Null when there is nothing to play here.
 */
export async function clipMedia(
  projectId: string,
  clip: { _id: string; start: number; end: number },
  opts: { imported?: boolean; duration?: number; signal?: AbortSignal; onProgress?: FetchProgress } = {},
): Promise<ClipMedia | null> {
  const local = await localClipMedia(projectId, clip);
  if (local || !opts.imported) return local;
  return fetchClipPart(projectId, clip._id, partRange(clip, opts.duration), opts.signal, opts.onProgress);
}

/* --------------------------------------------------------------- fetching */

const inflight = new Map<string, { promise: Promise<ClipMedia>; listeners: Set<FetchProgress> }>();

const sleep = (msec: number) => new Promise<void>((resolve) => setTimeout(resolve, msec));
const httpStatus = (err: unknown) => (err as { response?: { status?: number } }).response?.status;

/** Start the server's cut; while the user's other clips are being cut, wait for a free turn. */
async function startCut(clipId: string, range: TimeRange): Promise<ClipSegmentView> {
  for (let tries = 0; ; tries++) {
    try {
      return await requestClipSegment(clipId, range);
    } catch (err) {
      if (httpStatus(err) !== 429 || tries >= 100) throw err;
      await sleep(3000);
    }
  }
}

/** The cut's state once it settles (long polls), riding out a brief network drop. */
async function waitForCut(clipId: string, view: ClipSegmentView, onView: (v: ClipSegmentView) => void): Promise<ClipSegmentView> {
  let failures = 0;
  while (view.status === 'queued' || view.status === 'cutting') {
    try {
      view = await pollClipSegment(clipId, view.id);
      failures = 0;
      onView(view);
    } catch (err) {
      if (httpStatus(err) === 404 || ++failures > 3) throw err;
      await sleep(2000);
    }
  }
  return view;
}

async function download(url: string, onBytes: (fraction: number) => void): Promise<Blob> {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok || !res.body) throw new ClipMediaError(`Couldn’t download this clip (HTTP ${res.status}) — try again.`);
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.byteLength;
    if (total) onBytes(got / total);
  }
  return new Blob(chunks as BlobPart[], { type: 'video/mp4' });
}

/** `p`, or an AbortError as soon as `signal` fires (p itself keeps going). */
function untilAborted<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException('Cancelled', 'AbortError'));
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/**
 * One part of a linked video, cut on the server and kept on this device.
 * Callers for the same part share one fetch and each gets progress. A caller
 * that gives up (`signal`) only stops waiting: the fetch finishes and keeps
 * the part, so the next caller has it at once.
 */
export function fetchClipPart(
  projectId: string,
  clipId: string,
  range: TimeRange,
  signal?: AbortSignal,
  onProgress?: FetchProgress,
): Promise<ClipMedia> {
  const key = `${projectId}:${range.start}:${range.end}`;
  let entry = inflight.get(key);
  if (!entry) {
    const listeners = new Set<FetchProgress>();
    entry = { promise: runFetch(projectId, clipId, range, listeners).finally(() => inflight.delete(key)), listeners };
    inflight.set(key, entry);
  }
  const { listeners, promise } = entry;
  if (onProgress) listeners.add(onProgress);
  return untilAborted(promise, signal).finally(() => onProgress && listeners.delete(onProgress));
}

function runFetch(projectId: string, clipId: string, range: TimeRange, listeners: Set<FetchProgress>): Promise<ClipMedia> {
  let shown = 0;
  const report = (pct: number) => {
    // Socket events and poll answers can arrive out of order: never step back.
    shown = Math.max(shown, Math.max(0, Math.min(100, Math.round(pct))));
    listeners.forEach((l) => l(shown));
  };
  return (async (): Promise<ClipMedia> => {
    report(0);
    let view = await startCut(clipId, range);
    // Live percent over the socket; the long poll below is what decides.
    const socket = connectSocket();
    const onSegment = (e: ClipSegmentView) => {
      if (e.id === view.id && (e.status === 'queued' || e.status === 'cutting')) report(e.percent * 0.9);
    };
    socket.on('clips:segment', onSegment);
    try {
      report(view.percent * 0.9);
      view = await waitForCut(clipId, view, (v) => report(v.percent * 0.9));
    } finally {
      socket.off('clips:segment', onSegment);
    }
    if (view.status !== 'ready') throw new ClipMediaError(view.error || 'This clip couldn’t be prepared — try again.');
    report(90);
    const blob = await download(`${API_URL}/api/clips/${clipId}/segment/${view.id}/file`, (f) => report(90 + f * 10));
    const probe = await probeMediaFile(blob).catch(() => null);
    const record = await storeSegmentFile(projectId, view.start, view.end, blob, probe);
    const stored = await findSegment(projectId, { start: record.start, end: record.end });
    report(100);
    return {
      file: stored?.file ?? new File([blob], 'clip.mp4', { type: 'video/mp4' }),
      offset: view.start,
      probe,
      whole: false,
      fetched: true,
    };
  })();
}
