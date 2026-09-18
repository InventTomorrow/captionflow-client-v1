/**
 * export/matteProtocol.ts — messages between /dev/matte (MatteDevPage) and
 * matteTest.worker.ts. Types only, shared by the DOM and WebWorker projects.
 */

import type { MatteDelegate, MatteStats } from './personMatte';

export interface MatteTestLayout {
  /** Shown on the page and used in snapshot names, e.g. "9x16-1080p". */
  label: string;
  width: number;
  height: number;
}

export interface MatteTestRequest {
  type: 'run';
  source: Blob;
  /** Decode and segment [0, seconds). */
  seconds: number;
  maxInputEdge?: number;
  /** Omit for the export default (GPU, CPU fallback). */
  delegate?: MatteDelegate;
  /** GPU delegate: false = read masks back to the CPU instead of the GPU copy. */
  gpuMaskCopy?: boolean;
  layouts: MatteTestLayout[];
  /** Evenly spread frames returned as images, per layout. */
  snapshots: number;
  /** Also time a real encode (Mediabunny Conversion → H.264 in memory) with and without the matte. */
  encodeBenchmark?: boolean;
  wasmBase?: string;
  modelUrl?: string;
}

export interface MatteSnapshot {
  layout: string;
  frameIndex: number;
  timestampSec: number;
  /** Captions + person drawn over them — the export's frame. */
  composite: ImageBitmap;
  /** The footage with the mask tinted red on it, to check alignment. */
  maskOverlay: ImageBitmap;
}

export interface MatteEncodeBench {
  layout: string;
  frames: number;
  /** Wall ms per frame of the whole Conversion (decode + draw + encode). */
  baselineMsPerFrame: number;
  matteMsPerFrame: number;
}

export interface MatteTestResult {
  delegate: MatteDelegate;
  gpuError: string | null;
  maskPath: 'gpu-copy' | 'readback';
  loadMs: number;
  source: { width: number; height: number; rotation: number; codec: string | null };
  /** Mask resolution (the downscaled segmentation input). */
  maskSize: [number, number];
  frames: number;
  /** Mean ms per frame, main loop (VideoSampleSink). */
  timing: {
    decode: number;
    /** maskFor: downscale + segment + readback + mask canvas. */
    mask: number;
    /** maskFor broken down (PersonMatter.stats, per frame). */
    maskStages: Omit<MatteStats, 'frames'>;
    /** Per layout: black + footage + test caption, without the person. */
    baseDraw: Record<string, number>;
    /** Per layout: drawPersonOver alone. */
    personOver: Record<string, number>;
  };
  /** Same frames segmented again later with larger timestamps: identical masks? */
  deterministic: { checked: number; identical: number; maxAlphaDiff: number };
  /** GPU copy only: the same frames' masks built by the preview's readback loop, compared (0–255 alpha). */
  vsReadback: { maxAlphaDiff: number; meanAlphaDiff: number } | null;
  encode: MatteEncodeBench[];
  snapshots: MatteSnapshot[];
}

export type MatteTestOut =
  | { type: 'progress'; stage: string; frames: number }
  | { type: 'done'; result: MatteTestResult }
  | { type: 'error'; message: string };
