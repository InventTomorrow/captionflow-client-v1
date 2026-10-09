/**
 * clips/reframe.ts — find where the speaker is, on this device, so a 16:9
 * video can be cropped to 9:16 around them (the "Auto" framing of a clip).
 *
 * Samples the clip at 2 fps as 256-px-wide frames (Mediabunny, WebCodecs
 * decode), runs MediaPipe's short-range face detector on each (~230 KB model
 * served from /mediapipe, never a CDN), and smooths the result into a crop
 * track (cropTrack.smoothTrack). Runs on the main thread: ~120 tiny
 * detections per minute of clip, a fraction of a second of CPU — a worker
 * would cost more in MediaPipe loader plumbing than it saves. The track is
 * saved on the clip, so this runs once per clip, not per preview or render.
 */
import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision';
import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import { smoothTrack, type CropTrack, type FaceSample } from './cropTrack';

const WASM_DIR = '/mediapipe/wasm';
const MODEL_PATH = '/mediapipe/blaze_face_short_range.tflite';
const SAMPLE_FPS = 2;
const SAMPLE_WIDTH = 256;
const CENTRED: CropTrack = [[0, 0.5]];

let detectorPromise: Promise<FaceDetector> | null = null;

async function createDetector(delegate: 'GPU' | 'CPU') {
  const fileset = await FilesetResolver.forVisionTasks(WASM_DIR);
  return FaceDetector.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_PATH, delegate },
    runningMode: 'IMAGE',
    minDetectionConfidence: 0.5,
  });
}

/** One detector per page; GPU first, CPU when WebGL isn't available. */
function getDetector(): Promise<FaceDetector> {
  detectorPromise ??= createDetector('GPU').catch(() => createDetector('CPU'));
  detectorPromise.catch(() => (detectorPromise = null));
  return detectorPromise;
}

/** True when the source is wider than the 9:16 output, i.e. there is something to reframe. */
export function needsReframe(width: number, height: number): boolean {
  return width > 0 && height > 0 && width / height > 9 / 16 + 1e-3;
}

/**
 * The crop track for one clip ([clip-relative seconds, centre 0..1] keyframes).
 * A portrait/square-ish source, or one with no detectable face, gets a
 * centred track. Resolves CENTRED rather than throwing on a decode or model
 * failure — Auto framing degrades to a centre crop, never blocks a clip.
 */
export async function computeFaceTrack(
  file: Blob,
  start: number,
  end: number,
  signal?: AbortSignal,
  onProgress?: (done: number, total: number) => void,
): Promise<CropTrack> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  try {
    const video = await input.getPrimaryVideoTrack();
    if (!video || !(await video.canDecode())) return CENTRED;
    if (!needsReframe(video.displayWidth, video.displayHeight)) return CENTRED;

    const detector = await getDetector();
    const span = Math.max(0, end - start);
    const times = Array.from({ length: Math.floor(span * SAMPLE_FPS) + 1 }, (_, i) => start + i / SAMPLE_FPS);
    const sink = new CanvasSink(video, { width: SAMPLE_WIDTH, poolSize: 2 });
    const samples: FaceSample[] = [];
    let i = 0;
    for await (const wrapped of sink.canvasesAtTimestamps(times)) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      const t = times[i++] - start;
      if (!wrapped) continue;
      const canvas = wrapped.canvas;
      const w = canvas.width;
      const h = canvas.height;
      const result = detector.detect(canvas as HTMLCanvasElement);
      samples.push({
        t,
        faces: result.detections
          .map((d) => d.boundingBox)
          .filter((b): b is NonNullable<typeof b> => !!b)
          .map((b) => ({ cx: (b.originX + b.width / 2) / w, area: (b.width * b.height) / (w * h) })),
      });
      onProgress?.(i, times.length);
    }
    return smoothTrack(samples);
  } catch (err) {
    if ((err as { name?: string }).name === 'AbortError') throw err;
    console.warn('[reframe] face tracking failed, using a centre crop', err);
    return CENTRED;
  } finally {
    input.dispose();
  }
}
