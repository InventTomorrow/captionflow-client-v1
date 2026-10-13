/**
 * clips/openInEditor.ts — "Open in editor": the clip as its own editor project.
 *
 * The first time, this device cuts the clip's range out of the original video
 * (framed exactly like the clip, no captions burned in) with the same renderer
 * clip renders use, the server makes a kind 'clip' project for it, and the
 * clip's captions (copied, from 0:00) and video are stored locally under that
 * project. After that the clip's project is just reopened. Nothing is
 * transcribed, translated or regenerated anywhere on the way.
 */
import { api } from '../api';
import { replaceAllForProject } from '../captionDb';
import { buildDeviceExportJob, deviceExportBlocker, startDeviceExport, type ExportStyle } from '../export/clientExport';
import type { EditorStyle } from '../export/styleSnapshot';
import { deleteSource, getExportFile, getSourceFile, getSourceRecord, removeLocalFile, storeSourceFile } from '../media/localMedia';
import { probeMediaFile } from '../media/probe';
import { exportFrameSize } from '../render/frame';
import { openClipProject, type Clip } from './api';
import { ensureFaceTrack, needsFaceTrack } from './autoFrame';
import { clipAspect, clipStyle, cropTrackFor, type ClipAspect } from './clipMath';
import { clipEditBasis, clipProjectCaptions } from './clipProject';
import type { CropTrack } from './cropTrack';
import { projectCaptions } from './renderClip';

export type OpenStage = 'framing' | 'cutting' | 'saving' | 'opening';
export type OpenProgress = (stage: OpenStage, percent?: number) => void;

/** opened: go to the editor. stale: the clip changed since its editor copy was made — ask first. */
export type OpenResult = { kind: 'opened'; projectId: string } | { kind: 'stale'; projectId: string };

export class OpenInEditorError extends Error {}

/** What to cut: a source range in one format and framing. */
interface CutSpec {
  sourceProjectId: string;
  start: number;
  end: number;
  aspect: ClipAspect;
  crop: { mode: 'auto' | 'manual' | 'none'; x: number; track?: CropTrack };
  name: string;
}

/** Cut the range out of the original as its own MP4 (framing baked in, no captions). */
async function cutClipVideo(spec: CutSpec, onProgress: (percent: number) => void) {
  const blocker = deviceExportBlocker();
  if (blocker) throw new OpenInEditorError(blocker);
  const source = await getSourceFile(spec.sourceProjectId);
  if (!source) throw new OpenInEditorError('The original video isn’t on this device — locate it on the clips page first.');
  const probe = (await getSourceRecord(spec.sourceProjectId))?.probe ?? (await probeMediaFile(source));
  const { width, height } = exportFrameSize('1080p', spec.aspect, probe?.width ?? 0, probe?.height ?? 0);
  const track = cropTrackFor({ crop: spec.crop, aspect: spec.aspect });
  const style = clipStyle({}, { aspect: spec.aspect });
  const job = await buildDeviceExportJob({
    exportId: `clipcut-${Date.now().toString(36)}`,
    source,
    width,
    height,
    durationSec: spec.end - spec.start,
    format: 'mp4',
    style: style as ExportStyle,
    captions: [],
    trim: { start: spec.start, end: spec.end },
    framing: track ? { mode: 'cover', track } : { mode: 'contain' },
  });
  const result = await startDeviceExport(job, (p) => onProgress(p.percent)).promise;
  const blob = await getExportFile(result.outputPath);
  if (!blob) throw new OpenInEditorError('Couldn’t read the cut video back from this device’s storage');
  const file = new File([blob], `${spec.name.replace(/[^\w\- ]+/g, '').trim() || 'clip'}.mp4`, { type: 'video/mp4' });
  return { file, outputPath: result.outputPath, width: result.width, height: result.height, duration: result.durationSec };
}

/** Store a cut as the clip project's video on this device. */
async function storeCut(projectId: string, cut: Awaited<ReturnType<typeof cutClipVideo>>) {
  const probe = await probeMediaFile(cut.file).catch(() => null);
  await storeSourceFile(projectId, cut.file, probe);
  await removeLocalFile(cut.outputPath).catch(() => undefined);
}

/**
 * A clip project opened on a device that doesn't have its video: cut it again
 * from the original (when that is here), exactly as it was first made.
 */
