/**
 * export/personMatte.ts — "text behind person" for the ON-DEVICE export.
 *
 * The preview's MediaPipe selfie segmenter (kinetic/segmenter.ts) rebuilt to
 * run inside the export's module Web Worker: fed the DECODED frame with that
 * frame's own timestamp (not a <video> and performance.now()), so a render is
 * deterministic. drawPersonOver is the preview's compositing
 * (KineticCaptionLayer.tsx: footage × mask via 'destination-in', drawn over
 * the captions), except the footage sits in the export's letterbox 'contain'
 * rect, so the mask is mapped onto that rect — never stretched over the bars.
 *
 * No DOM; type-checks under both the DOM and the WebWorker libs.
 *
 * ── How export.worker.ts uses it ─────────────────────────────────────────────
 *
 *   // once per job, only when some caption resolves to "behind"
 *   // (behindWindows.ts — this module is imported only then)
 *   const windows = behindWindows(captions, projectDefault);  // captions need behindPerson
 *   const matter = windows.length ? await loadPersonMatter() : null;
 *
 *   process(sample) {
 *     ctx.fillRect(0, 0, W, H);                              // black
 *     sample.drawWithFit(ctx, { fit: 'contain' });           // footage
 *     overlay.draw(ctx, sample.timestamp);                   // captions
 *     if (matter && isBehindAt(windows, sample.timestamp)) {
 *       const mask = matter.maskFor(sample, sample.timestamp * 1000);
 *       drawPersonOver(ctx, sample, mask, W, H);             // person over them
 *     }
 *     return canvas;
 *   }
 *   // finally { matter?.close() }
 *
 * Pass the mediabunny VideoSample itself to both calls (rotation and pixel
 * aspect then match drawWithFit exactly), synchronously inside process().
 * Windows are in caption time and the export draws captions at the sample's
 * timestamp with no preview LEAD, so test `sample.timestamp` as is. The
 * protocol's KineticCaptionInput has no `behindPerson` yet, and the job needs
 * the project default. If loadPersonMatter rejects, fall back to the server
 * export (or tell the user) — don't silently drop the effect.
 *
 * ── Worker gotchas (MediaPipe tasks-vision 1.0.1) ────────────────────────────
 *
 *  - Module workers can't importScripts(). MediaPipe catches the TypeError and
 *    import()s the loader instead — which only works with the ES-module build
 *    (vision_wasm_module_internal.js: `FilesetResolver.forVisionTasks(base,
 *    true)`); the classic build's `var ModuleFactory` stays module-scoped.
 *  - import() is cached per realm, so the loader sets globalThis.ModuleFactory
 *    once, and MediaPipe deletes it after each graph it builds: a SECOND
 *    segmenter in the same worker (CPU fallback, next job) fails with
 *    "ModuleFactory not set." — we import the factory ourselves and re-publish
 *    it before every create (verified: without it the second load fails).
 *  - Pass our own `canvas: OffscreenCanvas`. MediaPipe's default sniffs the UA
 *    and on Safari < 17 calls document.createElement (ReferenceError here).
 *  - WebGL is needed even by the CPU delegate (every input is uploaded as a
 *    texture), so "no WebGL2 in workers" means no matte at all.
 *  - GPU masks are WebGLTextures in MediaPipe's context and can't be posted or
 *    shared. getAsFloat32Array() (readPixels) stalls ~30 ms/frame here, so the
 *    mask is drawn into that context's canvas with MediaPipe's DrawingUtils and
 *    copied GPU-side into the 2D mask canvas. The load verifies that copy
 *    against a readback of a probe frame (alpha within 2/255, structure
 *    present) and uses the readback when it doesn't match (`maskPath`).
 *  - ImageBitmaps created from a worker's OffscreenCanvas are GPU-backed and go
 *    blank when that worker is terminated (bites the dev page, not the export).
 *
 * ── Measured ─────────────────────────────────────────────────────────────────
 *
 * Chrome 153, Windows, i5-1035G1 + Intel UHD (ANGLE D3D11) with the CPU pegged
 * near 100% by other work, so absolute numbers are pessimistic and noisy.
 * 1080×1920 30 fps H.264 source, maxInputEdge 512 (mask 288×512), real
 * Mediabunny Conversion → H.264 at 1080p, 120 frames, ms per frame:
 *
 *                              baseline   with matte   added
 *   GPU, GPU copy  (headless)   23–30      47–49        ~+20–25
 *   GPU, GPU copy  (headed)     22–25      42–48        ~+21–23
 *   GPU, readback  (headed)     22–23      47–49        ~+26–27
 *   CPU delegate   (headless)   16–18      53–63        ~+36–45
 *   CPU delegate   (headed)     24–26      92–100       ~+66–76
 *
 * Isolated (no decode/encode, still frame): GPU ~14–20 ms, CPU ~52–60 ms per
 * segmentation; drawPersonOver itself ~1–2 ms at 1080p. The model input is a
 * fixed 256×256, so maxInputEdge 256 vs 512 costs the same; 512 just gives the
 * model an anti-aliased source. Load: ~1 s CPU, 5–10 s GPU on first use
 * (wasm compile + shader warm-up). Budget roughly 2× export time for GPU,
 * 3–4× for CPU, on weak laptops.
 *
 * ── Known limitations ────────────────────────────────────────────────────────
 *
 *  - Edge quality is the PREVIEW's (MediaPipe selfie model, 256² per frame),
 *    not the server's Robust Video Matting: soft edges, rough hair/fingers,
 *    some shimmer (no temporal memory), and false positives the preview shares
 *    (e.g. a shelf at head height in a tight 16:9 crop was kept as "person").
 *    Export ≡ preview; export ≠ server export.
 *  - Deterministic per frame: the graph has no temporal state; re-segmenting a
 *    re-decoded frame with a much later timestamp gave byte-identical masks.
 *    Timestamps that repeat or go backwards are clamped to last + 1 ms.
 *  - Safari/iOS (not verified here): WebGL in worker OffscreenCanvas needs
 *    Safari 17+; float textures/readback on iOS GPUs are patchy (the load probe
 *    falls back to readback, then to CPU); the 11 MB wasm + decoder + encoder
 *    in one worker sits close to iOS's per-tab memory ceiling.
 *  - Loading on the MAIN thread works but logs a harmless "Cannot use
 *    import.meta outside a module" page error (MediaPipe's <script> attempt at
 *    the module build); the factory we import is used instead.
 *  - A plain VideoFrame/ImageBitmap source carries no rotation metadata; pass
 *    the VideoSample.
 */

