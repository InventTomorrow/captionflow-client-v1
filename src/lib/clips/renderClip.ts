/**
 * clips/renderClip.ts — render one clip to a vertical MP4 on this device, and
 * the "Render all" queue (strictly one render at a time: each render already
 * keeps the GPU encoder and a worker busy).
 *
 * Same pipeline as the editor's export (buildDeviceExportJob + export.worker):
 * the project's captions cut to the clip (sliceCaptionsToRange, inside the
 * job builder), the clip's style (clipMath.clipStyle), its framing
 * (cropTrackFor). The server only checks the plan and counts the render.
 */
import { api, errorMessage } from '../api';
import { getAllForProject, replaceAllForProject } from '../captionDb';
import {
  buildDeviceExportJob,
  deviceExportBlocker,
  isDeviceExportTemplate,
  saveDeviceExportRecord,
  startDeviceExport,
  type DeviceExportProgress,
  type ExportStyle,
} from '../export/clientExport';
import type { EditorStyle } from '../export/styleSnapshot';
import { evictOldExportsIfNeeded, type LocalExportRecord } from '../media/localMedia';
import { probeMediaFile } from '../media/probe';
import { exportFrameSize, type ExportFormat, type ExportQuality } from '../render/frame';
import type { Caption } from '../../stores/captionStore';
import { authorizeClipRender, completeClipRender, failClipRender, finishCaptions, type Clip } from './api';
import { ensureFaceTrack, needsFaceTrack } from './autoFrame';
import { shiftCaptions } from './clipClock';
import { clipMedia } from './clipMedia';
import { clipAspect, clipStyle, cropTrackFor, deferredIn, type TimeRange } from './clipMath';

export interface ClipRenderContext {
  projectId: string;
  projectName: string;
  /** The project's saved caption style (Project.style). */
  projectStyle: Partial<EditorStyle>;
  /** The video came from a pasted link: this clip's part of it is fetched first when not on this device. */
  imported?: boolean;
  /** The source's length in seconds (bounds the part asked for). */
  duration?: number;
  /** Called when the render had to save something on the clip first (its face track). */
  onClipUpdated?: (clip: Clip) => void;
}

/** Share of the progress bar a clip part's download takes before its render. */
const DOWNLOAD_SHARE = 30;

export interface ClipRenderOptions {
  quality: ExportQuality;
  format: ExportFormat;
}

export type ClipRenderErrorCode = 'NO_SOURCE' | 'NO_CAPTIONS' | 'UNSUPPORTED' | 'CANCELLED' | 'FAILED';

