/**
 * kinetic/segmenter.ts — the PREVIEW half of "text behind person".
 *
 * MediaPipe's selfie segmenter runs in the browser and hands back a soft
 * person mask for the current video frame, which KineticCaptionLayer uses to
 * cut the person out of the footage and draw them back over the captions.
 *
 * This is a live approximation. The export uses the far better Robust Video
 * Matting matte rendered by segmentation/app.py — the one place preview and
 * export are allowed to differ, and only in the cut-out's edge quality; the
 * text itself is laid out identically on both sides.
 *
 * Model + WASM are served from this app's own /mediapipe/ folder (never a
 * CDN): the .tflite is committed, the wasm is copied from node_modules by
 * client/scripts/copy-mediapipe.mjs on install.
 */

import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';

const WASM_DIR = '/mediapipe/wasm';
const MODEL_PATH = '/mediapipe/selfie_segmenter.tflite';

export interface PersonSegmenter {
  /**
   * Person mask for the video's CURRENT frame as an RGBA canvas (RGB white,
   * alpha = person confidence), or null while nothing can be segmented yet.
   * Re-segments only when the frame actually changed, so a paused video is
   * free. The returned canvas is reused — draw it, don't keep it.
   */
  maskFor(video: HTMLVideoElement): HTMLCanvasElement | null;
  close(): void;
}

let loading: Promise<PersonSegmenter> | null = null;

/** Loads the model once per page; a failed load is retried on the next call. */
export function loadPersonSegmenter(): Promise<PersonSegmenter> {
  if (!loading) {
    loading = create().catch((err) => {
      loading = null;
      throw err;
    });
  }
  return loading;
}

async function createSegmenter(delegate: 'GPU' | 'CPU') {
  const fileset = await FilesetResolver.forVisionTasks(WASM_DIR);
  return ImageSegmenter.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_PATH, delegate },
    runningMode: 'VIDEO',
    outputConfidenceMasks: true,
    outputCategoryMask: false,
  });
}

async function create(): Promise<PersonSegmenter> {
  let seg: ImageSegmenter;
  try {
    seg = await createSegmenter('GPU');
  } catch {
    // No WebGL delegate available — slower, but the same result.
    seg = await createSegmenter('CPU');
  }

  // The selfie model reports its classes; the person is whichever one is not
  // background (index 1 of ['background', 'person']). Guarded rather than
  // assumed so a differently-labelled model can't silently invert the cut-out.
  const labels = seg.getLabels();
  const personIdx = Math.max(
    0,
    labels.findIndex((l) => /person|selfie|foreground|hair|body/i.test(l)),
  );

  const maskCanvas = document.createElement('canvas');
  let imageData: ImageData | null = null;
  let lastTs = 0;
  let lastVideoTime = -1;
  let haveMask = false;

  return {
    maskFor(video) {
      if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
        return haveMask ? maskCanvas : null;
      }
      // Same frame as last time (paused, or between decoded frames) — reuse.
      if (video.currentTime === lastVideoTime) return maskCanvas;

      // MediaPipe requires strictly increasing timestamps; the video clock
      // goes backwards on seek, so feed it a monotonic clock instead.
      const ts = Math.max(lastTs + 1, Math.round(performance.now()));
      lastTs = ts;

      const result = seg.segmentForVideo(video, ts);
      try {
        const masks = result.confidenceMasks;
        const m = masks?.[Math.min(personIdx, (masks?.length ?? 1) - 1)];
        if (!m) return haveMask ? maskCanvas : null;
        const mw = m.width;
        const mh = m.height;
        if (maskCanvas.width !== mw || maskCanvas.height !== mh || !imageData) {
          maskCanvas.width = mw;
          maskCanvas.height = mh;
          imageData = new ImageData(mw, mh);
        }
        const conf = m.getAsFloat32Array();
        const d = imageData.data;
        for (let i = 0, j = 0; i < conf.length; i++, j += 4) {
          d[j] = 255;
          d[j + 1] = 255;
          d[j + 2] = 255;
          d[j + 3] = (conf[i] * 255) | 0;
        }
        maskCanvas.getContext('2d')!.putImageData(imageData, 0, 0);
        haveMask = true;
        lastVideoTime = video.currentTime;
        return maskCanvas;
      } finally {
        result.close();
      }
    },
    close() {
      seg.close();
    },
  };
}
