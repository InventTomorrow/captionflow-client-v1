import { api } from './api';
import { isLocalMediaSupported, storeSourceFile } from './media/localMedia';
import { probeMediaFile, type MediaProbe } from './media/probe';
import { extractAudioForUpload, type ExtractedAudio } from './media/extractAudio';
import {
  CHUNK_SIZE,
  FAST_THRESHOLD,
  postChunkWithRetry,
  uploadVideoToProject,
} from './export/serverUpload';

const MAX_SIZE = 1 * 1024 * 1024 * 1024;
const ALLOWED_EXT = /\.(mp4|mov|avi|mkv|webm|flv)$/i;

export function validateVideoFile(file: File) {
  if (file.size > MAX_SIZE) throw new Error('File exceeds 1GB limit');
  if (!ALLOWED_EXT.test(file.name) && !file.type.startsWith('video/')) {
    throw new Error('Unsupported format');
  }
}

export interface UploadProgress {
  percent: number;
  uploadedBytes: number;
  totalBytes: number;
  speedMBps: number;
  etaSeconds: number;
  status: string;
}

export interface UploadHooks {
  /**
   * Called as soon as the server has allotted a project id — at /upload/init
   * for chunked uploads, after /upload/single otherwise — so the caller can
   * start work that only needs the id (the local OPFS copy) while bytes are
   * still going up.
   */
  onProjectId?: (projectId: string) => void;
}

/** What the browser's probe says about the ORIGINAL video of an audio-only upload. */
export interface SourceMeta {
  name: string;
  size: number;
  mimeType: string;
  /** Display size, rotation applied. */
  width: number;
  height: number;
  rotation: number;
  fps: number;
  duration: number;
  videoCodec: string | null;
  audioCodec: string | null;
}

export type UploadMode = 'audio' | 'video';

interface MediaPayload {
  blob: Blob;
  fileName: string;
  mimeType: string;
  mediaKind: UploadMode;
  sourceMeta?: SourceMeta;
  /** Status line while bytes go up; chunk progress is appended for audio. */
  label: string;
}

function progress(p: Partial<UploadProgress> & Pick<UploadProgress, 'percent' | 'status'>): UploadProgress {
  return { uploadedBytes: 0, totalBytes: 0, speedMBps: 0, etaSeconds: 0, ...p };
}