export async function recutClipProject(projectId: string, onProgress?: OpenProgress): Promise<void> {
  const { data } = await api.get(`/projects/${projectId}`);
  const src = data?.project?.clipSource as
    | { projectId: string; start: number; end: number; aspect?: ClipAspect; crop?: CutSpec['crop'] }
    | undefined;
  if (!src) throw new OpenInEditorError('This project wasn’t made from a clip');
  onProgress?.('cutting', 0);
  const cut = await cutClipVideo(
    {
      sourceProjectId: String(src.projectId),
      start: src.start,
      end: src.end,
      aspect: src.aspect === '16:9' ? '16:9' : '9:16',
      crop: { mode: src.crop?.mode ?? 'none', x: src.crop?.x ?? 0.5, track: src.crop?.track ?? [] },
      name: data.project.name ?? 'clip',
    },
    (p) => onProgress?.('cutting', p),
  );
  onProgress?.('saving');
  await storeCut(projectId, cut);
}

/** True when the original video of a clip project is on this device (it can be cut again here). */
export async function canRecutClipProject(sourceProjectId: string): Promise<boolean> {
  return !!(await getSourceFile(sourceProjectId).catch(() => null));
}

/**
 * Open a clip in the editor: reopen its project, or make it. `startOver`
 * replaces an existing copy (after the user chose to); `keepEdited` reopens a
 * copy made before the clip changed.
 */
export async function openClipInEditor(
  projectId: string,
  clipIn: Clip,
  opts: { startOver?: boolean; keepEdited?: boolean; onProgress?: OpenProgress; onClipUpdated?: (c: Clip) => void } = {},
): Promise<OpenResult> {
  const { onProgress } = opts;
  let clip = clipIn;

  // Reopen the clip's project.
  if (clip.editProjectId && !opts.startOver) {
    if (!opts.keepEdited && clip.editBasisKey && clip.editBasisKey !== clipEditBasis(clip)) {
      return { kind: 'stale', projectId: clip.editProjectId };
    }
    const exists = await api
      .get(`/projects/${clip.editProjectId}`)
      .then(() => true)
      .catch((e) => (e?.response?.status === 404 ? false : Promise.reject(e)));
    if (exists) {
      if (!(await getSourceFile(clip.editProjectId).catch(() => null))) await recutClipProject(clip.editProjectId, onProgress);
      return { kind: 'opened', projectId: clip.editProjectId };
    }
  }

  // Make it: frame on the speaker first (never a centre crop by accident), then cut.
  if (needsFaceTrack(clip)) {
    onProgress?.('framing');
    const tracked = await ensureFaceTrack(projectId, clip).catch(() => null);
    if (tracked) {
      clip = tracked;
      opts.onClipUpdated?.(tracked);
    }
  }
  const [captions, projectStyle] = await Promise.all([
    projectCaptions(projectId),
    api.get(`/projects/${projectId}`).then((r) => (r.data?.project?.style ?? {}) as Partial<EditorStyle>),
  ]);
  onProgress?.('cutting', 0);
  const cut = await cutClipVideo(
    {
      sourceProjectId: projectId,
      start: clip.start,
      end: clip.end,
      aspect: clipAspect(clip),
      crop: clip.crop,
      name: clip.title || 'clip',
    },
    (p) => onProgress?.('cutting', p),
  );
  onProgress?.('saving');
  const copy = clipProjectCaptions(captions, clip);
  const basisKey = clipEditBasis(clip);
  const res = await openClipProject(clip._id, {
    style: clipStyle(projectStyle, clip),
    captions: copy,
    video: { width: cut.width, height: cut.height, duration: cut.duration, size: cut.file.size },
    basisKey,
    ...(opts.startOver ? { force: true } : {}),
  });
  const newId = res.projectId;
  await storeCut(newId, cut);
  if (!res.existing) await replaceAllForProject(newId, copy);
  // Starting over: the old copy's video and captions on this device go too.
  if (opts.startOver && clip.editProjectId && clip.editProjectId !== newId) {
    await deleteSource(clip.editProjectId).catch(() => undefined);
    await replaceAllForProject(clip.editProjectId, []).catch(() => undefined);
  }
  opts.onClipUpdated?.({ ...clip, editProjectId: newId, editBasisKey: res.existing ? (res.basisKey ?? basisKey) : basisKey });
  onProgress?.('opening');
  return { kind: 'opened', projectId: newId };
}