import { DrawingUtils, FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';

export const DEFAULT_MATTE_WASM_BASE = '/mediapipe/wasm';
export const DEFAULT_MATTE_MODEL_URL = '/mediapipe/selfie_segmenter.tflite';
export const DEFAULT_MATTE_MAX_INPUT_EDGE = 512;

export type MatteDelegate = 'GPU' | 'CPU';

export interface PersonMatterOptions {
  /** Directory holding vision_wasm_module_internal.{js,wasm}. */
  wasmBase?: string;
  modelUrl?: string;
  /** The frame is downscaled so its longer edge is at most this before segmentation. */
  maxInputEdge?: number;
  /** Force one delegate (benchmarks). Default: GPU, falling back to CPU. */
  delegate?: MatteDelegate;
  /**
   * GPU delegate: copy the mask into the mask canvas on the GPU (default)
   * rather than reading it back to a Float32Array. `false` is for comparison.
   */
  gpuMaskCopy?: boolean;
}

/**
 * A decoded frame that knows how to draw itself — mediabunny's VideoSample.
 * Structural, so this module doesn't depend on mediabunny.
 */
export interface MatteFrame {
  /** Display size after pixel-aspect and rotation (what 'contain' fits). */
  readonly displayWidth: number;
  readonly displayHeight: number;
  drawWithFit(ctx: OffscreenCanvasRenderingContext2D, options: { fit: 'contain' | 'fill' }): void;
}

export type MatteSource = MatteFrame | CanvasImageSource | VideoFrame;

export interface PersonMatter {
  /** The delegate actually in use. */
  readonly delegate: MatteDelegate;
  /** Why the GPU delegate was not used (null when it is, or when CPU was forced). */
  readonly gpuError: string | null;
  /** How masks reach the mask canvas: a GPU-side copy, or a readback to the CPU. */
  readonly maskPath: 'gpu-copy' | 'readback';
  /** Wall time of the load (wasm + model + graph + probe), ms. */
  readonly loadMs: number;
  /** Cumulative per-stage wall time of maskFor, for diagnostics. */
  readonly stats: MatteStats;
  /**
   * Person mask for `source` as an RGBA canvas at (about — MediaPipe may round
   * by a pixel) the downscaled input size, RGB white, alpha = person
   * confidence: the preview's encoding. The mask covers the whole displayed
   * source. `timestampMs` should be the frame's own
   * presentation time; it is clamped to be strictly increasing.
   *
   * The returned canvas is reused by the next call — draw it, don't keep it.
   */
  maskFor(source: MatteSource, timestampMs: number): OffscreenCanvas;
  close(): void;
}

export interface MatteStats {
  frames: number;
  /** Downscaling the frame onto the input canvas. */
  drawMs: number;
  /** segmentForVideo (includes uploading the input and flushing its draw). */
  segmentMs: number;
  /** Getting the mask into the mask canvas (GPU copy, or readback + RGBA loop). */
  maskMs: number;
}

type ModuleFactoryFn = (arg?: unknown) => Promise<unknown>;
/** Not exported by tasks-vision 1.0.1. */
type WasmFileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isMatteFrame(s: MatteSource): s is MatteFrame {
  return typeof (s as Partial<MatteFrame>).drawWithFit === 'function';
}

/** The size `source` is displayed at — what a 'contain' fit scales. */
export function matteSourceSize(source: MatteSource): [number, number] | null {
  const o = source as unknown as Record<string, unknown>;
  const pick = (a: string, b: string): [number, number] | null => {
    const w = o[a];
    const h = o[b];
    return typeof w === 'number' && typeof h === 'number' && w > 0 && h > 0 ? [w, h] : null;
  };
  // VideoSample / VideoFrame, <video>, <img>, then canvases and ImageBitmap.
  return (
    pick('displayWidth', 'displayHeight') ??
    pick('videoWidth', 'videoHeight') ??
    pick('naturalWidth', 'naturalHeight') ??
    pick('width', 'height')
  );
}

/** Where 'contain' places a sw×sh source on a W×H frame (mediabunny's maths). */
export function containRect(sw: number, sh: number, W: number, H: number) {
  const scale = Math.min(W / sw, H / sh);
  const w = sw * scale;
  const h = sh * scale;
  return { x: (W - w) / 2, y: (H - h) / 2, w, h };
}

function absoluteUrl(path: string): string {
  // An absolute http(s) URL: MediaPipe import()s the loader from this, and a
  // root-relative specifier would be resolved against the bundled chunk and is
  // the form dev servers rewrite.
  const base = (globalThis as { location?: { href: string } }).location?.href;
  return base ? new URL(path, base).href : path;
}

/**
 * The module (ES) build of the wasm loader. Module workers can't
 * importScripts(); MediaPipe then falls back to `import()`, which needs the
 * `_module_` build (the classic one declares ModuleFactory with a
 * module-scoped `var`, so the global never appears).
 *
 * import() is cached per realm, so the loader only sets
 * `globalThis.ModuleFactory` the FIRST time — and MediaPipe deletes that
 * global after every graph it creates. A second segmenter in the same worker
 * (the CPU fallback, the next export job) would fail with "ModuleFactory not
 * set." We import the factory ourselves and re-publish it before each create.
 */
async function wasmFileset(wasmBase: string): Promise<{ fileset: WasmFileset; factory: ModuleFactoryFn }> {
  const fileset = await FilesetResolver.forVisionTasks(absoluteUrl(wasmBase).replace(/\/+$/, ''), true);
  const mod = (await import(/* @vite-ignore */ fileset.wasmLoaderPath)) as { default?: ModuleFactoryFn };
  const factory =
    mod.default ?? (globalThis as unknown as { ModuleFactory?: ModuleFactoryFn }).ModuleFactory;
  if (typeof factory !== 'function') {
    throw new Error(`MediaPipe loader at ${fileset.wasmLoaderPath} did not export a ModuleFactory`);
  }
  return { fileset, factory };
}

async function createSegmenter(
  fileset: WasmFileset,
  factory: ModuleFactoryFn,
  modelUrl: string,
  delegate: MatteDelegate,
  canvas: OffscreenCanvas,
): Promise<ImageSegmenter> {
  (globalThis as unknown as { ModuleFactory?: ModuleFactoryFn }).ModuleFactory = factory;
  return ImageSegmenter.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: modelUrl, delegate },
    // Our own canvas: MediaPipe's default sniffs the UA and, on Safari < 17,
    // calls document.createElement — a ReferenceError in a worker. It is also
    // the WebGL context the GPU mask copy below draws with.
    canvas,
    runningMode: 'VIDEO',
    outputConfidenceMasks: true,
    outputCategoryMask: false,
  });
}

