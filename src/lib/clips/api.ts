/** clips/api.ts — typed calls for the Clips REST API (server routes/clips.routes.ts). */
import { api } from '../api';
import type { CropTrack } from './cropTrack';

export type ClipStatus = 'suggested' | 'edited' | 'rendered' | 'deleted';
export type ClipCropMode = 'auto' | 'manual' | 'none';
export type ClipRunStatus = 'idle' | 'queued' | 'analyzing' | 'ready' | 'error';

export interface ClipProjectSummary {
  _id: string;
  name: string;
  kind: 'captions' | 'clips';
  status: string;
  stage?: { current?: string; percent?: number; message?: string };
  video?: {
    kind?: 'video' | 'audio';
    width?: number;
    height?: number;
    duration?: number;
    rotation?: number;
    size?: number;
    originalSize?: number;
    originalDuration?: number;
  };
}

export interface Clip {
  _id: string;
  projectId: string;
  rank: number;
  startIdx: number;
  endIdx: number;
  start: number;
  end: number;
  title: string;
  hook: string;
  reason: string;
  score: number;
  status: ClipStatus;
  templateKey: string | null;
  crop: { mode: ClipCropMode; x: number; track?: CropTrack };
  renders: number;
  lastRenderedAt?: string;
  createdAt: string;
  /** Feed only: the clip's project. */
  project?: ClipProjectSummary | null;
}

export interface ClipSetStatus {
  status: ClipRunStatus;
  runId?: string;
  count?: number;
  error?: string;
  requestedAt?: string;
  finishedAt?: string;
  options?: { maxClips?: number; minSec?: number; maxSec?: number };
}

export interface ProjectClips {
  clips: Clip[];
  /** [start, end] seconds of every transcript sentence — the trim nudger's grid. */
  sentences: Array<[number, number]>;
  status: ClipSetStatus;
  project: ClipProjectSummary;
}

export interface ClipsPage {
  clips: Clip[];
  nextCursor: string | null;
}

export interface ClipOptions {
  maxClips?: number;
  minSec?: number;
  maxSec?: number;
}

export async function analyzeClips(projectId: string, options: ClipOptions = {}) {
  const { data } = await api.post<{ ok: true; runId: string; status: ClipRunStatus }>(
    `/projects/${projectId}/clips/analyze`,
    options,
  );
  return data;
}

export async function getProjectClips(projectId: string): Promise<ProjectClips> {
  const { data } = await api.get<ProjectClips>(`/projects/${projectId}/clips`);
  return data;
}

export async function listClips(params: {
  sort?: 'score' | 'recent';
  cursor?: string | null;
  limit?: number;
  projectId?: string;
  status?: 'rendered';
}): Promise<ClipsPage> {
  const query = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  const { data } = await api.get<ClipsPage>('/clips', { params: query });
  return data;
}

export interface ClipPatch {
  startIdx?: number;
  endIdx?: number;
  title?: string;
  templateKey?: string | null;
  crop?: {
    mode?: ClipCropMode;
    x?: number;
    track?: CropTrack;
    /** An automatic track's clip range: the server saves it only if the clip still has that range and Auto framing. */
    trackFor?: { start: number; end: number };
  };
}

export async function patchClip(id: string, patch: ClipPatch): Promise<Clip> {
  const { data } = await api.patch<{ clip: Clip }>(`/clips/${id}`, patch);
  return data.clip;
}

export async function deleteClip(id: string): Promise<void> {
  await api.delete(`/clips/${id}`);
}

export async function authorizeClipRender(
  id: string,
  body: { quality: string; format: string; width: number; height: number; template: string },
): Promise<void> {
  await api.post(`/clips/${id}/render/authorize`, body);
}

export async function completeClipRender(
  id: string,
  body: { quality: string; format: string; sizeBytes: number; durationSec: number; renderMs: number; templateKey?: string; template?: string },
): Promise<void> {
  await api.post(`/clips/${id}/render/complete`, body);
}

/** Analytics only — never throws (the render already failed; this must not mask why). */
export async function failClipRender(id: string, body: { code: string; message?: string }): Promise<void> {
  await api.post(`/clips/${id}/render/failed`, body).catch(() => undefined);
}
