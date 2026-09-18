/**
 * extractAudio.ts — take the audio track out of a picked video, in the browser.
 *
 * Only the audio goes to the server for transcription; the video itself stays
 * on this device (localMedia.ts / OPFS) and is uploaded later only if the
 * server ever has to render it (export/serverUpload.ts).
 *
 * The work runs in audio.worker.ts so a 1 GB source never janks the page:
 * Mediabunny reads the input through a BlobSource (slices on demand, never
 * the whole file) and copies the audio packets — no re-encode — into a
 * container that holds that codec and that the server's ffmpeg reads:
 *
 *   aac → MP4 (.m4a)   opus / vorbis → WebM (Ogg as a second try)
 *   mp3 → MP3          flac → FLAC          PCM (short) → WAV
 *
 * Anything else (AC-3, big-endian PCM, a long PCM track that would make a
 * huge WAV) is transcoded to mono AAC in MP4, or Opus in WebM when this
 * browser has no AAC encoder but does have Opus; Mediabunny's WASM AAC
 * encoder is the last resort. Resolves null whenever the result would not be
 * trustworthy — no audio, no video, a failure — and the caller then uploads
 * the whole video exactly as before.
 *
 * Message types live here (not in the worker file) so the app's DOM-lib
 * project never type-checks worker code; the worker only imports types.
 */

export interface ExtractedAudio {
  blob: Blob;
  /** e.g. "holiday.m4a" — the source's base name with the container's extension. */
  fileName: string;
  mimeType: string;
  /** Mediabunny codec id of the audio in `blob` ('aac', 'opus', 'mp3', ...). */
  codec: string;
  /** true = the source's packets were copied (no re-encode). */
  copied: boolean;
}

export type AudioWorkerIn = { type: 'start'; file: File };

export type AudioWorkerOut =
  | { type: 'progress'; percent: number }
  | { type: 'done'; result: ExtractedAudio | null; reason?: string }
  | { type: 'error'; message: string };

function abortError() {
  return new DOMException('Aborted', 'AbortError');
}

/**
 * The picked video's audio as a small uploadable file, or null when the caller
 * should upload the full video instead. Rejects only with an AbortError (when
 * `signal` fires), so a cancelled upload stays cancelled.
 */
export function extractAudioForUpload(
  file: File,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<ExtractedAudio | null> {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./audio.worker.ts', import.meta.url), { type: 'module' });
    } catch (err) {
      console.warn('[extractAudio] worker unavailable', err);
      resolve(null);
      return;
    }
    let settled = false;
    const finish = () => {
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      worker.terminate();
    };
    const onAbort = () => {
      if (settled) return;
      finish();
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort);

    worker.onmessage = (e: MessageEvent<AudioWorkerOut>) => {
      if (settled) return;
      const msg = e.data;
      if (msg.type === 'progress') {
        onProgress?.(msg.percent);
      } else if (msg.type === 'done') {
        finish();
        if (!msg.result && msg.reason) console.info(`[extractAudio] uploading the full video: ${msg.reason}`);
        resolve(msg.result);
      } else {
        finish();
        console.warn('[extractAudio] extraction failed, uploading the full video', msg.message);
        resolve(null);
      }
    };
    worker.onerror = (e) => {
      if (settled) return;
      e.preventDefault();
      finish();
      console.warn('[extractAudio] worker crashed, uploading the full video', e.message);
      resolve(null);
    };
    worker.onmessageerror = () => {
      if (settled) return;
      finish();
      resolve(null);
    };

    const start: AudioWorkerIn = { type: 'start', file };
    worker.postMessage(start);
  });
}