/** POST the blob as a new project: one request under 100 MB, resumable chunks above. */
async function sendMedia(
  payload: MediaPayload,
  onProgress: (p: UploadProgress) => void,
  signal?: AbortSignal,
  hooks?: UploadHooks,
): Promise<string> {
  const { blob, fileName, label } = payload;
  const size = blob.size;

  if (size < FAST_THRESHOLD) {
    const form = new FormData();
    // Text fields first, so they are parsed before the file part.
    form.append('mediaKind', payload.mediaKind);
    if (payload.sourceMeta) form.append('sourceMeta', JSON.stringify(payload.sourceMeta));
    form.append('video', blob, fileName);
    onProgress(progress({ percent: 10, totalBytes: size, status: label }));
    const { data } = await api.post('/upload/single', form, {
      timeout: 300_000,
      signal,
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (e) => {
        const percent = e.total ? Math.round((e.loaded / e.total) * 100) : 50;
        onProgress(progress({ percent, uploadedBytes: Math.min(e.loaded, size), totalBytes: size, status: label }));
      },
    });
    hooks?.onProjectId?.(String(data.projectId));
    return data.projectId;
  }

  const totalChunks = Math.ceil(size / CHUNK_SIZE);
  const { data: init } = await api.post('/upload/init', {
    filename: fileName,
    mimeType: payload.mimeType,
    size,
    totalChunks,
    mediaKind: payload.mediaKind,
    ...(payload.sourceMeta ? { sourceMeta: payload.sourceMeta } : {}),
  }, { signal });

  const uploadId = init.uploadId as string;
  if (init.projectId) hooks?.onProjectId?.(String(init.projectId));
  localStorage.setItem(
    `cf_upload_${uploadId}`,
    JSON.stringify({ uploadId, filename: fileName, totalChunks, projectId: init.projectId }),
  );

  // Resume: ask server which chunks exist, start at the first missing one.
  let startIndex = 0;
  try {
    const { data: status } = await api.get(`/upload/status/${uploadId}`);
    const received: number[] = status.receivedChunks || [];
    startIndex = totalChunks;
    for (let i = 0; i < totalChunks; i++) {
      if (!received.includes(i)) {
        startIndex = i;
        break;
      }
    }
  } catch {
    startIndex = 0;
  }

  const started = Date.now();
  let uploadedBytes = startIndex * CHUNK_SIZE;

  for (let i = startIndex; i < totalChunks; i++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, size);
    const form = new FormData();
    form.append('chunk', blob.slice(start, end), `${fileName}.part${i}`);
    form.append('uploadId', uploadId);
    form.append('chunkIndex', String(i));
    form.append('totalChunks', String(totalChunks));
    form.append('filename', fileName);

    await postChunkWithRetry(form, signal);
    uploadedBytes = end;
    const elapsed = (Date.now() - started) / 1000;
    const speed = elapsed > 0 ? uploadedBytes / (1024 * 1024) / elapsed : 0;
    const remaining = size - uploadedBytes;
    const eta = speed > 0 ? remaining / (speed * 1024 * 1024) : 0;
    onProgress({
      percent: Math.round((uploadedBytes / size) * 100),
      uploadedBytes,
      totalBytes: size,
      speedMBps: Number(speed.toFixed(2)),
      etaSeconds: Math.round(eta),
      status: payload.mediaKind === 'audio' ? label : `Chunk ${i + 1}/${totalChunks}`,
    });
  }

  onProgress(progress({ percent: 99, uploadedBytes: size, totalBytes: size, status: 'Assembling…' }));

  const { data: done } = await api.post(
    '/upload/complete',
    { uploadId, totalChunks, filename: fileName },
    { timeout: 600_000, signal },
  );
  localStorage.removeItem(`cf_upload_${uploadId}`);
  onProgress(progress({ percent: 100, uploadedBytes: size, totalBytes: size, status: 'Done' }));
  return done.projectId;
}

/** Upload the whole video as a new project (no local copy, no audio-only path). */
export async function uploadVideo(
  file: File,
  onProgress: (p: UploadProgress) => void,
  signal?: AbortSignal,
  hooks?: UploadHooks,
): Promise<string> {
  validateVideoFile(file);
  return sendMedia(
    { blob: file, fileName: file.name, mimeType: file.type || 'video/mp4', mediaKind: 'video', label: 'Uploading…' },
    onProgress,
    signal,
    hooks,
  );
}

/**
 * Developer override: `localStorage.cf_upload_mode = 'video'` always uploads
 * the full video, whatever the admin flag says.
 */
function forcedFullUpload(): boolean {
  try {
    return localStorage.getItem('cf_upload_mode') === 'video';
  } catch {
    return false;
  }
}

/** Enough free origin storage for the local copy? (Unknown = assume yes; the fallback covers it.) */
async function hasRoomForLocalCopy(bytes: number): Promise<boolean> {
  try {
    const { quota, usage } = await navigator.storage.estimate();
    if (!quota) return true;
    return quota - (usage ?? 0) > bytes * 1.1 + 50 * 1024 * 1024;
  } catch {
    return true;
  }
}

function sourceMetaFrom(file: File, probe: MediaProbe): SourceMeta {
  return {
    name: file.name.slice(0, 255),
    size: file.size,
    mimeType: (file.type || probe.mimeType.split(';')[0] || '').slice(0, 100),
    width: probe.width,
    height: probe.height,
    rotation: probe.rotation,
    fps: probe.fps,
    duration: probe.duration,
    videoCodec: probe.videoCodec,
    audioCodec: probe.audioCodec,
  };
}

export interface ProjectUploadResult {
  projectId: string;
  /** What went up at upload time. */
  mode: UploadMode;
  /** This device kept a copy of the source (OPFS). */
  localCopy: boolean;
  /** Audio-only upload whose local copy failed, so the video was uploaded right after. */
  videoAttached: boolean;
}

