import { api } from './api';
import { deleteSource, isLocalMediaSupported, storeSourceFile } from './media/localMedia';
import { probeMediaFile, type MediaProbe } from './media/probe';
import { extractAudioForUpload, type ExtractedAudio } from './media/extractAudio';
import {
  CHUNK_SIZE,
  FAST_THRESHOLD,
  postChunkWithRetry,
  uploadVideoToProject,
} from './export/serverUpload';

const MAX_SIZE = 5 * 1024 * 1024 * 1024;
const ALLOWED_EXT = /\.(mp4|mov|avi|mkv|webm|flv)$/i;

export function validateVideoFile(file: File) {
  if (file.size > MAX_SIZE) throw new Error('File exceeds 5GB limit');
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
  /** Audio from a YouTube link fetched by Asaan Caption Helper: that link. */
  sourceUrl?: string;
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
    if (payload.sourceUrl) form.append('sourceUrl', payload.sourceUrl);
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
    ...(payload.sourceUrl ? { sourceUrl: payload.sourceUrl } : {}),
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
  options: { audioOnlyEnabled: boolean; requireAudioOnly?: boolean },
): Promise<ProjectUploadResult> {
  validateVideoFile(file);
  if (options.requireAudioOnly) return uploadSoundOnly(file, onProgress, signal);
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

/** What the helper knows about a linked YouTube video (helper/helper.ts HelperVideo). */
export interface LinkedVideo {
  title: string;
  duration: number;
  video: { size: number; codec: string; width?: number; height?: number; fps?: number };
  audio: { size: number; codec: string };
}

/**
 * Clips from a YouTube link through Asaan Caption Helper: only the sound goes
 * up, fetched on this computer by the helper. The project keeps the link;
 * reels play from YouTube and only picked clips' parts are ever fetched, here
 * (clips/clipMedia.ts). Returns the new project's id.
 */
export async function uploadLinkedAudio(
  audio: Blob,
  video: LinkedVideo,
  sourceUrl: string,
  onProgress: (p: UploadProgress) => void,
  signal?: AbortSignal,
): Promise<string> {
  // A readable file name; the server makes it safe for its disk anyway.
  const title = video.title.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 120) || 'YouTube video';
  return sendMedia(
    {
      blob: audio,
      fileName: `${title}.m4a`,
      mimeType: 'audio/mp4',
      mediaKind: 'audio',
      sourceUrl,
      sourceMeta: {
        name: video.title.slice(0, 255),
        size: video.video.size + video.audio.size,
        mimeType: 'video/mp4',
        width: video.video.width ?? 0,
        height: video.video.height ?? 0,
        rotation: 0,
        fps: video.video.fps ?? 0,
        duration: video.duration,
        videoCodec: video.video.codec.slice(0, 40),
        audioCodec: video.audio.codec.slice(0, 40),
      },
      label: 'Sending the audio…',
    },
    onProgress,
    signal,
  );
}

/** Why this device can't make Clips from a file (the video never leaves the device). */
export type ClipsDeviceErrorCode = 'UNSUPPORTED' | 'NO_AUDIO' | 'EXTRACT_FAILED' | 'NO_LOCAL_COPY';

const CLIPS_DEVICE_MESSAGES: Record<ClipsDeviceErrorCode, string> = {
  UNSUPPORTED: 'This browser can’t make clips from this file. Try Chrome or Edge on a computer, or an MP4 or MOV file.',
  NO_AUDIO: 'This video has no sound, so there is nothing to find clips in. Try a different file.',
  EXTRACT_FAILED: 'This browser couldn’t read this video’s sound. Try Chrome or Edge on a computer, or an MP4 file.',
  NO_LOCAL_COPY: 'This browser couldn’t keep the video on your device (storage may be full). Free some space and try again.',
};

export class ClipsDeviceError extends Error {
  readonly code: ClipsDeviceErrorCode;
  constructor(code: ClipsDeviceErrorCode) {
    super(CLIPS_DEVICE_MESSAGES[code]);
    this.code = code;
    this.name = 'ClipsDeviceError';
  }
}

/**
 * Clips: only the sound goes up; the video stays on this device for the
 * preview and the render. There is no full-video fallback — if the sound can't
 * be extracted or the video can't be kept here, nothing is left on the server
 * and a ClipsDeviceError says why.
 */
async function uploadSoundOnly(
  file: File,
  onProgress: (p: UploadProgress) => void,
  signal: AbortSignal | undefined,
): Promise<ProjectUploadResult> {
  if (!isLocalMediaSupported()) throw new ClipsDeviceError('UNSUPPORTED');
  const probe = await probeMediaFile(file).catch(() => null);
  if (!probe?.hasVideo) throw new ClipsDeviceError('UNSUPPORTED');
  if (!probe.hasAudio) throw new ClipsDeviceError('NO_AUDIO');
  if (!(await hasRoomForLocalCopy(file.size))) throw new ClipsDeviceError('NO_LOCAL_COPY');

  const extracting = (percent: number) => onProgress(progress({ percent, totalBytes: file.size, status: 'Preparing…' }));
  extracting(0);
  const audio = await extractAudioForUpload(file, extracting, signal);
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (!audio) throw new ClipsDeviceError('EXTRACT_FAILED');

  // The local copy starts as soon as the project exists (a chunked upload
  // allots it at /upload/init), alongside the upload.
  let allotted: string | undefined;
  let stored: Promise<boolean> | undefined;
  const storeLocally = (projectId: string) => {
    allotted = projectId;
    stored ??= storeSourceFile(projectId, file, probe).then(
      () => true,
      (err) => {
        console.warn('[localMedia] could not keep a local copy', err);
        return false;
      },
    );
  };
  /** Leave nothing behind: the server's project and, once its write has settled, this device's copy. */
  const discard = async () => {
    const id = allotted;
    if (!id) return;
    await stored;
    await Promise.all([api.delete(`/projects/${id}`).catch(() => undefined), deleteSource(id).catch(() => undefined)]);
  };

  let projectId: string;
  try {
    projectId = await sendMedia(
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
  } catch (err) {
    // A failed or cancelled upload: no half-made project here or on the server.
    await discard();
    throw err;
  }
  storeLocally(projectId);
  onProgress(progress({ percent: 100, uploadedBytes: audio.blob.size, totalBytes: audio.blob.size, status: 'Finishing…' }));
  const kept = await stored;
  if (signal?.aborted) {
    await discard();
    throw new DOMException('Aborted', 'AbortError');
  }
  if (kept) return { projectId, mode: 'audio', localCopy: true, videoAttached: false };

  // No copy here means no preview and no render: leave nothing behind.
  await discard();
  throw new ClipsDeviceError('NO_LOCAL_COPY');
}
