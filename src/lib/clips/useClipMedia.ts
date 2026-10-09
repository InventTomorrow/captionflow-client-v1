/**
 * clips/useClipMedia.ts — what every Clips page needs about a project, loaded
 * once: a playable source URL (this device's copy, else the server stream for
 * full-video uploads), its captions, and its saved caption style.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, API_URL } from '../api';
import { getSourceFile } from '../media/localMedia';
import type { Caption } from '../../stores/captionStore';
import type { EditorStyle } from '../export/styleSnapshot';
import { projectCaptions } from './renderClip';

export interface ClipSource {
  /** Playable URL, or null while loading / when there is nothing to play. */
  url: string | null;
  /** True when the original file is on this device (previews + renders work). */
  local: boolean;
  /** Nothing to play on this device: an audio-only upload made elsewhere. */
  missing: boolean;
  loading: boolean;
  /** Re-check after "Locate file" stored the original. */
  reload(): void;
}

export function useClipSource(projectId: string | undefined, videoKind: string | undefined): ClipSource {
  const [state, setState] = useState({ url: null as string | null, local: false, missing: false, loading: true });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    setState((s) => ({ ...s, loading: true }));
    void (async () => {
      const file = await getSourceFile(projectId).catch(() => null);
      if (cancelled) return;
      if (file) {
        objectUrl = URL.createObjectURL(file);
        setState({ url: objectUrl, local: true, missing: false, loading: false });
      } else if (videoKind && videoKind !== 'audio') {
        setState({ url: `${API_URL}/api/projects/${projectId}/video`, local: false, missing: false, loading: false });
      } else if (videoKind) {
        setState({ url: null, local: false, missing: true, loading: false });
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [projectId, videoKind, nonce]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}

export function useProjectCaptions(projectId: string | undefined, ready: boolean) {
  const [captions, setCaptions] = useState<Caption[] | null>(null);
  useEffect(() => {
    if (!projectId || !ready) return;
    let cancelled = false;
    void projectCaptions(projectId)
      .then((c) => !cancelled && setCaptions(c))
      .catch(() => !cancelled && setCaptions([]));
    return () => {
      cancelled = true;
    };
  }, [projectId, ready]);
  return captions;
}

export function useProjectStyle(projectId: string | undefined) {
  const [style, setStyle] = useState<Partial<EditorStyle> | null>(null);
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    void api
      .get(`/projects/${projectId}`)
      .then((r) => !cancelled && setStyle((r.data?.project?.style ?? {}) as Partial<EditorStyle>))
      .catch(() => !cancelled && setStyle({}));
    return () => {
      cancelled = true;
    };
  }, [projectId]);
  return style;
}