/**
 * Create a project from a picked video.
 *
 * Audio-only (the default when the admin flag allows it and this browser has
 * local media storage): the audio track is extracted on this device and only
 * that goes up for transcription; the video is kept in OPFS for the editor
 * and in-browser exports, and reaches the server later only if a server
 * render needs it. That local copy is mandatory — if it can't be written, the
 * full video is uploaded to the project straight away, so a project never
 * exists with its video nowhere.
 *
 * Otherwise (flag off, no OPFS, a file whose audio can't be extracted) the
 * full video is uploaded as before, with a best-effort local copy alongside.
 */
export async function uploadProjectMedia(
  file: File,
  onProgress: (p: UploadProgress) => void,
  signal: AbortSignal | undefined,
  options: { audioOnlyEnabled: boolean },
): Promise<ProjectUploadResult> {
  validateVideoFile(file);
  const localOk = isLocalMediaSupported();
  const probePromise: Promise<MediaProbe | null> = localOk
    ? probeMediaFile(file).catch(() => null)
    : Promise.resolve(null);

  // Probing and copying overlap the upload; the copy is awaited before the
  // caller leaves the page so the editor never races a write.
  const stores = new Map<string, Promise<boolean>>();
  const storeLocally = (projectId: string) => {
    if (!localOk || stores.has(projectId)) return;
    stores.set(
      projectId,
      probePromise
        .then((probe) => storeSourceFile(projectId, file, probe))
        .then(
          () => true,
          (err) => {
            console.warn('[localMedia] could not keep a local copy', err);
            return false;
          },
        ),
    );
  };

  let audio: ExtractedAudio | null = null;
  let probe: MediaProbe | null = null;
  if (options.audioOnlyEnabled && localOk && !forcedFullUpload()) {
    probe = await probePromise;
    if (probe?.hasVideo && probe.hasAudio && (await hasRoomForLocalCopy(file.size))) {
      const extracting = (percent: number) =>
        onProgress(progress({ percent, totalBytes: file.size, status: 'Preparing…' }));
      extracting(0);
      audio = await extractAudioForUpload(file, extracting, signal);
    }
  }

  if (audio && probe) {
    console.info(
      `[upload] audio-only: ${audio.fileName} ${(audio.blob.size / 1048576).toFixed(2)} MB ` +
        `(${audio.codec}, ${audio.copied ? 'copied' : 'transcoded'}) instead of ${(file.size / 1048576).toFixed(1)} MB`,
    );
    const projectId = await sendMedia(
      {
        blob: audio.blob,
        fileName: audio.fileName,
        mimeType: audio.mimeType,
        mediaKind: 'audio',
        sourceMeta: sourceMetaFrom(file, probe),
        label: 'Uploading…',
      },
      onProgress,
      signal,
      { onProjectId: storeLocally },
    );
    storeLocally(projectId);
    onProgress(progress({ percent: 100, uploadedBytes: audio.blob.size, totalBytes: audio.blob.size, status: 'Finishing…' }));
    if (await stores.get(projectId)) {
      return { projectId, mode: 'audio', localCopy: true, videoAttached: false };
    }

    // No copy on this device: the server must hold the video instead.
    try {
      await uploadVideoToProject(
        projectId,
        file,
        (p) =>
          onProgress(
            progress({ percent: p.percent, uploadedBytes: p.uploadedBytes, totalBytes: p.totalBytes, status: 'Uploading…' }),
          ),
        signal,
      );
    } catch (err) {
      // Never leave a project whose video exists nowhere.
      await api.delete(`/projects/${projectId}`).catch(() => undefined);
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      throw err;
    }
    return { projectId, mode: 'audio', localCopy: false, videoAttached: true };
  }

  const projectId = await sendMedia(
    { blob: file, fileName: file.name, mimeType: file.type || 'video/mp4', mediaKind: 'video', label: 'Uploading…' },
    onProgress,
    signal,
    { onProjectId: storeLocally },
  );
  storeLocally(projectId);
  const pendingStore = stores.get(projectId);
  let localCopy = false;
  if (pendingStore) {
    onProgress(progress({ percent: 100, uploadedBytes: file.size, totalBytes: file.size, status: 'Finishing…' }));
    localCopy = await pendingStore;
  }
  return { projectId, mode: 'video', localCopy, videoAttached: false };
}
