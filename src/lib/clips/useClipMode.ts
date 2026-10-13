/**
 * clips/useClipMode.ts — the captions editor opened on one clip
 * (/projects/:id/editor?clip=<clipId>, see clipMode.ts).
 *
 * useClipMode finds the clip; useClipLookAutosave saves every style change
 * made in the editor to that clip (never to the video): the editor's style
 * panel has no Save step for most controls, and a clip renders from what is
 * stored, so what the preview shows must reach the server on its own.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { errorMessage } from '../api';
import { buildExportStyle, type EditorStyle } from '../export/styleSnapshot';
import { useClipsStore } from '../../stores/clipsStore';

export function useClipMode(projectId: string | undefined) {
  const [params] = useSearchParams();
  const clipId = params.get('clip');
  const data = useClipsStore((s) => (projectId ? s.byProject[projectId] : undefined));
  const loadProject = useClipsStore((s) => s.loadProject);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!projectId || !clipId) return;
    setError('');
    void loadProject(projectId).catch((e) => setError(errorMessage(e, 'Couldn’t load this clip')));
  }, [projectId, clipId, loadProject]);

  const clips = data?.clips;
  const index = clipId && clips ? clips.findIndex((c) => c._id === clipId) : -1;
  return {
    clipId,
    clip: index >= 0 && clips ? clips[index] : null,
    index,
    clips: clips ?? [],
    /** The editor side panel to open first (e.g. 'templates'). */
    panel: params.get('panel'),
    loading: !!clipId && !data && !error,
    /** ?clip= names a clip this video doesn't have (deleted, or another video's). */
    missing: !!clipId && !!data && index < 0,
    error,
  };
}

/** The look a clip stores: the editor's style as it renders on a clip (9:16, never behind-person). */
export function clipLookSnapshot(style: Partial<EditorStyle>): EditorStyle {
  return buildExportStyle({ ...style, aspectRatio: '9:16', behindPerson: false }, { defaultAspect: '9:16' });
}

export type ClipLookSaveState = 'idle' | 'saving' | 'saved' | 'error';

const SAVE_DELAY_MS = 600;

/**
 * Debounced save of the editor's style to the clip. `baseline(style)` marks
 * the look the clip already has (right after it is applied to the editor), so
 * opening a clip never saves anything; `flush()` saves now (before a render,
 * or before leaving).
 */
export function useClipLookAutosave(clipId: string | null, style: Partial<EditorStyle>) {
  const updateClip = useClipsStore((s) => s.updateClip);
  const [state, setState] = useState<ClipLookSaveState>('idle');
  const saved = useRef<{ clipId: string; json: string } | null>(null);
  const inflight = useRef<Promise<void> | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const snapshot = useMemo(() => clipLookSnapshot(style), [style]);
  const json = useMemo(() => JSON.stringify(snapshot), [snapshot]);
  const latest = useRef({ clipId, json, snapshot });
  latest.current = { clipId, json, snapshot };

  const save = useCallback(async () => {
    const { clipId: id, json: j, snapshot: look } = latest.current;
    if (!id || saved.current?.clipId !== id || saved.current.json === j) return;
    setState('saving');
    const run = updateClip(id, { style: look })
      .then(() => {
        if (saved.current?.clipId === id) saved.current = { clipId: id, json: j };
        setState('saved');
      })
      .catch(() => setState('error'));
    inflight.current = run;
    await run;
  }, [updateClip]);

  useEffect(() => {
    if (!clipId || saved.current?.clipId !== clipId || saved.current.json === json) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(), SAVE_DELAY_MS);
    return () => window.clearTimeout(timer.current);
  }, [clipId, json, save]);

  const baseline = useCallback((id: string, look: Partial<EditorStyle>) => {
    window.clearTimeout(timer.current);
    saved.current = { clipId: id, json: JSON.stringify(clipLookSnapshot(look)) };
    setState('idle');
  }, []);

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    await inflight.current;
    await save();
  }, [save]);

  return { state, baseline, flush, snapshot };
}
