/**
 * export/matteTest.worker.ts — exercises personMatte.ts the way the export
 * worker will: in a module worker, on frames decoded by Mediabunny, at the
 * export's frame sizes. Driven by /dev/matte (pages/MatteDevPage.tsx) or
 * directly from a test (`new Worker('/src/lib/export/matteTest.worker.ts?worker_file&type=module', {type:'module'})`).
 *
 *   1. load the matter (reports delegate + load time)
 *   2. decode [0, seconds) with VideoSampleSink; per frame: maskFor, then per
 *      layout draw black + footage ('contain') + a big test caption and
 *      drawPersonOver — timing each stage; snapshot a few frames as bitmaps
 *   3. determinism: re-decode the snapshot frames, segment them again with
 *      later timestamps, compare the masks
 *   4. optional: a real H.264 encode (Conversion, in memory) per layout, with
 *      and without the matte, for end-to-end ms/frame
 */

import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  VideoSampleSink,
  type VideoSample,
} from 'mediabunny';
import { exportVideoBitrate, exportVideoQuantizer } from '../render/frame';
import type {
  MatteEncodeBench,
  MatteSnapshot,
  MatteTestLayout,
  MatteTestOut,
  MatteTestRequest,
  MatteTestResult,
} from './matteProtocol';
import { containRect, drawPersonOver, loadPersonMatter, type PersonMatter } from './personMatte';

function post(msg: MatteTestOut, transfer: Transferable[] = []) {
  self.postMessage(msg, transfer);
}

let busy = false;

self.onmessage = (e: MessageEvent<MatteTestRequest>) => {
  if (e.data?.type !== 'run') return;
  if (busy) {
    post({ type: 'error', message: 'a run is already in progress' });
    return;
  }
  busy = true;
  void run(e.data)
    .catch((err: unknown) => {
      console.error('[matte-test]', err);
      post({ type: 'error', message: err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err) });
    })
    .finally(() => {
      busy = false;
    });
};

/* ------------------------------------------------------------------ drawing */

type Ctx = OffscreenCanvasRenderingContext2D;

/** Big caption across the person's face/neck, plus a band that runs into the bars. */
function drawTestCaption(ctx: Ctx, W: number, H: number, sample: VideoSample) {
  const r = containRect(sample.displayWidth, sample.displayHeight, W, H);
  const y = r.y + r.h * 0.4;
  ctx.save();
  // Full-frame-width band: where it crosses letterbox/pillarbox bars it must
  // stay visible (the cut-out is transparent outside the footage).
  ctx.fillStyle = 'rgba(255, 0, 170, 0.55)';
  const band = Math.round(Math.min(W, H) * 0.035);
  ctx.fillRect(0, y + Math.min(W, H) * 0.12, W, band);

  const text = 'BEHIND';
  let size = Math.round(Math.min(W, H) * 0.3);
  ctx.font = `900 ${size}px Arial Black, Arial, sans-serif`;
  const w = ctx.measureText(text).width;
  if (w > W * 0.96) {
    size = Math.floor((size * W * 0.96) / w);
    ctx.font = `900 ${size}px Arial Black, Arial, sans-serif`;
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, size * 0.07);
  ctx.strokeStyle = '#000';
  ctx.strokeText(text, W / 2, y);
  ctx.fillStyle = '#FFD400';
  ctx.fillText(text, W / 2, y);
  ctx.restore();
}

function drawBase(ctx: Ctx, W: number, H: number, sample: VideoSample) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  sample.drawWithFit(ctx, { fit: 'contain' });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/** Footage with the mask tinted red over its contain rect. */
async function maskOverlayBitmap(sample: VideoSample, mask: OffscreenCanvas, W: number, H: number) {
  const c = new OffscreenCanvas(W, H);
  const g = c.getContext('2d')!;
  drawBase(g, W, H, sample);
  const tint = new OffscreenCanvas(mask.width, mask.height);
  const tg = tint.getContext('2d')!;
  tg.fillStyle = '#ff0000';
  tg.fillRect(0, 0, tint.width, tint.height);
  tg.globalCompositeOperation = 'destination-in';
  tg.drawImage(mask, 0, 0);
  const r = containRect(sample.displayWidth, sample.displayHeight, W, H);
  g.globalAlpha = 0.55;
  g.drawImage(tint, r.x, r.y, r.w, r.h);
  g.globalAlpha = 1;
  return createImageBitmap(c);
}

function copyCanvas(src: OffscreenCanvas): OffscreenCanvas {
  const c = new OffscreenCanvas(src.width, src.height);
  c.getContext('2d')!.drawImage(src, 0, 0);
  return c;
}

