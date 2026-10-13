/**
 * clips/openInEditor.ts — "Open in editor": the clip as its own editor project.
 *
 * Nothing is cut: the project plays the ORIGINAL video through the clip clock
 * (clipClock.ts) — only the clip's range, cropped live to the clip's framing —
 * and the render trims and crops at export time. Opening makes the project the
 * first time (the clip's captions copied from 0:00, its look as the style) and
 * reopens it after that, applying anything changed on the clip since. Nothing
 * is transcribed, translated or regenerated, and nothing is stored but the
 * captions copy.
 */
import { api } from '../api';
import { getAllForProject, replaceAllForProject } from '../captionDb';
import type { EditorStyle } from '../export/styleSnapshot';
import { deleteSource, getSourceFile } from '../media/localMedia';
import type { Caption } from '../../stores/captionStore';
import { openClipProject, type Clip } from './api';
import { ensureFaceTrack, needsFaceTrack } from './autoFrame';
import { clipAspect, clipStyle } from './clipMath';
import { clipChanges, clipEditBasis, clipProjectCaptions } from './clipProject';
import { projectCaptions } from './renderClip';

export type OpenStage = 'framing' | 'saving' | 'opening';
export type OpenProgress = (stage: OpenStage) => void;

/** The clip's editor project, ready to open. */
export type OpenResult = { projectId: string };

/** A failure on this device (shown as is — not a network error). */
export class OpenInEditorError extends Error {}

type SourceProject = { style?: Partial<EditorStyle>; video?: { width?: number; height?: number; originalSize?: number; size?: number } };

const NO_CAPTIONS = 'This clip has no captions on this device yet — open its video once so they load, then try again.';

/**
 * Open a clip in the editor: make its project the first time, reopen it after
 * that. A clip changed on the clips page since (trim, format, framing,
 * template) is applied to that project on the way, without asking: a new trim
 * brings the clip's captions again; a new template the new look; a new format
 * or framing the new crop (caption edits kept).
 */
export async function openClipInEditor(
  projectId: string,
  clipIn: Clip,
  opts: { onProgress?: OpenProgress; onClipUpdated?: (c: Clip) => void } = {},
): Promise<OpenResult> {
  const { onProgress } = opts;
  let clip = clipIn;

  // Auto framing follows the speaker: track the face first (once per clip range).
  if (needsFaceTrack(clip) && (await getSourceFile(projectId).catch(() => null))) {
    onProgress?.('framing');
    const tracked = await ensureFaceTrack(projectId, clip).catch(() => null);
    if (tracked) {
      clip = tracked;
      opts.onClipUpdated?.(tracked);
    }
  }
  const basisKey = clipEditBasis(clip);
  const source = () => api.get(`/projects/${projectId}`).then((r) => (r.data?.project ?? {}) as SourceProject);
  const videoOf = (s: SourceProject) => ({
    // The editor plays the original: its frame, the clip's length.
    width: Number(s.video?.width) || 1920,
    height: Number(s.video?.height) || 1080,
    duration: +(clip.end - clip.start).toFixed(3),
    size: Number(s.video?.originalSize ?? s.video?.size) || 0,
  });

  // Reopen the clip's project, applying what changed on the clip since.
  const editId = clip.editProjectId;
  const editProject = editId
    ? await api
        .get(`/projects/${editId}`)
        .then((r) => r.data?.project as { style?: Partial<EditorStyle> } | undefined)
        .catch((e) => (e?.response?.status === 404 ? null : Promise.reject(e)))
    : null;
  if (editId && editProject) {
    // Projects from before clips played their original kept a cut copy on the device: free it.
    void deleteSource(editId).catch(() => undefined);
    const changed = clipChanges(clip.editBasisKey, basisKey);
    if (!changed.range && !changed.frame && !changed.look) return { projectId: editId };
    onProgress?.('saving');
    let captions: Caption[];
    if (changed.range) {
      captions = clipProjectCaptions(await projectCaptions(projectId), clip);
    } else {
      captions = await getAllForProject(editId);
      if (!captions.length) captions = await projectCaptions(editId);
    }
    if (!captions.length) throw new OpenInEditorError(NO_CAPTIONS);
    const src = await source();
    const style = changed.look
      ? clipStyle(src.style ?? {}, clip)
      : { ...(editProject.style ?? {}), aspectRatio: clipAspect(clip) };
    await openClipProject(clip._id, { style, captions, video: videoOf(src), basisKey, refresh: true });
    if (changed.range) await replaceAllForProject(editId, captions);
    opts.onClipUpdated?.({ ...clip, editBasisKey: basisKey });
    onProgress?.('opening');
    return { projectId: editId };
  }

  // Make it.
  onProgress?.('saving');
  const [captions, src] = await Promise.all([projectCaptions(projectId), source()]);
  const copy = clipProjectCaptions(captions, clip);
  if (!copy.length) throw new OpenInEditorError(NO_CAPTIONS);
  const res = await openClipProject(clip._id, {
    style: clipStyle(src.style ?? {}, clip),
    captions: copy,
    video: videoOf(src),
    basisKey,
  });
  if (!res.existing) await replaceAllForProject(res.projectId, copy);
  opts.onClipUpdated?.({ ...clip, editProjectId: res.projectId, editBasisKey: res.existing ? (res.basisKey ?? basisKey) : basisKey });
  onProgress?.('opening');
  return { projectId: res.projectId };
}
