/**
 * How long project data is kept, and what deleting a video removes.
 *
 * A project's captions, original video and exported videos are kept until the
 * user deletes the project's last video from Recent Videos, or for at most
 * 30 days. The server keeps its caption copy on the same schedule
 * (CAPTIONS_CACHE_TTL_HOURS / TRANSCRIPT_TTL_DAYS). Files already saved to the
 * user's Downloads folder are outside the browser's reach and never touched.
 */

import { api } from '../api';
import { deleteAllForProject } from '../captionDb';
import { deleteExport, deleteSource, listExports, listSources, type LocalExportRecord } from './localMedia';

export const LOCAL_RETENTION_DAYS = 30;

/** Remove this browser's captions and original video for a project, and the server's caption copy. */
async function forgetProject(projectId: string, alsoServer: boolean): Promise<void> {
  await deleteSource(projectId).catch(() => undefined);
  await deleteAllForProject(projectId).catch(() => undefined);
  if (alsoServer) await api.delete(`/projects/${projectId}/captions`).catch(() => undefined);
}

/** True when the given export is the only one left for its project. */
export async function isLastVideoOfProject(item: LocalExportRecord): Promise<boolean> {
  const all = await listExports();
  return !all.some((x) => x.projectId === item.projectId && x.id !== item.id);
}

/**
 * Delete one video from Recent Videos. When it was the project's last video,
 * the project's captions go with it — here and on the server.
 */
export async function deleteVideo(item: LocalExportRecord): Promise<void> {
  const last = await isLastVideoOfProject(item);
  await deleteExport(item.id);
  if (last) await forgetProject(item.projectId, true);
}

/**
 * Drop everything older than the retention window: exported videos past
 * 30 days, and original videos + captions of projects stored more than
 * 30 days ago that have no newer video left. Returns how many items went.
 */
export async function expireOldLocalMedia(now = Date.now()): Promise<number> {
  const cutoff = now - LOCAL_RETENTION_DAYS * 86400_000;
  let removed = 0;

  const exports = await listExports();
  for (const item of exports) {
    if (item.exportedAt < cutoff) {
      await deleteExport(item.id).catch(() => undefined);
      removed++;
    }
  }

  const liveProjects = new Set(exports.filter((x) => x.exportedAt >= cutoff).map((x) => x.projectId));
  for (const source of await listSources()) {
    if (source.storedAt < cutoff && !liveProjects.has(source.projectId)) {
      // The server's copy expires on its own schedule; nothing to call.
      await forgetProject(source.projectId, false);
      removed++;
    }
  }
  return removed;
}