function alphaOf(c: OffscreenCanvas): Uint8ClampedArray {
  return c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
}

/* ---------------------------------------------------------------------- run */

async function run(req: MatteTestRequest) {
  const seconds = Math.max(0.1, req.seconds);
  post({ type: 'progress', stage: 'load', frames: 0 });
  const matter = await loadPersonMatter({
    maxInputEdge: req.maxInputEdge,
    delegate: req.delegate,
    gpuMaskCopy: req.gpuMaskCopy,
    wasmBase: req.wasmBase,
    modelUrl: req.modelUrl,
  });

  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(req.source) });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('no video track');
    if (!(await track.canDecode())) throw new Error(`cannot decode ${track.codec ?? 'this video'}`);

    const layouts = req.layouts.map((l) => {
      const canvas = new OffscreenCanvas(l.width, l.height);
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) throw new Error('2D OffscreenCanvas unavailable');
      return { ...l, canvas, ctx };
    });

    const snapCount = Math.max(0, Math.floor(req.snapshots));
    const snapTimes = Array.from({ length: snapCount }, (_, i) => (seconds * (i + 1)) / (snapCount + 1));
    const snapshots: MatteSnapshot[] = [];
    const storedMasks: Array<{ timestamp: number; mask: OffscreenCanvas }> = [];

    const sums = {
      decode: 0,
      mask: 0,
      baseDraw: Object.fromEntries(layouts.map((l) => [l.label, 0])) as Record<string, number>,
      personOver: Object.fromEntries(layouts.map((l) => [l.label, 0])) as Record<string, number>,
    };
    let frames = 0;
    let maskSize: [number, number] = [0, 0];

    const sink = new VideoSampleSink(track);
    const it = sink.samples(0, seconds);
    post({ type: 'progress', stage: 'segment', frames: 0 });
    for (;;) {
      let t = performance.now();
      const next = await it.next();
      if (next.done) break;
      const sample = next.value;
      sums.decode += performance.now() - t;
      try {
        t = performance.now();
        const mask = matter.maskFor(sample, sample.timestamp * 1000);
        sums.mask += performance.now() - t;
        maskSize = [mask.width, mask.height];

        const snapIdx = snapTimes.findIndex((st) => sample.timestamp >= st);
        const takeSnap = snapIdx >= 0;
        if (takeSnap) {
          snapTimes.splice(0, snapIdx + 1);
          storedMasks.push({ timestamp: sample.timestamp, mask: copyCanvas(mask) });
        }

        for (const l of layouts) {
          t = performance.now();
          drawBase(l.ctx, l.width, l.height, sample);
          drawTestCaption(l.ctx, l.width, l.height, sample);
          sums.baseDraw[l.label] += performance.now() - t;
          t = performance.now();
          drawPersonOver(l.ctx, sample, mask, l.width, l.height);
          sums.personOver[l.label] += performance.now() - t;
          if (takeSnap) {
            snapshots.push({
              layout: l.label,
              frameIndex: frames,
              timestampSec: sample.timestamp,
              composite: await createImageBitmap(l.canvas),
              maskOverlay: await maskOverlayBitmap(sample, mask, l.width, l.height),
            });
          }
        }
      } finally {
        sample.close();
      }
      frames++;
      if (frames % 15 === 0) post({ type: 'progress', stage: 'segment', frames });
    }
    if (!frames) throw new Error('no frames decoded');
    const stageAtLoopEnd = { ...matter.stats };

    // Determinism: same frames, fresh decode, much later timestamps.
    post({ type: 'progress', stage: 'determinism', frames });
    let identical = 0;
    let maxAlphaDiff = 0;
    for (const s of storedMasks) {
      const again = await sink.getSample(s.timestamp);
      if (!again) continue;
      try {
        const m = matter.maskFor(again, 1e7 + s.timestamp * 1000);
        const a = alphaOf(s.mask);
        const b = alphaOf(m);
        let diff = a.length === b.length ? 0 : 255;
        for (let i = 3; i < a.length && diff < 255; i += 4) diff = Math.max(diff, Math.abs(a[i] - b[i]));
        if (diff === 0) identical++;
        maxAlphaDiff = Math.max(maxAlphaDiff, diff);
      } finally {
        again.close();
      }
    }

    // GPU copy vs the preview's readback loop, same frames: also loads a second
    // segmenter in this worker (the ModuleFactory re-publish path).
    let vsReadback: MatteTestResult['vsReadback'] = null;
    if (matter.maskPath === 'gpu-copy' && storedMasks.length) {
      post({ type: 'progress', stage: 'compare readback', frames });
      const ref = await loadPersonMatter({
        maxInputEdge: req.maxInputEdge,
        delegate: 'GPU',
        gpuMaskCopy: false,
        wasmBase: req.wasmBase,
        modelUrl: req.modelUrl,
      });
      try {
        let max = 0;
        let sum = 0;
        let n = 0;
        for (const s of storedMasks) {
          const again = await sink.getSample(s.timestamp);
          if (!again) continue;
          try {
            const a = alphaOf(s.mask);
            const b = alphaOf(ref.maskFor(again, s.timestamp * 1000));
            if (a.length !== b.length) throw new Error('readback mask size differs');
            for (let i = 3; i < a.length; i += 4) {
              const d = Math.abs(a[i] - b[i]);
              max = Math.max(max, d);
              sum += d;
              n++;
            }
          } finally {
            again.close();
          }
        }
        vsReadback = { maxAlphaDiff: max, meanAlphaDiff: round2(sum / Math.max(1, n)) };
      } finally {
        ref.close();
      }
    }

    const encode: MatteEncodeBench[] = [];
    if (req.encodeBenchmark) {
      for (const l of req.layouts) {
        post({ type: 'progress', stage: `encode ${l.label} baseline`, frames });
        const base = await encodeBench(req.source, seconds, l, null);
        post({ type: 'progress', stage: `encode ${l.label} matte`, frames });
        const withMatte = await encodeBench(req.source, seconds, l, matter);
        encode.push({
          layout: l.label,
          frames: withMatte.frames,
          baselineMsPerFrame: round2(base.ms / Math.max(1, base.frames)),
          matteMsPerFrame: round2(withMatte.ms / Math.max(1, withMatte.frames)),
        });
      }
    }

    const per = (v: number) => round2(v / frames);
    const result: MatteTestResult = {
      delegate: matter.delegate,
      gpuError: matter.gpuError,
      maskPath: matter.maskPath,
      loadMs: matter.loadMs,
      source: {
        width: track.displayWidth,
        height: track.displayHeight,
        rotation: track.rotation,
        codec: track.codec,
      },
      maskSize,
      frames,
      timing: {
        decode: per(sums.decode),
        mask: per(sums.mask),
        maskStages: {
          drawMs: round2(stageAtLoopEnd.drawMs / frames),
          segmentMs: round2(stageAtLoopEnd.segmentMs / frames),
          maskMs: round2(stageAtLoopEnd.maskMs / frames),
        },
        baseDraw: Object.fromEntries(Object.entries(sums.baseDraw).map(([k, v]) => [k, per(v)])),
        personOver: Object.fromEntries(Object.entries(sums.personOver).map(([k, v]) => [k, per(v)])),
      },
      deterministic: { checked: storedMasks.length, identical, maxAlphaDiff },
      vsReadback,
      encode,
      snapshots,
    };
    const transfer: Transferable[] = [];
    for (const s of snapshots) transfer.push(s.composite, s.maskOverlay);
    post({ type: 'done', result }, transfer);
  } finally {
    input.dispose();
    matter.close();
  }
}

