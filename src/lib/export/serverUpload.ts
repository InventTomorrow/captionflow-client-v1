/**
 * export/serverUpload.ts — send an audio-only project's video to the server,
 * only when the server has to render it (chooseExportRoute → uploadFirst).
 *
 * Same transport as the first upload (lib/uploader.ts): one multipart POST
 * under 100 MB, otherwise 10 MB chunks with retries. The chunked path starts
 * at /projects/:id/video/attach/init and then uses the ordinary /upload/chunk
 * and /upload/complete — the server recognises the session as an attach and
 * swaps the project's source instead of creating a project.
 */

import { api } from '../api';

export const CHUNK_SIZE = 10 * 1024 * 1024;
export const FAST_THRESHOLD = 100 * 1024 * 1024;

export interface AttachProgress {
  percent: number;
  uploadedBytes: number;
  totalBytes: number;
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

/** POST one chunk, retrying twice with backoff; an abort is never retried. */
export async function postChunkWithRetry(
  form: FormData,
  signal?: AbortSignal,
  attempt = 1,
): Promise<{ progress: number; received: number }> {
  try {
    const { data } = await api.post('/upload/chunk', form, {
      timeout: 120_000,
      signal,
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return data;
  } catch (err) {
    if (signal?.aborted || attempt >= 3) throw err;
    await sleep(1000 * 2 ** attempt, signal);
    return postChunkWithRetry(form, signal, attempt + 1);
  }
}

/**
 * Upload `file` as the project's source video. Resolves once the server has
 * probed it and made it the project's video (kind 'video'); rejects on abort
 * (axios CanceledError / AbortError) or when the server refuses the file.
 */
export async function uploadVideoToProject(
  projectId: string,
  file: File,
  onProgress: (p: AttachProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  const total = file.size;
  const report = (uploadedBytes: number, percent = Math.round((uploadedBytes / Math.max(1, total)) * 100)) =>
    onProgress({ percent: Math.max(0, Math.min(100, percent)), uploadedBytes, totalBytes: total });

  if (total < FAST_THRESHOLD) {
    const form = new FormData();
    form.append('video', file, file.name);
    report(0);
    await api.post(`/projects/${projectId}/video/attach`, form, {
      timeout: 300_000,
      signal,
      headers: { 'Content-Type': 'multipart/form-data' },
      // The server's probe + swap after the last byte is quick; hold at 99 until it answers.
      onUploadProgress: (e) => report(e.loaded, e.total ? Math.min(99, Math.round((e.loaded / e.total) * 100)) : 50),
    });
    report(total, 100);
    return;
  }

  const totalChunks = Math.ceil(total / CHUNK_SIZE);
  const { data: init } = await api.post(
    `/projects/${projectId}/video/attach/init`,
    { filename: file.name, mimeType: file.type || 'video/mp4', size: total, totalChunks },
    { signal },
  );
  const uploadId = String(init.uploadId);

  for (let i = 0; i < totalChunks; i++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, total);
    const form = new FormData();
    form.append('chunk', file.slice(start, end), `${file.name}.part${i}`);
    form.append('uploadId', uploadId);
    form.append('chunkIndex', String(i));
    form.append('totalChunks', String(totalChunks));
    form.append('filename', file.name);
    await postChunkWithRetry(form, signal);
    report(end, Math.min(99, Math.round((end / total) * 100)));
  }

  await api.post(
    '/upload/complete',
    { uploadId, totalChunks, filename: file.name },
    { timeout: 600_000, signal },
  );
  report(total, 100);
}
