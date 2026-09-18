/**
 * export/clientExport.ts — the editor's side of an on-device export.
 *
 *   chooseExportRoute()   decide: this device, the server, or neither
 *   buildDeviceExportJob() everything the worker needs, captions pre-grouped
 *                          exactly like the live preview groups them
 *   startDeviceExport()   run export.worker.ts; progress, cancel, result
 *   authorize / complete / fail  the server keeps plan checks, usage counts,
 *                          project status and analytics
 *   saveDeviceExportRecord / downloadLocalFile  Recent exports on this device
 *
 * The server export (POST /projects/:id/export) is unchanged and remains the
 * fallback whenever this device can't do the job.
 */

import { api } from '../api';
import type { Caption } from '../../stores/captionStore';
import { deriveDisplayCaptions } from '../displayCaptions';
import {
  KINETIC_BASE_FONT_SIZE,
  isKineticTemplate,
  type KineticCaptionInput,
  type KineticParams,
} from '../kinetic/engine';
import {
  getSourceFile,
  getSourceRecord,
  isLocalMediaSupported,
  getExportFile,
  removeLocalFile,
  saveExportRecord,
  type LocalExportRecord,
} from '../media/localMedia';
import { probeMediaFile } from '../media/probe';
import { FONT_URL_BASE } from '../render/fonts';
import {
  exportFrameSize,
  exportVideoBitrate,
  exportVideoQuantizer,
  FAST_EXPORT_FPS,
  type ExportFormat,
  type ExportQuality,
} from '../render/frame';
import type {
  ExportErrorCode,
  ExportJob,
  ExportResult,
  ExportStage,
  ExportWorkerIn,
  ExportWorkerOut,
  KineticOverlaySpec,
  OverlaySpec,
} from './protocol';
import type { DisplayMode } from '../displayCaptions';
import { compileLayoutTrack } from './layout/compile';
import { resolveFontSources } from './layout/fontSources';
import { behindWindows } from './behindWindows';

/** The style fields an export reads (a subset of the editor's StyleState). */
export interface ExportStyle {
  template: string;
  color: string;
  highlightColor: string;
  fontSize: number;
  displayWords: number;
  aspectRatio: string;
  kinetic?: KineticParams;
  behindPerson?: boolean;
  // Read by the preview-layout renderer (every non-kinetic template).
  fontFamily: string;
  fontWeight: number;
  backgroundColor: string;
  activeFill?: string;
  textTransform?: string;
  position: string;
  offsetX: number | null;
  offsetY: number | null;
  animation: string;
  displayMode: DisplayMode;
}

/* ------------------------------------------------------------------ routing */

/** 'fast' = at most 30 fps; 'original' = the source's frame rate. */
export type ExportFrameRate = 'fast' | 'original';

export type ExportRoute =
  | {
      path: 'device';
      source: File;
      width: number;
      height: number;
      durationSec: number;
      /** Things the user should know about this render (shown as a note). */
      notes: string[];
    }
  | {
      path: 'server';
      reason: string;
      /**
       * The server has no copy of the video (an audio-only upload, or its copy
       * was released after an export) but this device does: upload this file
       * to the project first (export/serverUpload.ts), then render there.
       */
      uploadFirst?: File;
    }
  /** Can't render here, and neither this device nor the server has the video. */
  | { path: 'none'; reason: string };

/**
 * Developer override: `localStorage.cf_export_path = 'server' | 'device'`.
 * 'device' ignores the admin flag (never the capability checks).
 */
export function exportPathOverride(): 'server' | 'device' | null {
  try {
    const v = localStorage.getItem('cf_export_path');
    return v === 'server' || v === 'device' ? v : null;
  } catch {
    return null;
  }
}

/** Why this browser can't render exports at all, or null when it can. */
export function deviceExportBlocker(): string | null {
  if (typeof Worker === 'undefined') return 'This browser has no Web Workers';
  if (typeof VideoEncoder === 'undefined' || typeof VideoDecoder === 'undefined') {
    return 'This browser has no WebCodecs video encoder';
  }
  if (typeof OffscreenCanvas === 'undefined') return 'This browser has no OffscreenCanvas';
  if (typeof FontFace === 'undefined') return 'This browser has no FontFace API';
  if (!isLocalMediaSupported()) return 'This browser has no local file storage (OPFS)';
  return null;
}

/**
 * Templates the device renderer draws: all of them. Kinetic templates run the
 * shared kinetic engine; every other template replays the live preview's own
 * layout (layout/compile.tsx → layout/painter.ts).
 */