export class ClipRenderError extends Error {
  readonly code: ClipRenderErrorCode;
  constructor(code: ClipRenderErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * The project's captions: this browser's copy, else the server's cache (then
 * kept locally). A New Clips video translates captions only where they are
 * needed, so captions still waiting inside `ranges` are finished first (on
 * the server, once) — a clip trimmed longer shows its new sentences finished.
 */
export async function projectCaptions(projectId: string, ranges: TimeRange[] = []): Promise<Caption[]> {
  let caps = await getAllForProject(projectId).catch(() => [] as Caption[]);
  if (caps.length && !deferredIn(caps, ranges)) return caps;
  // Another browser / cleared storage, or a copy older than the finished one:
  // the server keeps a copy for exactly this.
  const { data } = await api.get<{ captions: Caption[] }>(`/projects/${projectId}/captions-cache`);
  caps = data?.captions ?? [];
  if (deferredIn(caps, ranges)) caps = await finishCaptions(projectId, ranges);
  if (caps.length) await replaceAllForProject(projectId, caps).catch(() => undefined);
  return caps;
}

export interface ClipRenderHandle {
  promise: Promise<LocalExportRecord>;
  cancel(): void;
}

export function renderClip(
  clipIn: Clip,
  ctx: ClipRenderContext,
  opts: ClipRenderOptions,
  onProgress: (p: DeviceExportProgress) => void,
): ClipRenderHandle {
  let cancelInner: (() => void) | null = null;
  let cancelled = false;
  const stop = new AbortController();
  let clip = clipIn;
  const promise = (async () => {
    const blocker = deviceExportBlocker();
    if (blocker) throw new ClipRenderError('UNSUPPORTED', blocker);
    const style = clipStyle(ctx.projectStyle, clip);
    if (!isDeviceExportTemplate(style.template)) {
      throw new ClipRenderError('UNSUPPORTED', 'This caption style can’t be rendered on this device yet — pick another');
    }
    const captions = await projectCaptions(ctx.projectId, [clip]);
    if (!captions.length) throw new ClipRenderError('NO_CAPTIONS', 'This video has no captions yet');

    // The original on this device, or — a linked video — just this clip's part, fetched now.
    const media = await clipMedia(ctx.projectId, clip, {
      imported: ctx.imported,
      duration: ctx.duration,
      signal: stop.signal,
      onProgress: (pct) => onProgress({ stage: 'download', percent: pct, overall: (pct * DOWNLOAD_SHARE) / 100 }),
    }).catch((err: unknown) => {
      if ((err as { name?: string }).name === 'AbortError') throw new ClipRenderError('CANCELLED', 'Cancelled');
      throw new ClipRenderError('NO_SOURCE', errorMessage(err, 'This clip’s part of the video couldn’t be fetched — try again.'));
    });
    if (!media) throw new ClipRenderError('NO_SOURCE', 'The original video isn’t on this device');
    if (cancelled) throw new ClipRenderError('CANCELLED', 'Cancelled');
    const source = media.file;
    const offset = media.offset;
    // After a download the render fills the rest of the bar.
    const report = media.fetched
      ? (p: DeviceExportProgress) => onProgress({ ...p, overall: DOWNLOAD_SHARE + (p.percent * (100 - DOWNLOAD_SHARE)) / 100 })
      : onProgress;

    const probe = media.probe ?? (await probeMediaFile(source));
    const { width, height } = exportFrameSize(opts.quality, clipAspect(clip), probe?.width ?? 0, probe?.height ?? 0);
    await authorizeClipRender(clip._id, {
      quality: opts.quality,
      format: opts.format,
      width,
      height,
      template: style.template,
    });
    if (cancelled) throw new ClipRenderError('CANCELLED', 'Cancelled');
    await evictOldExportsIfNeeded(80).catch(() => 0);
    // Auto framing never renders a centre crop by accident: track the face first.
    if (needsFaceTrack(clip)) {
      report({ stage: 'prepare', percent: 1 });
      const tracked = await ensureFaceTrack(ctx.projectId, clip).catch(() => null);
      if (tracked) {
        clip = tracked;
        ctx.onClipUpdated?.(tracked);
      }
    }

    const track = cropTrackFor(clip);
    const job = await buildDeviceExportJob({
      exportId: `clip-${clip._id}-${Date.now().toString(36)}`,
      source,
      width,
      height,
      durationSec: clip.end - clip.start,
      format: opts.format,
      style: style as ExportStyle,
      // A part of a linked video starts at `offset`: clip times and captions move onto its own timeline.
      captions: offset ? shiftCaptions(captions, -offset) : captions,
      trim: { start: clip.start - offset, end: clip.end - offset },
      framing: track ? { mode: 'cover', track } : { mode: 'contain' },
    });
    if (cancelled) throw new ClipRenderError('CANCELLED', 'Cancelled');
    const handle = startDeviceExport(job, report);
    cancelInner = handle.cancel;
    const result = await handle.promise;
    const record = await saveDeviceExportRecord({
      id: job.jobId,
      projectId: ctx.projectId,
      title: `${clip.title || ctx.projectName} (clip)`,
      template: style.template,
      quality: opts.quality,
      format: opts.format,
      result,
      clipId: clip._id,
    });
    await completeClipRender(clip._id, {
      quality: opts.quality,
      format: opts.format,
      sizeBytes: result.sizeBytes,
      durationSec: result.durationSec,
      renderMs: result.renderMs,
      templateKey: style.templateKey || undefined,
      template: style.template,
    }).catch(() => undefined); // bookkeeping only — the file is already on the device
    return record;
  })().catch((err: unknown) => {
    const e = err as { code?: string; message?: string };
    void failClipRender(clip._id, { code: e.code ?? 'FAILED', message: e.message?.slice(0, 400) });
    throw err;
  });
  return {
    promise,
    cancel() {
      cancelled = true;
      stop.abort();
      cancelInner?.();
    },
  };
}
