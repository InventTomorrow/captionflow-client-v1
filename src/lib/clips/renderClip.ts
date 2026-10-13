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
import { api } from '../api';
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
import { evictOldExportsIfNeeded, getSourceFile, getSourceRecord, type LocalExportRecord } from '../media/localMedia';
import { probeMediaFile } from '../media/probe';
import { exportFrameSize, type ExportFormat, type ExportQuality } from '../render/frame';
import type { Caption } from '../../stores/captionStore';
import { authorizeClipRender, completeClipRender, failClipRender, finishCaptions, type Clip } from './api';
import { ensureFaceTrack, needsFaceTrack } from './autoFrame';
import { clipAspect, clipStyle, cropTrackFor, deferredIn, type TimeRange } from './clipMath';

export interface ClipRenderContext {
  projectId: string;
  projectName: string;
  /** The project's saved caption style (Project.style). */
  projectStyle: Partial<EditorStyle>;
  /** Called when the render had to save something on the clip first (its face track). */
  onClipUpdated?: (clip: Clip) => void;
}

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
  let clip = clipIn;
  const promise = (async () => {
    const blocker = deviceExportBlocker();
    if (blocker) throw new ClipRenderError('UNSUPPORTED', blocker);
    const source = await getSourceFile(ctx.projectId);
    if (!source) throw new ClipRenderError('NO_SOURCE', 'The original video isn’t on this device');
    const style = clipStyle(ctx.projectStyle, clip);
    if (!isDeviceExportTemplate(style.template)) {
      throw new ClipRenderError('UNSUPPORTED', 'This caption style can’t be rendered on this device yet — pick another');
    }
    const captions = await projectCaptions(ctx.projectId, [clip]);
    if (!captions.length) throw new ClipRenderError('NO_CAPTIONS', 'This video has no captions yet');

    const probe = (await getSourceRecord(ctx.projectId))?.probe ?? (await probeMediaFile(source));
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
      onProgress({ stage: 'prepare', percent: 1 });
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
      captions,
      trim: { start: clip.start, end: clip.end },
      framing: track ? { mode: 'cover', track } : { mode: 'contain' },
    });
    if (cancelled) throw new ClipRenderError('CANCELLED', 'Cancelled');
    const handle = startDeviceExport(job, onProgress);
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
      cancelInner?.();
    },
  };
}
