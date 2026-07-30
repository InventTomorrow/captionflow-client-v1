import { api } from './api';

const CHUNK_SIZE = 10 * 1024 * 1024;
const FAST_THRESHOLD = 100 * 1024 * 1024;
const MAX_SIZE = 5 * 1024 * 1024 * 1024;
const ALLOWED_EXT = /\.(mp4|mov|avi|mkv|webm|flv)$/i;

export function validateVideoFile(file: File) {
  if (file.size > MAX_SIZE) throw new Error('File exceeds 5GB limit');
  if (!ALLOWED_EXT.test(file.name) && !file.type.startsWith('video/')) {
    throw new Error('Unsupported format');
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function postChunkWithRetry(
  form: FormData,
  attempt = 1,
): Promise<{ progress: number; received: number }> {
  try {
    const { data } = await api.post('/upload/chunk', form, {
      timeout: 120_000,
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return data;
  } catch (err) {
    if (attempt >= 3) throw err;
    await sleep(1000 * 2 ** attempt);
    return postChunkWithRetry(form, attempt + 1);
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

export async function uploadVideo(
  file: File,
  onProgress: (p: UploadProgress) => void,
  signal?: AbortSignal,
): Promise<string> {
  validateVideoFile(file);

  if (file.size < FAST_THRESHOLD) {
    const form = new FormData();
    form.append('video', file);
    onProgress({
      percent: 10,
      uploadedBytes: 0,
      totalBytes: file.size,
      speedMBps: 0,
      etaSeconds: 0,
      status: 'Uploading…',
    });
    const { data } = await api.post('/upload/single', form, {
      timeout: 300_000,
      signal,
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (e) => {
        const percent = e.total ? Math.round((e.loaded / e.total) * 100) : 50;
        onProgress({
          percent,
          uploadedBytes: e.loaded,
          totalBytes: file.size,
          speedMBps: 0,
          etaSeconds: 0,
          status: 'Uploading…',
        });
      },
    });
    return data.projectId;
  }

  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  const { data: init } = await api.post('/upload/init', {
    filename: file.name,
    mimeType: file.type || 'video/mp4',
    size: file.size,
    totalChunks,
  });

  const uploadId = init.uploadId as string;
  localStorage.setItem(
    `cf_upload_${uploadId}`,
    JSON.stringify({ uploadId, filename: file.name, totalChunks, projectId: init.projectId }),
  );

  // Resume: ask server which chunks exist
  let startIndex = 0;
  try {
    const { data: status } = await api.get(`/upload/status/${uploadId}`);
    const received: number[] = status.receivedChunks || [];
    if (received.length) startIndex = Math.min(...Array.from({ length: totalChunks }, (_, i) => i).filter((i) => !received.includes(i)).concat([totalChunks]));
    // Better: find first missing
    for (let i = 0; i < totalChunks; i++) {
      if (!received.includes(i)) {
        startIndex = i;
        break;
      }
      startIndex = totalChunks;
    }
  } catch {
    startIndex = 0;
  }

  const started = Date.now();
  let uploadedBytes = startIndex * CHUNK_SIZE;

  for (let i = startIndex; i < totalChunks; i++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const blob = file.slice(start, end);
    const form = new FormData();
    form.append('chunk', blob, `${file.name}.part${i}`);
    form.append('uploadId', uploadId);
    form.append('chunkIndex', String(i));
    form.append('totalChunks', String(totalChunks));
    form.append('filename', file.name);

    await postChunkWithRetry(form);
    uploadedBytes = end;
    const elapsed = (Date.now() - started) / 1000;
    const speed = elapsed > 0 ? uploadedBytes / (1024 * 1024) / elapsed : 0;
    const remaining = file.size - uploadedBytes;
    const eta = speed > 0 ? remaining / (speed * 1024 * 1024) : 0;
    onProgress({
      percent: Math.round((uploadedBytes / file.size) * 100),
      uploadedBytes,
      totalBytes: file.size,
      speedMBps: Number(speed.toFixed(2)),
      etaSeconds: Math.round(eta),
      status: `Chunk ${i + 1}/${totalChunks}`,
    });
  }

  onProgress({
    percent: 99,
    uploadedBytes: file.size,
    totalBytes: file.size,
    speedMBps: 0,
    etaSeconds: 0,
    status: 'Assembling…',
  });

  const { data: done } = await api.post(
    '/upload/complete',
    { uploadId, totalChunks, filename: file.name },
    { timeout: 600_000, signal },
  );
  localStorage.removeItem(`cf_upload_${uploadId}`);
  onProgress({
    percent: 100,
    uploadedBytes: file.size,
    totalBytes: file.size,
    speedMBps: 0,
    etaSeconds: 0,
    status: 'Done',
  });
  return done.projectId;
}