export function isDeviceExportTemplate(template: string): boolean {
  return typeof template === 'string';
}

export interface RouteInput {
  projectId: string;
  clientExportEnabled: boolean;
  /** The server holds the source VIDEO (project.video.filePath, and not an audio-only upload). */
  serverHasSource: boolean;
  style: ExportStyle;
  captions: Caption[];
  quality: ExportQuality;
  format: ExportFormat;
  /** Display size from the server's probe, used when there is no local probe. */
  fallbackDims?: { width: number; height: number };
}

export async function chooseExportRoute(input: RouteInput): Promise<ExportRoute> {
  const toServer = async (reason: string): Promise<ExportRoute> => {
    if (input.serverHasSource) return { path: 'server', reason };
    const local = await getSourceFile(input.projectId).catch(() => null);
    return local ? { path: 'server', reason, uploadFirst: local } : { path: 'none', reason };
  };

  const override = exportPathOverride();
  if (override === 'server') return toServer('Server rendering forced (cf_export_path)');
  if (!input.clientExportEnabled && override !== 'device') {
    return toServer('In-browser rendering is turned off');
  }
  const blocker = deviceExportBlocker();
  if (blocker) return toServer(blocker);
  if (!isDeviceExportTemplate(input.style.template)) {
    return toServer('This template can only be rendered on the server for now');
  }

  // Text behind person renders on this device too (personMatte.ts, the
  // preview's own segmenter), so it no longer decides the route.
  const notes: string[] = [];

  const source = await getSourceFile(input.projectId);
  if (!source) return toServer('The original video isn’t stored on this device');

  const record = await getSourceRecord(input.projectId);
  const probe = record?.probe ?? (await probeMediaFile(source));
  if (probe && probe.hasVideo && !probe.canDecodeVideo) {
    return toServer(`This browser can’t decode ${probe.videoCodec ?? 'this'} video`);
  }

  const srcW = probe?.width || input.fallbackDims?.width || 0;
  const srcH = probe?.height || input.fallbackDims?.height || 0;
  const { width, height } = exportFrameSize(input.quality, input.style.aspectRatio, srcW, srcH);
  return { path: 'device', source, width, height, durationSec: probe?.duration ?? 0, notes };
}

/* ---------------------------------------------------------------- job build */

/**
 * The kinetic overlay, fed exactly what KineticCaptionLayer feeds the preview:
 * the canonical captions regrouped into phrase display captions.
 */
export function buildKineticOverlay(captions: Caption[], style: ExportStyle): KineticOverlaySpec {
  if (!isKineticTemplate(style.template)) {
    throw new Error(`"${style.template}" is not a kinetic template`);
  }
  const display = deriveDisplayCaptions(captions, 'phrase', style.displayWords);
  const input: KineticCaptionInput[] = display.map((c, i) => ({
    sequence: c.sequence ?? i,
    start: c.start,
    end: c.end,
    text: c.text,
    emphasis: c.emphasis,
    offsetX: c.offsetX,
    offsetY: c.offsetY,
    sizeScale: c.sizeScale,
  }));
  return {
    kind: 'kinetic',
    template: style.template,
    captions: input,
    accentColor: style.highlightColor || '#FFC43D',
    baseColor: style.color || '#FFFFFF',
    fontScale: (Number(style.fontSize) || KINETIC_BASE_FONT_SIZE) / KINETIC_BASE_FONT_SIZE,
    params: style.kinetic,
    // Same windows as KineticCaptionLayer's preview cut-out (display captions,
    // per-chunk override over the project default).
    behindWindows: behindWindows(display, !!style.behindPerson),
  };
}

/**
 * Everything the worker needs. Kinetic templates are ready immediately; the
 * others first measure the preview's caption layout in this document, which
 * takes a moment for long videos (`onPrepare` reports it).
 */
