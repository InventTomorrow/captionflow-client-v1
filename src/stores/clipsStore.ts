/**
 * clipsStore — Clips state shared by the gallery, the clip set page and the
 * clip editor: each project's clips + run status, the cross-project feed, live
 * clips:* socket progress, and the one-at-a-time render queue.
 */
import { create } from 'zustand';
import { getSocket } from '../lib/socket';
import {
  getProjectClips,
  listClips,
  patchClip as apiPatchClip,
  deleteClip as apiDeleteClip,
  deleteClips as apiDeleteClips,
  styleClips as apiStyleClips,
  styleAllClips as apiStyleAllClips,
  type Clip,
  type ClipLookPatch,
  type ClipPatch,
  type ClipRunStatus,
  type ProjectClips,
} from '../lib/clips/api';
import { renderClip, type ClipRenderContext, type ClipRenderOptions } from '../lib/clips/renderClip';
import { describeDeviceProgress } from '../lib/export/clientExport';
import { createLatestGate } from '../lib/clips/latestGate';

/** Only the newest feed request may write the list (a filter change mid-load must win). */
const feedGate = createLatestGate();

export interface LiveRunStatus {
  status: ClipRunStatus;
  percent: number;
  message?: string;
}

export interface RenderState {
  status: 'queued' | 'rendering' | 'done' | 'error';
  percent: number;
  detail?: string;
  error?: string;
  /** OPFS path of the finished file. */
  opfsPath?: string;
}

interface FeedState {
  items: Clip[];
  cursor: string | null;
  loading: boolean;
  done: boolean;
  sort: 'score' | 'recent';
  rendered: boolean;
  projectId?: string;
}

interface ClipsState {
  byProject: Record<string, ProjectClips | undefined>;
  live: Record<string, LiveRunStatus | undefined>;
  feed: FeedState;
  renders: Record<string, RenderState | undefined>;
  loadProject(projectId: string): Promise<ProjectClips>;
  setFeedFilter(f: Partial<Pick<FeedState, 'sort' | 'rendered' | 'projectId'>>): void;
  loadFeed(reset?: boolean): Promise<void>;
  updateClip(id: string, patch: ClipPatch): Promise<Clip>;
  /** Replace a clip already saved on the server (e.g. a freshly computed face track). */
  setClipLocal(clip: Clip): void;
  removeClip(id: string): Promise<void>;
  /** One look onto a selection of clips (a template card, or an editor-made style). */
  styleClips(ids: string[], look: ClipLookPatch): Promise<void>;
  /** "Style all clips" of a video — also the look its later runs start from. */
  styleAllClips(projectId: string, look: ClipLookPatch): Promise<void>;
  removeClips(ids: string[]): Promise<void>;
  enqueueRenders(jobs: Array<{ clip: Clip; ctx: ClipRenderContext; opts: ClipRenderOptions }>): void;
  cancelRender(clipId: string): void;
}

const FEED_PAGE = 30;

function replaceClip(list: Clip[], clip: Clip) {
  return list.map((c) => (c._id === clip._id ? { ...c, ...clip, project: c.project } : c));
}

/** Clips just saved on the server, merged into every list that shows them. */
function mergeClips(s: Pick<ClipsState, 'byProject' | 'feed'>, saved: Clip[]) {
  const byId = new Map(saved.map((c) => [c._id, c]));
  const merge = (list: Clip[]) => list.map((c) => (byId.has(c._id) ? { ...c, ...byId.get(c._id)!, project: c.project } : c));
  return {
    byProject: Object.fromEntries(Object.entries(s.byProject).map(([k, v]) => [k, v ? { ...v, clips: merge(v.clips) } : v])),
    feed: { ...s.feed, items: merge(s.feed.items) },
  };
}

function dropClips(s: Pick<ClipsState, 'byProject' | 'feed'>, ids: Set<string>) {
  return {
    byProject: Object.fromEntries(
      Object.entries(s.byProject).map(([k, v]) => [k, v ? { ...v, clips: v.clips.filter((c) => !ids.has(c._id)) } : v]),
    ),
    feed: { ...s.feed, items: s.feed.items.filter((c) => !ids.has(c._id)) },
  };
}

