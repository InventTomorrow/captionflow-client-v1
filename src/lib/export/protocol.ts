/**
 * export/protocol.ts — the message contract between the editor (main thread)
 * and export.worker.ts. Types only, so both the DOM and the WebWorker
 * TypeScript projects can import it.
 */

import type { KineticCaptionInput, KineticParams, KineticTemplateId } from '../kinetic/engine';
import type { ExportFormat } from '../render/frame';
import type { FontSource, LayoutTrack } from './layout/types';

/** Captions drawn by the kinetic engine (the same engine as the preview). */
export interface KineticOverlaySpec {
  kind: 'kinetic';
  template: KineticTemplateId;
  /** Display captions already grouped exactly as the preview groups them. */
  captions: KineticCaptionInput[];
  accentColor: string;
  baseColor: string;
  /** style.fontSize / KINETIC_BASE_FONT_SIZE */
  fontScale: number;
  params?: KineticParams;
  /**
   * Text behind person: caption-time windows where the speaker is cut out of
   * the footage and drawn over the captions (personMatte.ts behindWindows).
   * Empty/absent = effect off, the segmenter is never loaded.
   */
  behindWindows?: Array<[number, number]>;
}

/**
 * Every other template: the live preview's caption layout, measured in the
 * editor document (layout/compile.tsx) and replayed by layout/painter.ts.
 */
export interface LayoutOverlaySpec {
  kind: 'layout';
  track: LayoutTrack;
  /** The exact font files the preview used for that track. */
  fonts: FontSource[];
}

export type OverlaySpec = KineticOverlaySpec | LayoutOverlaySpec;

export interface ExportJob {
  jobId: string;
  /** The source video (an OPFS-backed File — posting it copies no bytes). */
  source: Blob;
  /** Where the worker streams the output inside OPFS, e.g. "exports/<id>.mp4". */
  outputPath: string;
  format: ExportFormat;
  width: number;
  height: number;
  /** Constant-quality target (CRF-like); used when the encoder supports it. */
  videoQuantizer: number;
  /** Target bitrate; with a quantizer, the fallback for encoders without that mode. */
  videoBitrate: number;
  /** Output frame rate cap; undefined keeps the source's own frame timing. */
  frameRate?: number;
  overlay: OverlaySpec;
  /** URL prefix the caption fonts are fetched from (client/public/fonts). */
  fontsBase: string;
  /** Source time (seconds) at which to grab the thumbnail frame. */
  thumbnailAt: number;
  /** Benchmark switches (dev page only) — omit in production. */
  tuning?: ExportTuning;
}

export interface ExportTuning {
  hardwareAcceleration?: 'no-preference' | 'prefer-hardware' | 'prefer-software';
  /** Skip the caption overlay (measures decode + encode alone). */
  noOverlay?: boolean;
  /** Drop every frame after drawing (measures decode + draw, no encode). */
  noEncode?: boolean;
  /** Cap the output frame rate. */
  frameRate?: number;
  /** Override the quantizer; 0 = bitrate rate control. */
  quantizer?: number;
}

export type ExportErrorCode =
  /** This browser/device can't decode the source or encode the output — use the server. */
  | 'UNSUPPORTED'
  /** A caption font failed to load — the render would not match the preview. */
  | 'FONTS'
  /** Not enough device storage for the output file. */
  | 'STORAGE'
  | 'CANCELLED'
  | 'FAILED';

export interface ExportResult {
  outputPath: string;
  sizeBytes: number;
  width: number;
  height: number;
  durationSec: number;
  videoCodec: string;
  /** How the audio got into the output. */
  audio: 'copied' | 'transcoded' | 'none';
  audioCodec: string | null;
  frames: number;
  /** Wall-clock time of the whole job, fonts included. */
  renderMs: number;
  /** Small JPEG of a captioned frame for the Recent exports list. */
  thumbnail: Blob | null;
  /** Kinetic font fingerprints; any face listed in `fingerprintMismatch`
   *  measured differently from the server's recorded value. */
  fingerprints: Record<string, number>;
  fingerprintMismatch: string[];
  /** Where the render time went. */
  stats?: { processMs: number; overlayMs: number; renderLoopMs: number };
}

export type ExportStage = 'fonts' | 'prepare' | 'matte' | 'render' | 'finalize';

export type ExportWorkerIn = { type: 'start'; job: ExportJob } | { type: 'cancel' };

export type ExportWorkerOut =
  | { type: 'progress'; stage: ExportStage; percent: number; processedSec?: number }
  | { type: 'done'; result: ExportResult }
  | { type: 'error'; code: ExportErrorCode; message: string };
