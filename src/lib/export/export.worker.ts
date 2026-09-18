/**
 * export.worker.ts — renders a captioned video entirely on this device.
 *
 *   source File ─ Mediabunny Input (demux) ─ VideoDecoder (WebCodecs, GPU)
 *     └─ process(frame): black canvas ← frame drawn "contain" ← captions drawn
 *          └─ VideoEncoder (H.264 / VP9, hardware when available)
 *   audio packets are copied straight across (no re-encode) whenever the
 *   output container can hold the source codec
 *   └─ muxed and streamed into OPFS (exports/<id>.mp4) — never held whole in memory
 *
 * The output frame matches the server's burn-in: same pixel size
 * (render/frame.ts), same letterbox-on-black fit, rotation baked in, captions
 * at the source frame's own timestamp with no preview lead.
 */

import {
  ALL_FORMATS,
  BlobSource,
  Conversion,
  ConversionCanceledError,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  StreamTarget,
  WebMOutputFormat,
  canEncodeAudio,
  canEncodeVideo,
  type ConversionAudioOptions,
  type StreamTargetChunk,
  type VideoSample,
} from 'mediabunny';
import { buildKineticComposition, renderKineticFrame, type TextCtx } from '../kinetic/engine';
import type {
  ExportErrorCode,
  ExportJob,
  ExportResult,
  ExportWorkerIn,
  ExportWorkerOut,
} from './protocol';
import { fingerprintMismatches, loadKineticFontsForWorker } from './workerFonts';
import { loadLayoutFonts } from './layout/layoutFonts';
import { createLayoutPainter } from './layout/painter';
import { isBehindAt } from './behindWindows';
// personMatte.ts (MediaPipe) is imported only by exports with text behind person.
import type { PersonMatter } from './personMatte';

type MatteModule = typeof import('./personMatte');

class ExportFailure extends Error {
  readonly code: ExportErrorCode;
  constructor(code: ExportErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

function post(msg: ExportWorkerOut) {
  self.postMessage(msg);
}

interface JobState {
  cancelled: boolean;
  conversion: Conversion | null;
}

let active: JobState | null = null;

self.onmessage = (e: MessageEvent<ExportWorkerIn>) => {
  const msg = e.data;
  if (msg.type === 'cancel') {
    if (active) {
      active.cancelled = true;
      void active.conversion?.cancel().catch(() => undefined);
    }
    return;
  }
  if (msg.type === 'start') {
    if (active) {
      post({ type: 'error', code: 'FAILED', message: 'An export is already running in this worker' });
      return;
    }
    void run(msg.job);
  }
};

/* ---------------------------------------------------------------- OPFS sink */

interface OpfsSink {
  stream: WritableStream<StreamTargetChunk>;
  /** The finished file (call after the output is finalized). */
  file(): Promise<File>;
  /** Drop the partial file. */
  discard(): Promise<void>;
}

async function openOpfsSink(path: string): Promise<OpfsSink> {
  const parts = path.split('/').filter(Boolean);
  const name = parts.pop();
  if (!name) throw new ExportFailure('FAILED', `Bad output path "${path}"`);
  let dir = await navigator.storage.getDirectory();
  for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });
  const handle = await dir.getFileHandle(name, { create: true });

  let release = () => {};
  let stream: WritableStream<StreamTargetChunk>;

  if (typeof handle.createSyncAccessHandle === 'function') {
    // Random-access synchronous writes: the one OPFS write API every engine
    // with WebCodecs has in workers (Safari since 15.2).
    const access = await handle.createSyncAccessHandle();
    access.truncate(0);
    let open = true;
    release = () => {
      if (!open) return;
      open = false;
      try {
        access.flush();
      } catch {
        /* closing anyway */
      }
      access.close();
    };
    stream = new WritableStream<StreamTargetChunk>({
      write(chunk) {
        const written = access.write(chunk.data, { at: chunk.position });
        if (written !== chunk.data.byteLength) {
          throw new ExportFailure('STORAGE', 'The device ran out of storage while writing the video');
        }
      },
      close() {
        release();
      },
      abort() {
        release();
      },
    });
  } else {
    // createWritable() is itself a WritableStream accepting {type:'write', position, data}.
    stream = (await handle.createWritable()) as unknown as WritableStream<StreamTargetChunk>;
  }

  return {
    stream,
    async file() {
      release();
      return handle.getFile();
    },
    async discard() {
      try {
        release();
      } catch {
        /* already closed */
      }
      await dir.removeEntry(name).catch(() => undefined);
    },
  };
}