type SegmentResult = ReturnType<ImageSegmenter['segmentForVideo']>;
type ConfidenceMask = NonNullable<SegmentResult['confidenceMasks']>[number];

/** Writes a confidence mask into the RGBA mask canvas (RGB white, alpha = confidence). */
type MaskWriter = ((m: ConfidenceMask) => void) & { close?: () => void };

/**
 * GPU delegate: the mask is a WebGL texture in MediaPipe's own context.
 * Reading it back (getAsFloat32Array → readPixels) stalls the worker on the
 * GPU for tens of ms per frame; instead MediaPipe's DrawingUtils renders it
 * into that context's canvas and the 2D mask canvas copies it GPU-side.
 */
function gpuMaskWriter(glCanvas: OffscreenCanvas, mctx: OffscreenCanvasRenderingContext2D): MaskWriter | null {
  const gl = glCanvas.getContext('webgl2') as WebGL2RenderingContext | null;
  if (!gl) return null;
  const attrs = gl.getContextAttributes();
  if (attrs && attrs.alpha === false) return null;
  const drawer = new DrawingUtils(gl);
  // (c,c,c,c) is premultiplied white at alpha c; unpremultiplied needs (1,1,1,c).
  const premultiplied = attrs?.premultipliedAlpha !== false;
  const low: [number, number, number, number] = premultiplied ? [0, 0, 0, 0] : [255, 255, 255, 0];
  const high: [number, number, number, number] = [255, 255, 255, 255];
  const write: MaskWriter = (m) => {
    const fb = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    if (glCanvas.width !== m.width || glCanvas.height !== m.height) {
      glCanvas.width = m.width;
      glCanvas.height = m.height;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, m.width, m.height);
    drawer.drawConfidenceMask(m, low, high);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    mctx.globalCompositeOperation = 'copy';
    mctx.drawImage(glCanvas, 0, 0, m.width, m.height);
    mctx.globalCompositeOperation = 'source-over';
  };
  write.close = () => drawer.close();
  return write;
}