export const useClipsStore = create<ClipsState>((set, get) => ({
  byProject: {},
  live: {},
  feed: { items: [], cursor: null, loading: false, done: false, sort: 'score', rendered: false },
  renders: {},

  async loadProject(projectId) {
    const data = await getProjectClips(projectId);
    set((s) => ({ byProject: { ...s.byProject, [projectId]: data } }));
    return data;
  },

  setFeedFilter(f) {
    set((s) => ({ feed: { ...s.feed, ...f, items: [], cursor: null, done: false } }));
    void get().loadFeed(true);
  },

  async loadFeed(reset = false) {
    const f = get().feed;
    // A reset (new filter) always runs and supersedes whatever is in flight;
    // "load more" waits its turn.
    if (!reset && (f.loading || f.done)) return;
    const ticket = feedGate.next();
    set((s) => ({ feed: { ...s.feed, loading: true } }));
    try {
      const page = await listClips({
        sort: f.sort,
        limit: FEED_PAGE,
        cursor: reset ? null : f.cursor,
        projectId: f.projectId,
        status: f.rendered ? 'rendered' : undefined,
      });
      if (!feedGate.isCurrent(ticket)) return;
      set((s) => ({
        feed: {
          ...s.feed,
          items: reset ? page.clips : [...s.feed.items, ...page.clips],
          cursor: page.nextCursor,
          done: !page.nextCursor,
          loading: false,
        },
      }));
    } catch (err) {
      if (!feedGate.isCurrent(ticket)) return;
      set((s) => ({ feed: { ...s.feed, loading: false } }));
      throw err;
    }
  },

  async updateClip(id, patch) {
    const clip = await apiPatchClip(id, patch);
    get().setClipLocal(clip);
    return clip;
  },

  setClipLocal(clip) {
    set((s) => {
      const pid = clip.projectId;
      const proj = s.byProject[pid];
      return {
        byProject: proj ? { ...s.byProject, [pid]: { ...proj, clips: replaceClip(proj.clips, clip) } } : s.byProject,
        feed: { ...s.feed, items: replaceClip(s.feed.items, clip) },
      };
    });
  },

  async removeClip(id) {
    await apiDeleteClip(id);
    set((s) => dropClips(s, new Set([id])));
  },

  async styleClips(ids, look) {
    const saved = await apiStyleClips(ids, look);
    set((s) => mergeClips(s, saved));
  },

  async styleAllClips(projectId, look) {
    const saved = await apiStyleAllClips(projectId, look);
    set((s) => {
      const merged = mergeClips(s, saved);
      const proj = merged.byProject[projectId];
      const status = {
        ...(look.style
          ? { templateKey: (look.style.templateKey as string | undefined) || null, style: look.style }
          : look.templateKey !== undefined
            ? { templateKey: look.templateKey, style: null }
            : {}),
        ...(look.aspect ? { aspect: look.aspect } : {}),
      };
      return {
        ...merged,
        byProject: proj ? { ...merged.byProject, [projectId]: { ...proj, status: { ...proj.status, ...status } } } : merged.byProject,
      };
    });
  },

  async removeClips(ids) {
    await apiDeleteClips(ids);
    set((s) => dropClips(s, new Set(ids)));
  },

  enqueueRenders(jobs) {
    for (const job of jobs) {
      const cur = get().renders[job.clip._id];
      if (cur && (cur.status === 'queued' || cur.status === 'rendering')) continue;
      set((s) => ({ renders: { ...s.renders, [job.clip._id]: { status: 'queued', percent: 0 } } }));
      queue.push(job);
    }
    void pump();
  },

  cancelRender(clipId) {
    const i = queue.findIndex((j) => j.clip._id === clipId);
    if (i >= 0) {
      queue.splice(i, 1);
      setRender(clipId, undefined);
    } else if (active?.clipId === clipId) {
      active.cancel();
    }
  },
}));

/* ---------------------------------------------------- render queue (FIFO, one at a time) */

type Job = { clip: Clip; ctx: ClipRenderContext; opts: ClipRenderOptions };
const queue: Job[] = [];
let active: { clipId: string; cancel(): void } | null = null;

function setRender(clipId: string, state: RenderState | undefined) {
  useClipsStore.setState((s) => ({ renders: { ...s.renders, [clipId]: state } }));
}

async function pump() {
  if (active) return;
  const job = queue.shift();
  if (!job) return;
  const started = performance.now();
  setRender(job.clip._id, { status: 'rendering', percent: 0, detail: 'Preparing…' });
  const handle = renderClip(job.clip, { ...job.ctx, onClipUpdated: (c) => useClipsStore.getState().setClipLocal(c) }, job.opts, (p) =>
    setRender(job.clip._id, { status: 'rendering', percent: p.percent, detail: describeDeviceProgress(p, started) }),
  );
  active = { clipId: job.clip._id, cancel: handle.cancel };
  try {
    const record = await handle.promise;
    setRender(job.clip._id, { status: 'done', percent: 100, opfsPath: record.opfsPath });
    const mark = (c: Clip) => (c._id === job.clip._id ? { ...c, status: 'rendered' as const, renders: c.renders + 1 } : c);
    useClipsStore.setState((s) => {
      const proj = s.byProject[job.ctx.projectId];
      return {
        byProject: proj ? { ...s.byProject, [job.ctx.projectId]: { ...proj, clips: proj.clips.map(mark) } } : s.byProject,
        feed: { ...s.feed, items: s.feed.items.map(mark) },
      };
    });
  } catch (err) {
    const e = err as { code?: string; message?: string };
    setRender(
      job.clip._id,
      e.code === 'CANCELLED' ? undefined : { status: 'error', percent: 0, error: e.message || 'Render failed' },
    );
  } finally {
    active = null;
    void pump();
  }
}

/* ----------------------------------------------------------------- sockets */

let subscribed = false;

/** clips:* events arrive in the user's own room — call once while Clips is enabled. */
export function subscribeClipsEvents() {
  if (subscribed) return;
  subscribed = true;
  const socket = getSocket();
  socket.on('clips:status', (e: { projectId: string; status: ClipRunStatus; percent: number; message?: string }) => {
    useClipsStore.setState((s) => ({ live: { ...s.live, [e.projectId]: { status: e.status, percent: e.percent, message: e.message } } }));
  });
  const refresh = (e: { projectId: string }) => {
    const { byProject, feed, loadProject, loadFeed } = useClipsStore.getState();
    if (byProject[e.projectId]) void loadProject(e.projectId).catch(() => undefined);
    if (feed.items.length || feed.done) void loadFeed(true).catch(() => undefined);
  };
  socket.on('clips:ready', (e: { projectId: string; count: number }) => {
    useClipsStore.setState((s) => ({ live: { ...s.live, [e.projectId]: { status: 'ready', percent: 100 } } }));
    refresh(e);
  });
  socket.on('clips:error', (e: { projectId: string; message: string }) => {
    useClipsStore.setState((s) => ({ live: { ...s.live, [e.projectId]: { status: 'error', percent: 0, message: e.message } } }));
    refresh(e);
  });
}