/* ----------------------------------------------------------------- overlays */

interface PreparedOverlay {
  draw(ctx: OffscreenCanvasRenderingContext2D, timeSec: number): void;
  fingerprints: Record<string, number>;
  fingerprintMismatch: string[];
}

async function prepareOverlay(job: ExportJob): Promise<PreparedOverlay> {
  const o = job.overlay;
  if (o.kind === 'layout') {
    let loaded;
    try {
      loaded = await loadLayoutFonts(o.fonts, o.track.fontUses);
    } catch (err) {
      throw new ExportFailure('FONTS', `Caption fonts could not be loaded: ${errorMessage(err)}`);
    }
    if (loaded.unmatched.length) {
      console.warn('[export] no font files found for', loaded.unmatched, '- system fallback in use');
    }
    const painter = createLayoutPainter(o.track, job.width, job.height);
    return {
      draw(ctx, timeSec) {
        painter.draw(ctx, timeSec);
      },
      fingerprints: {},
      fingerprintMismatch: [],
    };
  }
  let fonts;
  try {
    fonts = await loadKineticFontsForWorker(o.template, job.fontsBase);
  } catch (err) {
    throw new ExportFailure('FONTS', `Caption fonts could not be loaded: ${errorMessage(err)}`);
  }
  const comp = buildKineticComposition({
    template: o.template,
    captions: o.captions,
    accentColor: o.accentColor,
    baseColor: o.baseColor,
    frame: { W: job.width, H: job.height },
    metricsFor: fonts.metricsFor,
    fontFor: fonts.fontFor,
    fontScale: o.fontScale,
    params: o.params,
  });
  const fingerprints = comp.fingerprints as Record<string, number>;
  return {
    draw(ctx, timeSec) {
      renderKineticFrame(ctx as unknown as TextCtx, comp, { timeSec, clear: false });
    },
    fingerprints,
    fingerprintMismatch: fingerprintMismatches(comp.fingerprints),
  };
}

/* --------------------------------------------------------------------- job */

const THUMB_MAX_EDGE = 360;