/** CPU delegate (or no GPU copy): read the confidences and build the mask — the preview's loop. */
function cpuMaskWriter(mctx: OffscreenCanvasRenderingContext2D): MaskWriter {
  let imageData: ImageData | null = null;
  return (m) => {
    if (!imageData || imageData.width !== m.width || imageData.height !== m.height) {
      imageData = new ImageData(m.width, m.height);
    }
    const conf = m.getAsFloat32Array();
    const d = imageData.data;
    for (let i = 0, j = 0; i < conf.length; i++, j += 4) {
      d[j] = 255;
      d[j + 1] = 255;
      d[j + 2] = 255;
      d[j + 3] = (conf[i] * 255) | 0;
    }
    mctx.putImageData(imageData, 0, 0);
  };
}

/** 64×64 dark room, skin-toned head (off-centre), hair, blue shoulders. */
function probeFrame(): OffscreenCanvas {
  const c = new OffscreenCanvas(64, 64);
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = '#20242a';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#d9a07a';
    g.beginPath();
    g.ellipse(28, 24, 11, 14, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#3a2a20';
    g.beginPath();
    g.ellipse(28, 13, 12, 7, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#1b3b8a';
    g.beginPath();
    g.ellipse(30, 64, 26, 24, 0, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

interface Engine {
  seg: ImageSegmenter;
  write: MaskWriter;
}

/**
 * Load the selfie segmenter for export. GPU delegate first — verified by
 * segmenting a probe frame through the exact mask path — CPU on any failure.
 * Load once per job.
 */
export async function loadPersonMatter(opts: PersonMatterOptions = {}): Promise<PersonMatter> {
  const started = performance.now();
  const wasmBase = opts.wasmBase ?? DEFAULT_MATTE_WASM_BASE;
  const modelUrl = absoluteUrl(opts.modelUrl ?? DEFAULT_MATTE_MODEL_URL);
  const maxEdge = Math.max(16, Math.round(opts.maxInputEdge ?? DEFAULT_MATTE_MAX_INPUT_EDGE));

  if (typeof OffscreenCanvas === 'undefined') {
    throw new Error('OffscreenCanvas is not available, so MediaPipe cannot run here');
  }

  const input = new OffscreenCanvas(1, 1);
  const ictx = input.getContext('2d');
  const maskCanvas = new OffscreenCanvas(1, 1);
  const mctx = maskCanvas.getContext('2d');
  if (!ictx || !mctx) throw new Error('2D OffscreenCanvas unavailable');

  const { fileset, factory } = await wasmFileset(wasmBase);

  const writeMask = (engine: Engine, result: SegmentResult, personIdx: number) => {
    const masks = result.confidenceMasks;
    const m = masks?.[Math.min(personIdx, (masks?.length ?? 1) - 1)];
    if (!m) throw new Error('segmenter returned no confidence mask');
    // The mask comes back at the input's size.
    if (maskCanvas.width !== m.width || maskCanvas.height !== m.height) {
      maskCanvas.width = m.width;
      maskCanvas.height = m.height;
    }
    engine.write(m);
  };

  const tryDelegate = async (d: MatteDelegate): Promise<Engine> => {
    const glCanvas = new OffscreenCanvas(1, 1);
    let seg: ImageSegmenter | null = null;
    let gpuWrite: MaskWriter | null = null;
    try {
      seg = await createSegmenter(fileset, factory, modelUrl, d, glCanvas);
      gpuWrite = d === 'GPU' && opts.gpuMaskCopy !== false ? gpuMaskWriter(glCanvas, mctx) : null;
      const readback = cpuMaskWriter(mctx);
      // Probe: segment a tiny synthetic head-and-shoulders (the model finds a
      // person in it) through the real mask path. For the GPU copy, check it
      // against the readback of the same mask — a mismatch (flipped, blank,
      // wrong alpha convention on some engine) means we use the readback.
      const result = seg.segmentForVideo(probeFrame(), 0);
      let write: MaskWriter = readback;
      try {
        const masks = result.confidenceMasks;
        const m = masks?.[0];
        if (!m) throw new Error('segmenter returned no confidence mask');
        const conf = m.getAsFloat32Array();
        if (gpuWrite) {
          maskCanvas.width = m.width;
          maskCanvas.height = m.height;
          gpuWrite(m);
          const got = mctx.getImageData(0, 0, m.width, m.height).data;
          let lo = 1;
          let hi = 0;
          let err = 0;
          for (let i = 0; i < conf.length; i++) {
            lo = Math.min(lo, conf[i]);
            hi = Math.max(hi, conf[i]);
            err += Math.abs(got[i * 4 + 3] - conf[i] * 255);
          }
          // Needs a mask with structure to prove anything, then ≤ 2/255 on average.
          if (hi - lo > 0.5 && err / conf.length <= 2) write = gpuWrite;
          else gpuWrite.close?.();
        }
        writeMask({ seg, write }, result, 0);
      } finally {
        result.close();
      }
      return { seg, write };
    } catch (err) {
      gpuWrite?.close?.();
      seg?.close();
      throw err;
    }
  };

  let engine: Engine | null = null;
  let delegate: MatteDelegate = opts.delegate ?? 'GPU';
  let gpuError: string | null = null;
  if (delegate === 'GPU') {
    try {
      engine = await tryDelegate('GPU');
    } catch (err) {
      gpuError = errorText(err);
      if (opts.delegate === 'GPU') throw new Error(`GPU delegate unavailable: ${gpuError}`);
      delegate = 'CPU';
    }
  }
  if (!engine) engine = await tryDelegate('CPU');
  const ready = engine;
  // The probe used timestamp 0.
  let lastTs = 0;

  // Same guard as the preview: the person is whichever class isn't background.
  // The selfie model has one output, so this resolves to mask 0.
  const labels = ready.seg.getLabels();
  const personIdx = Math.max(
    0,
    labels.findIndex((l) => /person|selfie|foreground|hair|body/i.test(l)),
  );

  let closed = false;
  const stats: MatteStats = { frames: 0, drawMs: 0, segmentMs: 0, maskMs: 0 };

  return {
    delegate,
    gpuError,
    maskPath: ready.write.close ? 'gpu-copy' : 'readback',
    loadMs: Math.round(performance.now() - started),
    stats,

    maskFor(source, timestampMs) {
      if (closed) throw new Error('PersonMatter is closed');
      const size = matteSourceSize(source);
      if (!size) throw new Error('maskFor: source has no size');
      const scale = Math.min(1, maxEdge / Math.max(size[0], size[1]));
      const iw = Math.max(1, Math.round(size[0] * scale));
      const ih = Math.max(1, Math.round(size[1] * scale));
      if (input.width !== iw || input.height !== ih) {
        input.width = iw;
        input.height = ih;
      }

      // Downscale the WHOLE displayed frame (rotation and pixel aspect applied
      // for a VideoSample), so mask pixel (0,0)…(iw,ih) spans the source's
      // contain rect exactly.
      let t = performance.now();
      ictx.setTransform(1, 0, 0, 1, 0, 0);
      ictx.imageSmoothingEnabled = true;
      ictx.imageSmoothingQuality = 'medium';
      ictx.clearRect(0, 0, iw, ih);
      if (isMatteFrame(source)) source.drawWithFit(ictx, { fit: 'fill' });
      else ictx.drawImage(source as CanvasImageSource, 0, 0, iw, ih);

      // VIDEO mode needs strictly increasing timestamps; a repeated or
      // backwards one (seek, B-frame reorder glitch) is nudged forward. The
      // selfie graph keeps no temporal state, so this never changes a mask.
      const wanted = Number.isFinite(timestampMs) ? Math.round(timestampMs) : lastTs + 1;
      const ts = Math.max(lastTs + 1, wanted);
      lastTs = ts;

      let now = performance.now();
      stats.drawMs += now - t;
      t = now;
      const result = ready.seg.segmentForVideo(input, ts);
      now = performance.now();
      stats.segmentMs += now - t;
      t = now;
      try {
        writeMask(ready, result, personIdx);
      } finally {
        result.close();
      }
      stats.maskMs += performance.now() - t;
      stats.frames++;
      return maskCanvas;
    },

    close() {
      if (closed) return;
      closed = true;
      ready.write.close?.();
      ready.seg.close();
    },
  };
}

/* ------------------------------------------------------------ compositing */

const cutouts = new WeakMap<object, OffscreenCanvas>();

/**
 * Draw the person (the footage, kept only where `mask` says person) over
 * whatever is already on `ctx` — the preview's compositing. The footage is
 * placed with the same 'contain' fit the export uses on a W×H frame, and the
 * mask (which spans the whole displayed source) is drawn onto that contain
 * rect, so letterbox bars are never covered.
 *
 * `frame` should be the object the frame was drawn from: the mediabunny
 * VideoSample (preferred — rotation-aware), or any CanvasImageSource.
 */
export function drawPersonOver(
  ctx: OffscreenCanvasRenderingContext2D,
  frame: MatteFrame | CanvasImageSource | VideoFrame,
  mask: OffscreenCanvas,
  W: number,
  H: number,
): void {
  const size = matteSourceSize(frame) ?? [mask.width, mask.height];
  const r = containRect(size[0], size[1], W, H);

  let cut = cutouts.get(ctx);
  if (!cut) {
    cut = new OffscreenCanvas(W, H);
    cutouts.set(ctx, cut);
  }
  if (cut.width !== W || cut.height !== H) {
    cut.width = W;
    cut.height = H;
  }
  const cctx = cut.getContext('2d');
  if (!cctx) return;

  cctx.setTransform(1, 0, 0, 1, 0, 0);
  cctx.globalAlpha = 1;
  cctx.imageSmoothingEnabled = true;
  cctx.globalCompositeOperation = 'source-over';
  cctx.clearRect(0, 0, W, H);
  if (isMatteFrame(frame)) frame.drawWithFit(cctx, { fit: 'contain' });
  else cctx.drawImage(frame as CanvasImageSource, r.x, r.y, r.w, r.h);
  cctx.setTransform(1, 0, 0, 1, 0, 0);
  cctx.globalCompositeOperation = 'destination-in';
  cctx.drawImage(mask, r.x, r.y, r.w, r.h);
  cctx.globalCompositeOperation = 'source-over';

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.filter = 'none';
  ctx.drawImage(cut, 0, 0);
  ctx.restore();
}

/* ------------------------------------------------------------------ windows */

// Kept in behindWindows.ts (no MediaPipe) so deciding whether a matte is needed
// never loads the segmenter.
export { behindWindows, isBehindAt, type BehindCaption } from './behindWindows';
