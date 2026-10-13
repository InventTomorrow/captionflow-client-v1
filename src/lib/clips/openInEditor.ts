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
import { getAllForProject, replaceAllForProject } from '../captionDb';
import { buildDeviceExportJob, deviceExportBlocker, startDeviceExport, type ExportStyle } from '../export/clientExport';
import type { EditorStyle } from '../export/styleSnapshot';
import { getExportFile, getSourceFile, getSourceRecord, removeLocalFile, storeSourceFile } from '../media/localMedia';
import { probeMediaFile } from '../media/probe';
import { exportFrameSize } from '../render/frame';
import { openClipProject, type Clip } from './api';
import { ensureFaceTrack, needsFaceTrack } from './autoFrame';
import { clipAspect, clipStyle, cropTrackFor, type ClipAspect } from './clipMath';
import { clipChanges, clipEditBasis, clipProjectCaptions } from './clipProject';
import type { CropTrack } from './cropTrack';
import type { Caption } from '../../stores/captionStore';
import { projectCaptions } from './renderClip';

export type OpenStage = 'framing' | 'cutting' | 'saving' | 'opening';
export type OpenProgress = (stage: OpenStage, percent?: number) => void;

/** The clip's editor project, ready to open. */
export type OpenResult = { projectId: string };

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
 * Open a clip in the editor: make its project the first time, reopen it after
 * that. A clip changed on the clips page since (trim, format, framing,
 * template) is applied to that project on the way, without asking: a new trim
 * brings the clip's captions again and a new cut; a new format or framing a
 * new cut (caption edits kept); a new template the new look.
 */
export async function openClipInEditor(
  projectId: string,
  clipIn: Clip,
  opts: { onProgress?: OpenProgress; onClipUpdated?: (c: Clip) => void } = {},
): Promise<OpenResult> {
  const { onProgress } = opts;
  let clip = clipIn;

  // Frame on the speaker first (never a centre crop by accident).
  if (needsFaceTrack(clip)) {
    onProgress?.('framing');
    const tracked = await ensureFaceTrack(projectId, clip).catch(() => null);
    if (tracked) {
      clip = tracked;
      opts.onClipUpdated?.(tracked);
    }
  }
  const basisKey = clipEditBasis(clip);
  const sourceStyle = () =>
    api.get(`/projects/${projectId}`).then((r) => (r.data?.project?.style ?? {}) as Partial<EditorStyle>);
  const cutNow = () => {
    onProgress?.('cutting', 0);
    return cutClipVideo(
      { sourceProjectId: projectId, start: clip.start, end: clip.end, aspect: clipAspect(clip), crop: clip.crop, name: clip.title || 'clip' },
      (p) => onProgress?.('cutting', p),
    );
  };

  // Reopen the clip's project, applying what changed on the clip since.
  const editId = clip.editProjectId;
  const editProject = editId
    ? await api
        .get(`/projects/${editId}`)
        .then((r) => r.data?.project as { style?: Partial<EditorStyle>; video?: { width: number; height: number; duration: number; size?: number } })
        .catch((e) => (e?.response?.status === 404 ? null : Promise.reject(e)))
    : null;
  if (editId && editProject) {
    const changed = clipChanges(clip.editBasisKey, basisKey);
    const haveVideo = !!(await getSourceFile(editId).catch(() => null));
    if (!changed.range && !changed.frame && !changed.look) {
      if (!haveVideo) await recutClipProject(editId, onProgress);
      return { projectId: editId };
    }
    const cut = changed.frame || !haveVideo ? await cutNow() : null;
    onProgress?.('saving');
    let captions: Caption[];
    if (changed.range) {
      captions = clipProjectCaptions(await projectCaptions(projectId), clip);
    } else {
      captions = await getAllForProject(editId);
      if (!captions.length) captions = await projectCaptions(editId);
    }
    const style = changed.look
      ? clipStyle(await sourceStyle(), clip)
      : { ...(editProject.style ?? {}), aspectRatio: clipAspect(clip) };
    const video = cut
      ? { width: cut.width, height: cut.height, duration: cut.duration, size: cut.file.size }
      : {
          width: editProject.video?.width ?? 0,
          height: editProject.video?.height ?? 0,
          duration: editProject.video?.duration ?? clip.end - clip.start,
          size: editProject.video?.size ?? 0,
        };
    await openClipProject(clip._id, { style, captions, video, basisKey, refresh: true });
    if (cut) await storeCut(editId, cut);
    if (changed.range) await replaceAllForProject(editId, captions);
    opts.onClipUpdated?.({ ...clip, editBasisKey: basisKey });
    onProgress?.('opening');
    return { projectId: editId };
  }

  // Make it.
  const [captions, projectStyle] = await Promise.all([projectCaptions(projectId), sourceStyle()]);
  const cut = await cutNow();
  onProgress?.('saving');
  const copy = clipProjectCaptions(captions, clip);
  const res = await openClipProject(clip._id, {
    style: clipStyle(projectStyle, clip),
    captions: copy,
    video: { width: cut.width, height: cut.height, duration: cut.duration, size: cut.file.size },
    basisKey,
  });
  await storeCut(res.projectId, cut);
  if (!res.existing) await replaceAllForProject(res.projectId, copy);
  opts.onClipUpdated?.({ ...clip, editProjectId: res.projectId, editBasisKey: res.existing ? (res.basisKey ?? basisKey) : basisKey });
  onProgress?.('opening');
  return { projectId: res.projectId };
}