export async function buildDeviceExportJob(args: {
  exportId: string;
  source: Blob;
  width: number;
  height: number;
  durationSec: number;
  format: ExportFormat;
  style: ExportStyle;
  captions: Caption[];
  /** 'fast' caps the output at 30 fps (60 fps sources render in half the time). */
  frameRate?: ExportFrameRate;
  onPrepare?: (done: number, total: number) => void;
  signal?: AbortSignal;
}): Promise<ExportJob> {
  let overlay: OverlaySpec;
  let firstStart: number | undefined;
  if (isKineticTemplate(args.style.template)) {
    const kinetic = buildKineticOverlay(args.captions, args.style);
    overlay = kinetic;
    firstStart = kinetic.captions[0]?.start;
  } else {
    const track = await compileLayoutTrack({
      captions: args.captions,
      style: {
        template: args.style.template,
        fontFamily: args.style.fontFamily,
        fontSize: Number(args.style.fontSize) || 48,
        fontWeight: Number(args.style.fontWeight) || 700,
        color: args.style.color,
        backgroundColor: args.style.backgroundColor,
        highlightColor: args.style.highlightColor,
        activeFill: args.style.activeFill,
        textTransform: args.style.textTransform,
        position: args.style.position,
        offsetX: args.style.offsetX,
        offsetY: args.style.offsetY,
        animation: args.style.animation,
        displayMode: args.style.displayMode,
        displayWords: args.style.displayWords,
      },
      width: args.width,
      height: args.height,
      onProgress: args.onPrepare,
      signal: args.signal,
    });
    overlay = { kind: 'layout', track, fonts: await resolveFontSources(track) };
    firstStart = track.captions[0]?.start;
  }
  // Thumbnail once the first caption has settled (entry animations take ~1 s).
  const wanted = firstStart !== undefined ? firstStart + 1.2 : 1;
  const thumbnailAt =
    args.durationSec > 0 ? Math.max(0, Math.min(wanted, args.durationSec * 0.9)) : wanted;
  return {
    jobId: args.exportId,
    source: args.source,
    outputPath: `exports/${args.exportId}.${args.format}`,
    format: args.format,
    width: args.width,
    height: args.height,
    videoQuantizer: exportVideoQuantizer(args.format),
    videoBitrate: exportVideoBitrate(args.format, args.width, args.height),
    frameRate: args.frameRate === 'original' ? undefined : FAST_EXPORT_FPS,
    overlay,
    fontsBase: FONT_URL_BASE,
    thumbnailAt,
  };
}

/* ------------------------------------------------------------------- runner */

export class DeviceExportError extends Error {
  readonly code: ExportErrorCode;
  constructor(code: ExportErrorCode, message: string) {
    super(message);
    this.name = 'DeviceExportError';
    this.code = code;
  }
}

export interface DeviceExportProgress {
  stage: ExportStage;
  percent: number;
  processedSec?: number;
}

export interface DeviceExportHandle {
  promise: Promise<ExportResult>;
  cancel(): void;
}

/** How long a cancelled worker gets to clean up before it is terminated. */
const CANCEL_GRACE_MS = 2000;

export function startDeviceExport(
  job: ExportJob,
  onProgress: (p: DeviceExportProgress) => void,
): DeviceExportHandle {
  const worker = new Worker(new URL('./export.worker.ts', import.meta.url), { type: 'module' });
  let settled = false;
  let rejectOuter: (err: DeviceExportError) => void = () => {};

  const finish = () => {
    settled = true;
    worker.terminate();
  };

  const promise = new Promise<ExportResult>((resolve, reject) => {
    rejectOuter = reject;
    worker.onmessage = (e: MessageEvent<ExportWorkerOut>) => {
      if (settled) return;
      const msg = e.data;
      if (msg.type === 'progress') {
        onProgress({ stage: msg.stage, percent: msg.percent, processedSec: msg.processedSec });
      } else if (msg.type === 'done') {
        finish();
        resolve(msg.result);
      } else if (msg.type === 'error') {
        finish();
        reject(new DeviceExportError(msg.code, msg.message));
      }
    };
    worker.onerror = (e) => {
      if (settled) return;
      e.preventDefault();
      finish();
      void removeLocalFile(job.outputPath);
      reject(new DeviceExportError('FAILED', e.message || 'The export worker stopped unexpectedly'));
    };
    worker.onmessageerror = () => {
      if (settled) return;
      finish();
      reject(new DeviceExportError('FAILED', 'The export worker sent an unreadable message'));
    };
  });

  const start: ExportWorkerIn = { type: 'start', job };
  worker.postMessage(start);

  return {
    promise,
    cancel() {
      if (settled) return;
      const msg: ExportWorkerIn = { type: 'cancel' };
      worker.postMessage(msg);
      // The worker normally answers with a CANCELLED error within a frame or
      // two; if it is wedged in a long encoder call, stop it hard.
      setTimeout(() => {
        if (settled) return;
        finish();
        void removeLocalFile(job.outputPath);
        rejectOuter(new DeviceExportError('CANCELLED', 'Export cancelled'));
      }, CANCEL_GRACE_MS);
    },
  };
}

