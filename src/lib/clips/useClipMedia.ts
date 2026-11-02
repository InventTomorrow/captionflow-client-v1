/**
 * clips/useClipMedia.ts — what every Clips page needs about a project, loaded
 * once: a playable source URL (this device's copy, else the server stream for
 * full-video uploads), its captions, and its saved caption style. A video from
 * a pasted link has no whole copy anywhere: each clip plays from its own part
 * (useClipPart), fetched only when that clip is worked on.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, API_URL, errorMessage } from '../api';
import { getSourceFile, getSourceRecord } from '../media/localMedia';
import type { Caption } from '../../stores/captionStore';
import type { EditorStyle } from '../export/styleSnapshot';
import { clipMedia, localClipMedia, type ClipMedia } from './clipMedia';
import type { TimeRange } from './clipMath';
import { projectCaptions } from './renderClip';

export interface ClipSource {
  /** Playable URL, or null while loading / when there is nothing to play. */
  url: string | null;
  /** True when the original file is on this device (previews + renders work). */
  local: boolean;
  /** Nothing to play on this device: an audio-only upload made elsewhere. */
  missing: boolean;
  /** A video from a pasted link: each clip's part is fetched when it is worked on. */
  remote: boolean;
  loading: boolean;
  /** Re-check after "Locate file" stored the original. */
  reload(): void;
}

export function useClipSource(projectId: string | undefined, videoKind: string | undefined, imported = false): ClipSource {
  const [state, setState] = useState({ url: null as string | null, local: false, missing: false, remote: false, loading: true });
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
        setState({ url: objectUrl, local: true, missing: false, remote: false, loading: false });
      } else if (imported) {
        setState({ url: null, local: false, missing: false, remote: true, loading: false });
      } else if (videoKind && videoKind !== 'audio') {
        setState({ url: `${API_URL}/api/projects/${projectId}/video`, local: false, missing: false, remote: false, loading: false });
      } else if (videoKind) {
        setState({ url: null, local: false, missing: true, remote: false, loading: false });
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [projectId, videoKind, imported, nonce]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}

export interface ClipPart {
  /** Object URL of the part, once it is on this device. */
  url: string | null;
  media: ClipMedia | null;
  /** 'missing': not on this device and not fetched (fetch off). */
  status: 'checking' | 'missing' | 'fetching' | 'ready' | 'error';
  percent: number;
  error: string;
  retry(): void;
}

/**
 * A linked video's part for one clip range: this device's copy, else (`fetch`)
 * cut by the server and fetched now — again whenever the range moves outside
 * the part it has. Off (`enabled` false) for videos with a whole original.
 */
export function useClipPart(
  projectId: string | undefined,
  clip: { _id: string; start: number; end: number } | undefined,
  opts: { enabled: boolean; fetch: boolean; duration?: number },
): ClipPart {
  const [state, setState] = useState<Omit<ClipPart, 'retry'>>({ url: null, media: null, status: 'checking', percent: 0, error: '' });
  const [nonce, setNonce] = useState(0);
  const clipId = clip?._id;
  const start = clip?.start;
  const end = clip?.end;
  const { enabled, fetch, duration } = opts;
  useEffect(() => {
    if (!enabled || !projectId || !clipId || start === undefined || end === undefined) return;
    const range = { _id: clipId, start, end };
    const stop = new AbortController();
    let objectUrl: string | null = null;
    const show = (media: ClipMedia) => {
      objectUrl = URL.createObjectURL(media.file);
      setState({ url: objectUrl, media, status: 'ready', percent: 100, error: '' });
    };
    setState((s) => ({ ...s, status: 'checking', error: '' }));
    void (async () => {
      const local = await localClipMedia(projectId, range).catch(() => null);
      if (stop.signal.aborted) return;
      if (local) return show(local);
      if (!fetch) return setState({ url: null, media: null, status: 'missing', percent: 0, error: '' });
      setState({ url: null, media: null, status: 'fetching', percent: 0, error: '' });
      try {
        const media = await clipMedia(projectId, range, {
          imported: true,
          duration,
          signal: stop.signal,
          onProgress: (percent) => !stop.signal.aborted && setState((s) => (s.status === 'fetching' ? { ...s, percent } : s)),
        });
        if (!stop.signal.aborted && media) show(media);
      } catch (err) {
        if (stop.signal.aborted) return;
        setState({ url: null, media: null, status: 'error', percent: 0, error: errorMessage(err, 'This clip couldn’t be prepared — try again.') });
      }
    })();
    return () => {
      stop.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [enabled, fetch, projectId, clipId, start, end, duration, nonce]);
  const retry = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, retry };
}

/** The project's captions, with `range` (the clip on show) finished — again after each trim. */
export function useProjectCaptions(projectId: string | undefined, ready: boolean, range?: TimeRange) {
  const [captions, setCaptions] = useState<Caption[] | null>(null);
  const start = range?.start;
  const end = range?.end;
  useEffect(() => {
    if (!projectId || !ready) return;
    let cancelled = false;
    void projectCaptions(projectId, start !== undefined && end !== undefined ? [{ start, end }] : [])
      .then((c) => !cancelled && setCaptions(c))
      .catch(() => !cancelled && setCaptions((c) => c ?? []));
    return () => {
      cancelled = true;
    };
  }, [projectId, ready, start, end]);
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

/**
 * Which projects' clips can be previewed on this device: the original is
 * stored here, the server streams it (a full-video upload), or it came from a
 * pasted link (any device fetches a clip's part). Clips of other projects are
 * not shown — Clips is a preview of what this device can play.
 * Missing key = not checked yet.
 */
export function usePreviewableProjects(
  clips: Array<{ projectId: string; project?: { sourceUrl?: string; video?: { kind?: string } } | null }>,
) {
  const [known, setKnown] = useState<Record<string, boolean>>({});
  const kinds = new Map(clips.map((c) => [c.projectId, c.project?.sourceUrl ? 'link' : c.project?.video?.kind]));
  const key = [...kinds.keys()].sort().join(',');
  useEffect(() => {
    const todo = (key ? key.split(',') : []).filter((id) => !(id in known));
    if (!todo.length) return;
    let cancelled = false;
    void Promise.all(
      todo.map(async (id): Promise<[string, boolean]> => {
        const kind = kinds.get(id);
        if (kind && kind !== 'audio') return [id, true];
        return [id, !!(await getSourceRecord(id).catch(() => null))];
      }),
    ).then((pairs) => {
      if (!cancelled) setKnown((k) => ({ ...k, ...Object.fromEntries(pairs) }));
    });
    return () => {
      cancelled = true;
    };
    // `kinds` follows `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, known]);
  return known;
}