function snapshotThumbnail(canvas: OffscreenCanvas): Promise<Blob | null> {
  const scale = Math.min(1, THUMB_MAX_EDGE / Math.max(canvas.width, canvas.height));
  const w = Math.max(2, Math.round(canvas.width * scale));
  const h = Math.max(2, Math.round(canvas.height * scale));
  const thumb = new OffscreenCanvas(w, h);
  const tctx = thumb.getContext('2d');
  if (!tctx) return Promise.resolve(null);
  // drawImage copies the pixels now; the encode loop may redraw `canvas` next.
  tctx.drawImage(canvas, 0, 0, w, h);
  return thumb.convertToBlob({ type: 'image/jpeg', quality: 0.72 }).catch(() => null);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function checkCancelled(state: JobState) {
  if (state.cancelled) throw new ExportFailure('CANCELLED', 'Export cancelled');
}

async function run(job: ExportJob): Promise<void> {
  const state: JobState = { cancelled: false, conversion: null };
  active = state;
  const started = performance.now();
  let input: Input | null = null;
  let sink: OpfsSink | null = null;
  let matter: PersonMatter | null = null;
  let matteLoad: Promise<{ lib: MatteModule; matter: PersonMatter }> | null = null;

  try {
    // Text behind person is the only thing that needs the person matte, so
    // every other export skips it entirely: no segmenter code, WASM or model.
    // When it IS needed it loads alongside the font and video preparation
    // below instead of holding them up.
    const windows = job.overlay.kind === 'kinetic' ? (job.overlay.behindWindows ?? []) : [];
    let matteSettled = false;
    if (windows.length) {
      matteLoad = import('./personMatte').then(async (lib) => ({ lib, matter: await lib.loadPersonMatter() }));
      // Also keeps a failure from going unhandled when an earlier step throws first.
      void matteLoad.then(
        () => (matteSettled = true),
        () => (matteSettled = true),
      );
    }

    post({ type: 'progress', stage: 'fonts', percent: 1 });
    const overlay = await prepareOverlay(job);
    checkCancelled(state);

    post({ type: 'progress', stage: 'prepare', percent: 3 });
    input = new Input({ formats: ALL_FORMATS, source: new BlobSource(job.source) });
    const video = await input.getPrimaryVideoTrack();
    if (!video) throw new ExportFailure('UNSUPPORTED', 'The source file has no video track');
    if (!(await video.canDecode())) {
      throw new ExportFailure('UNSUPPORTED', `This browser can't decode ${video.codec ?? 'this'} video`);
    }
    const audio = await input.getPrimaryAudioTrack();

    const W = job.width;
    const H = job.height;
    const videoCodec = job.format === 'webm' ? 'vp9' : 'avc';
    // A quantizer (constant quality, like x264's CRF) where set — the bitrate is
    // then Mediabunny's fallback for encoders without that mode — else bitrate.
    // NB: a bare number passed to Quality is a 0–1 quality LEVEL, not a bitrate.
    const q = job.tuning?.quantizer ?? job.videoQuantizer;
    const sourceRate = await video
      .computePacketStats(120)
      .then((s) => s.averagePacketRate)
      .catch(() => 0);
    const frameRateCap = job.tuning?.frameRate ?? job.frameRate;
    // Only ever lowers the rate: encoding is the slow step, so a 60 fps source
    // capped at 30 renders in about half the time.
    const frameRate = frameRateCap && sourceRate > frameRateCap * 1.05 ? frameRateCap : undefined;
    // Uncapped, the encoder isn't told the source rate and budgets per frame as
    // if it were 30 fps — a 60 fps render would come out at twice the bitrate.
    const bitrate =
      !frameRate && sourceRate > 31 ? Math.round(job.videoBitrate * (30 / sourceRate)) : job.videoBitrate;
    const quality = q > 0 ? new Quality({ quantizer: q, bitrate }) : new Quality({ bitrate });
    if (!(await canEncodeVideo(videoCodec, { width: W, height: H, quality }))) {
      throw new ExportFailure(
        'UNSUPPORTED',
        `This device can't encode ${videoCodec === 'avc' ? 'H.264' : 'VP9'} at ${W}×${H}`,
      );
    }

    // Audio: copy the packets when the container can hold the codec (no
    // quality loss, no encoder needed — Safari's AAC encoder is broken and
    // Firefox/Linux have none). Otherwise re-encode to the container's codec.
    const format =
      job.format === 'webm' ? new WebMOutputFormat() : new Mp4OutputFormat({
        // Small files get the index up front (streamable, like ffmpeg's
        // +faststart); long ones write it at the end so memory stays flat.
        fastStart: W * H * (await input.computeDuration()) <= 1920 * 1080 * 90 ? 'in-memory' : false,
      });
    let audioMode: ExportResult['audio'] = 'none';
    let audioOptions: ConversionAudioOptions = { discard: true };
    if (audio) {
      if (audio.codec && format.getSupportedAudioCodecs().includes(audio.codec)) {
        audioMode = 'copied';
        audioOptions = {};
      } else {
        const target = job.format === 'webm' ? 'opus' : 'aac';
        if (!(await audio.canDecode())) {
          throw new ExportFailure('UNSUPPORTED', `This browser can't decode ${audio.codec ?? 'this'} audio`);
        }
        if (!(await canEncodeAudio(target))) {
          if (target !== 'aac') {
            throw new ExportFailure('UNSUPPORTED', "This browser can't encode Opus audio for WebM");
          }
          const { registerAacEncoder } = await import('@mediabunny/aac-encoder');
          registerAacEncoder();
        }
        audioMode = 'transcoded';
        audioOptions = { codec: target };
      }
    }
    checkCancelled(state);

    let drawPersonOver: MatteModule['drawPersonOver'] | null = null;
    if (matteLoad) {
      if (!matteSettled) post({ type: 'progress', stage: 'matte', percent: 3 });
      try {
        const loaded = await matteLoad;
        matter = loaded.matter;
        drawPersonOver = loaded.lib.drawPersonOver;
      } catch (err) {
        throw new ExportFailure(
          'UNSUPPORTED',
          `Text behind person couldn't start on this device (${errorMessage(err)})`,
        );
      }
      checkCancelled(state);
    }

    sink = await openOpfsSink(job.outputPath);
    const output = new Output({ format, target: new StreamTarget(sink.stream, { chunked: true }) });

    const canvas = new OffscreenCanvas(W, H);
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new ExportFailure('UNSUPPORTED', '2D canvas unavailable in this worker');

    let frames = 0;
    let processMs = 0;
    let overlayMs = 0;
    const tuning = job.tuning ?? {};
    let thumbnail: Promise<Blob | null> | null = null;

    const process = (sample: VideoSample) => {
      const p0 = performance.now();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      // Letterbox on black, rotation applied — the server's scale+pad.
      sample.drawWithFit(ctx, { fit: 'contain' });
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const o0 = performance.now();
      if (!tuning.noOverlay) overlay.draw(ctx, sample.timestamp);
      overlayMs += performance.now() - o0;
      if (matter && drawPersonOver && isBehindAt(windows, sample.timestamp)) {
        const mask = matter.maskFor(sample, sample.timestamp * 1000);
        drawPersonOver(ctx, sample, mask, W, H);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
      }
      frames++;
      if (!thumbnail && sample.timestamp >= job.thumbnailAt) thumbnail = snapshotThumbnail(canvas);
      processMs += performance.now() - p0;
      return tuning.noEncode ? null : canvas;
    };

    const conversion = await Conversion.init({
      input,
      output,
      tracks: 'primary',
      showWarnings: false,
      video: {
        codec: videoCodec,
        quality,
        process,
        processedWidth: W,
        processedHeight: H,
        // Bake any rotation into the pixels; the output carries no rotation tag.
        allowRotationMetadata: false,
        hardwareAcceleration: tuning.hardwareAcceleration,
        frameRate,
      },
      audio: audioOptions,
    });

    const lostVideo = conversion.discardedTracks.find((d) => d.track.isVideoTrack());
    const lostAudio = audio ? conversion.discardedTracks.find((d) => d.track.isAudioTrack()) : undefined;
    if (!conversion.isValid || lostVideo || lostAudio) {
      const why = (lostVideo ?? lostAudio)?.reason ?? 'invalid conversion';
      throw new ExportFailure(
        'UNSUPPORTED',
        `This device can't produce the ${lostVideo || !lostAudio ? 'video' : 'audio'} track (${why})`,
      );
    }
    state.conversion = conversion;
    checkCancelled(state);

    let lastPost = 0;
    conversion.onProgress = (p, processedSec) => {
      const now = performance.now();
      if (now - lastPost < 150 && p < 1) return;
      lastPost = now;
      post({ type: 'progress', stage: 'render', percent: 4 + p * 94, processedSec });
    };

    const loop0 = performance.now();
    await conversion.execute();
    const renderLoopMs = performance.now() - loop0;
    post({ type: 'progress', stage: 'finalize', percent: 99 });

    const file = await sink.file();
    const thumb = await (thumbnail ?? snapshotThumbnail(canvas));
    const durationSec = await input.computeDuration().catch(() => 0);

    const result: ExportResult = {
      outputPath: job.outputPath,
      sizeBytes: file.size,
      width: W,
      height: H,
      durationSec,
      videoCodec,
      audio: audioMode,
      audioCodec: audioMode === 'none' ? null : audioMode === 'copied' ? (audio?.codec ?? null) : String(audioOptions.codec),
      frames,
      renderMs: Math.round(performance.now() - started),
      thumbnail: thumb,
      fingerprints: overlay.fingerprints,
      fingerprintMismatch: overlay.fingerprintMismatch,
      stats: { processMs: Math.round(processMs), overlayMs: Math.round(overlayMs), renderLoopMs: Math.round(renderLoopMs) },
    };
    if (result.fingerprintMismatch.length) {
      console.warn('[export] font fingerprints differ from the server:', result.fingerprintMismatch);
    }
    post({ type: 'done', result });
  } catch (err) {
    await sink?.discard().catch(() => undefined);
    let code: ExportErrorCode;
    if (state.cancelled || err instanceof ConversionCanceledError) code = 'CANCELLED';
    else if (err instanceof ExportFailure) code = err.code;
    else if ((err as DOMException)?.name === 'QuotaExceededError') code = 'STORAGE';
    else code = 'FAILED';
    const message =
      code === 'CANCELLED'
        ? 'Export cancelled'
        : code === 'STORAGE'
          ? 'Not enough free storage on this device for the rendered video'
          : errorMessage(err);
    if (code === 'FAILED') console.error('[export] render failed', err);
    post({ type: 'error', code, message });
  } finally {
    try {
      matter?.close();
    } catch {
      /* already closed */
    }
    // Stopped before the matte finished loading: close it once it has.
    if (!matter && matteLoad) {
      void matteLoad.then(
        (loaded) => loaded.matter.close(),
        () => undefined,
      );
    }
    input?.dispose();
    active = null;
  }
}