function round2(v: number) {
  return Math.round(v * 100) / 100;
}

/** End-to-end: the export worker's Conversion loop, in memory, H.264. */
async function encodeBench(
  source: Blob,
  seconds: number,
  layout: MatteTestLayout,
  matter: PersonMatter | null,
): Promise<{ ms: number; frames: number }> {
  const W = layout.width;
  const H = layout.height;
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(source) });
  try {
    const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
    const canvas = new OffscreenCanvas(W, H);
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2D OffscreenCanvas unavailable');
    let frames = 0;
    const conversion = await Conversion.init({
      input,
      output,
      tracks: 'primary',
      showWarnings: false,
      trim: { start: 0, end: seconds },
      video: {
        codec: 'avc',
        quality: new Quality({ quantizer: exportVideoQuantizer('mp4'), bitrate: exportVideoBitrate('mp4', W, H) }),
        processedWidth: W,
        processedHeight: H,
        allowRotationMetadata: false,
        process: (sample) => {
          drawBase(ctx, W, H, sample);
          const mask = matter ? matter.maskFor(sample, sample.timestamp * 1000) : null;
          drawTestCaption(ctx, W, H, sample);
          if (mask) drawPersonOver(ctx, sample, mask, W, H);
          frames++;
          return canvas;
        },
      },
      audio: { discard: true },
    });
    if (!conversion.isValid) throw new Error('encode benchmark: conversion invalid');
    const t = performance.now();
    await conversion.execute();
    return { ms: performance.now() - t, frames };
  } finally {
    input.dispose();
  }
}