/** "Rendering… 42% · about 12 s left" */
export function describeDeviceProgress(p: DeviceExportProgress, startedAt: number): string {
  if (p.stage === 'fonts') return 'Loading caption fonts…';
  if (p.stage === 'prepare') return 'Preparing the video…';
  if (p.stage === 'matte') return 'Preparing text behind person…';
  if (p.stage === 'finalize') return 'Finishing the file…';
  const pct = Math.max(0, Math.min(99, Math.round(p.percent)));
  const elapsed = (performance.now() - startedAt) / 1000;
  // Estimate from render progress only once there is enough signal.
  const renderShare = (p.percent - 4) / 94;
  if (renderShare > 0.05 && elapsed > 1.5) {
    const left = Math.max(0, (elapsed / renderShare) * (1 - renderShare));
    return `Rendering… ${pct}% · about ${formatSeconds(left)} left`;
  }
  return `Rendering… ${pct}%`;
}

/* ------------------------------------------------------------ server calls */

export async function authorizeDeviceExport(
  projectId: string,
  body: { quality: ExportQuality; format: ExportFormat; template: string; width: number; height: number },
): Promise<void> {
  await api.post(`/projects/${projectId}/export/device/authorize`, body);
}

export async function completeDeviceExport(
  projectId: string,
  result: ExportResult,
  meta: { quality: ExportQuality; format: ExportFormat; template: string; templateKey?: string },
): Promise<void> {
  await api.post(`/projects/${projectId}/export/device/complete`, {
    ...meta,
    width: result.width,
    height: result.height,
    sizeBytes: result.sizeBytes,
    durationSec: Number(result.durationSec.toFixed(3)),
    renderMs: result.renderMs,
    frames: result.frames,
    videoCodec: result.videoCodec,
    audio: result.audio,
    audioCodec: result.audioCodec,
    fingerprintMismatch: result.fingerprintMismatch.slice(0, 20),
  });
}

/** Best effort — never throws. */
export async function reportDeviceExportFailure(
  projectId: string,
  body: { code: string; message?: string; fallback: boolean },
): Promise<void> {
  await api
    .post(`/projects/${projectId}/export/device/failed`, {
      ...body,
      message: body.message?.slice(0, 500),
    })
    .catch(() => undefined);
}

/* --------------------------------------------------------- local deliveries */

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function saveDeviceExportRecord(args: {
  id: string;
  projectId: string;
  title: string;
  template: string;
  quality: ExportQuality;
  format: ExportFormat;
  result: ExportResult;
  language?: string;
}): Promise<LocalExportRecord> {
  const record: LocalExportRecord = {
    id: args.id,
    projectId: args.projectId,
    title: args.title,
    template: args.template,
    quality: args.quality,
    format: args.format,
    width: args.result.width,
    height: args.result.height,
    duration: args.result.durationSec,
    exportedAt: Date.now(),
    thumbnailDataUrl: args.result.thumbnail
      ? await blobToDataUrl(args.result.thumbnail).catch(() => '')
      : '',
    fileSize: args.result.sizeBytes,
    opfsPath: args.result.outputPath,
    language: args.language,
  };
  await saveExportRecord(record);
  return record;
}

/** <project>-<quality>.<ext>, without the uploaded file's own extension
 *  (a project named "clip.mp4" downloads as "clip-1080p.mp4", not "clip.mp4-1080p.mp4"). */
export function exportFileName(projectName: string, quality: string, format: string): string {
  const base = (projectName || 'video').replace(/\.(mp4|m4v|mov|webm|mkv|avi|flv)$/i, '') || 'video';
  return `${base.replace(/[^\w.-]+/g, '_')}-${quality}.${format}`;
}

/**
 * Hand a file stored on this device to the browser's download manager. The
 * File is disk-backed, so even a large render is never copied into memory.
 */
export async function downloadLocalFile(opfsPath: string, fileName: string): Promise<void> {
  const file = await getExportFile(opfsPath);
  if (!file) throw new Error('This export is no longer available - render it again');
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/* ------------------------------------------------------------------ format */

export function formatSeconds(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '-';
  if (sec < 10) return `${sec.toFixed(1)} s`;
  if (sec < 60) return `${Math.round(sec)} s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m} min ${s.toString().padStart(2, '0')} s`;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
