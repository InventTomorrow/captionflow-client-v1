/**
 * clips/projectAssets.ts — per-project things a clip preview needs (playable
 * source, captions, style), loaded on first hover and cached for the page's
 * life, so a gallery of many projects only touches the ones being watched.
 */
import { api, API_URL } from '../api';
import { getSourceFile } from '../media/localMedia';
import type { EditorStyle } from '../export/styleSnapshot';
import type { Caption } from '../../stores/captionStore';
import { projectCaptions } from './renderClip';

export interface ProjectAssets {
  /** null = nothing playable on this device. */
  url: string | null;
  local: boolean;
  credentials: boolean;
  captions: Caption[];
  style: Partial<EditorStyle>;
}

const cache = new Map<string, Promise<ProjectAssets>>();

export function loadProjectAssets(projectId: string, videoKind?: string): Promise<ProjectAssets> {
  let p = cache.get(projectId);
  if (!p) {
    p = (async () => {
      const [file, captions, style] = await Promise.all([
        getSourceFile(projectId).catch(() => null),
        projectCaptions(projectId).catch(() => [] as Caption[]),
        api
          .get(`/projects/${projectId}`)
          .then((r) => (r.data?.project?.style ?? {}) as Partial<EditorStyle>)
          .catch(() => ({}) as Partial<EditorStyle>),
      ]);
      if (file) return { url: URL.createObjectURL(file), local: true, credentials: false, captions, style };
      const server = videoKind && videoKind !== 'audio';
      return { url: server ? `${API_URL}/api/projects/${projectId}/video` : null, local: false, credentials: !!server, captions, style };
    })();
    p.catch(() => cache.delete(projectId));
    cache.set(projectId, p);
  }
  return p;
}

/** Forget a project's cached assets (e.g. after "Locate file" stored the original). */
export function forgetProjectAssets(projectId: string) {
  const p = cache.get(projectId);
  cache.delete(projectId);
  void p?.then((a) => a.local && a.url && URL.revokeObjectURL(a.url)).catch(() => undefined);
}
