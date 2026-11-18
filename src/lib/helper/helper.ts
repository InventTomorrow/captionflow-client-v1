/**
 * helper/helper.ts — talks to "Asaan Caption Helper", the small Windows app
 * (client/helper) that fetches YouTube media over the user's own connection.
 * It answers on http://localhost:<port>; this module finds it, asks it about
 * a video, and pulls byte ranges of the video's audio or video stream.
 * Nothing here goes through our server.
 */

/** Versions older than this are asked to update (the installer updates in place). */
export const HELPER_MIN_VERSION = '1.0.0';
export const HELPER_DOWNLOAD_URL = '/helper/AsaanCaptionHelper.exe';
/** Starts an installed helper that isn't running (registered by its installer). */
export const HELPER_LAUNCH_URL = 'asaancaption-helper://start';

const PORTS = [47821, 47822, 47823];
/** Bytes per range request (the helper caps one at 16 MB). */
const CHUNK = 8 * 1024 * 1024;
const PARALLEL = 3;

export interface HelperStatus {
  base: string;
  version: string;
  /** Its YouTube tools are in place. */
  ready: boolean;
  outdated: boolean;
}

export interface HelperStream {
  format: string;
  size: number;
  mime: string;
  codec: string;
  width?: number;
  height?: number;
  fps?: number;
}

export interface HelperVideo {
  id: string;
  title: string;
  duration: number;
  thumbnail?: string;
  video: HelperStream;
  audio: HelperStream;
}

export class HelperError extends Error {
  /** 'missing' = the helper isn't running; otherwise the helper's own code ('private', 'live', …). */
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'HelperError';
    this.code = code;
  }
}

export const HELPER_MISSING_MESSAGE =
  'Asaan Caption Helper isn’t running on this computer. Open it (or install it) and try again.';

/** The YouTube video id of a link, or null when it isn't a single YouTube video. */
export function youtubeVideoId(link: string): string | null {
  let u: URL;
  try {
    u = new URL(link.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, '');
  const segs = u.pathname.split('/').filter(Boolean);
  let id: string | null = null;
  if (host === 'youtu.be') id = segs[0] ?? null;
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (segs[0] === 'watch') id = u.searchParams.get('v');
    else if (segs.length >= 2 && ['shorts', 'embed', 'live', 'v'].includes(segs[0])) id = segs[1];
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

/** Only Windows computers can run the helper for now. */
export function helperSupportedHere(): boolean {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string; mobile?: boolean } };
  if (nav.userAgentData?.mobile) return false;
  const platform = nav.userAgentData?.platform || navigator.platform || '';
  return /win/i.test(platform) || /Windows NT/i.test(navigator.userAgent);
}

function newer(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

let found: string | null = null;

async function ping(base: string, timeoutMs: number): Promise<HelperStatus | null> {
  try {
    const res = await fetch(`${base}/ping`, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const body = (await res.json()) as { app?: string; version?: string; ready?: boolean };
    if (body.app !== 'asaan-caption-helper' || !body.version) return null;
    return { base, version: body.version, ready: !!body.ready, outdated: newer(body.version, HELPER_MIN_VERSION) < 0 };
  } catch {
    return null;
  }
}

/** The running helper, or null. Its usual port first; the spare ports only when that one doesn't answer. */
export async function findHelper(timeoutMs = 1500): Promise<HelperStatus | null> {
  const bases = PORTS.map((p) => `http://localhost:${p}`);
  const first = found && bases.includes(found) ? found : bases[0];
  let status = await ping(first, timeoutMs);
  if (!status) {
    const others = await Promise.all(bases.filter((b) => b !== first).map((b) => ping(b, timeoutMs)));
    status = others.find((s) => s) ?? null;
  }
  found = status?.base ?? null;
  return status;
}

async function helperBase(): Promise<string> {
  if (found) return found;
  const status = await findHelper();
  if (!status) throw new HelperError(HELPER_MISSING_MESSAGE, 'missing');
  return status.base;
}

/** A failed request: the helper's own message, or "not running" when it can't be reached. */
async function failure(res: Response | null): Promise<HelperError> {
  if (!res) {
    found = null;
    return new HelperError(HELPER_MISSING_MESSAGE, 'missing');
  }
  const body = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
  return new HelperError(body?.message || `The helper couldn’t fetch this video (${res.status}). Try again.`, body?.error || String(res.status));
}

/** Title, length and the two streams for a YouTube link. */
export async function helperVideoInfo(link: string, signal?: AbortSignal): Promise<HelperVideo> {
  const base = await helperBase();
  let res: Response | null = null;
  try {
    res = await fetch(`${base}/info?url=${encodeURIComponent(link)}`, {
      cache: 'no-store',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(150_000)]) : AbortSignal.timeout(150_000),
    });
  } catch (err) {
    if (signal?.aborted) throw err;
  }
  if (!res?.ok) throw await failure(res);
  return (await res.json()) as HelperVideo;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Bytes [start, end] of one stream, retried on a dropped connection or a helper/YouTube hiccup. */
export async function helperRange(
  videoId: string,
  stream: HelperStream,
  start: number,
  end: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  for (let attempt = 0; ; attempt++) {
    const base = await helperBase();
    let res: Response | null = null;
    try {
      res = await fetch(`${base}/media/${videoId}/${encodeURIComponent(stream.format)}`, {
        headers: { Range: `bytes=${start}-${end}` },
        cache: 'no-store',
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000),
      });
      if (res.status === 206) {
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.byteLength === end - start + 1) return bytes;
        res = null; // Cut short: try again.
      }
    } catch (err) {
      if (signal?.aborted) throw err;
      res = null;
    }
    const transient = !res || res.status >= 500 || res.status === 429;
    if (!transient || attempt >= 3) throw await failure(res);
    if (!res) found = null; // Maybe restarted on another port.
    await sleep(Math.min(8000, 700 * 2 ** attempt) + Math.random() * 400);
  }
}

/** Fetch [start, end] of a stream as chunks, a few at a time. `onBytes` gets the running total. */
export async function helperFetch(
  videoId: string,
  stream: HelperStream,
  start: number,
  end: number,
  opts: { signal?: AbortSignal; onBytes?: (got: number) => void } = {},
): Promise<Uint8Array[]> {
  const ranges: [number, number][] = [];
  for (let s = start; s <= end; s += CHUNK) ranges.push([s, Math.min(end, s + CHUNK - 1)]);
  const parts: Uint8Array[] = new Array(ranges.length);
  // One failed chunk stops the others (and so does the caller's signal).
  const stop = new AbortController();
  const signal = opts.signal ? AbortSignal.any([opts.signal, stop.signal]) : stop.signal;
  let next = 0;
  let got = 0;
  const worker = async () => {
    while (next < ranges.length) {
      const i = next++;
      const [s, e] = ranges[i];
      parts[i] = await helperRange(videoId, stream, s, e, signal);
      got += parts[i].byteLength;
      opts.onBytes?.(got);
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(PARALLEL, ranges.length) }, worker));
  } catch (err) {
    stop.abort();
    throw err;
  }
  return parts;
}
