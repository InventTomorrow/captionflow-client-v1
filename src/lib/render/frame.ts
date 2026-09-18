/**
 * render/frame.ts — the output frame of a burned-in export.
 *
 * SHARED MODULE (DOM- and Node-free). A port of the canvas maths in
 * server/src/services/export.service.ts (canvasForAspect, NAMED_ASPECTS,
 * parseAspectRatio) so a video rendered in the browser has exactly the pixel
 * size the server would have produced for the same quality and aspect ratio.
 */

export type ExportQuality = '720p' | '1080p' | '2K' | '4K';
export type ExportFormat = 'mp4' | 'webm';

/** Quality names the SHORT edge: 1080p landscape = 1920×1080, portrait = 1080×1920. */
export const QUALITY_SHORT_EDGE: Record<ExportQuality, number> = {
  '720p': 720,
  '1080p': 1080,
  '2K': 1440,
  '4K': 2160,
};

export function evenDim(n: number): number {
  return Math.max(2, 2 * Math.round(n / 2));
}

/** Same rule as the server's canvasForAspect — never 608×1080 for a 9:16 1080p. */
export function canvasForAspect(
  quality: ExportQuality,
  ratio: number,
): { width: number; height: number } {
  const q = QUALITY_SHORT_EDGE[quality] || 1080;
  if (!Number.isFinite(ratio) || ratio <= 0) ratio = 16 / 9;
  if (ratio >= 1) {
    const height = evenDim(q);
    return { width: evenDim(height * ratio), height };
  }
  const width = evenDim(q);
  return { width, height: evenDim(width / ratio) };
}

export const NAMED_ASPECTS: ReadonlyArray<{ label: string; ratio: number }> = [
  { label: '16:9', ratio: 16 / 9 },
  { label: '9:16', ratio: 9 / 16 },
  { label: '1:1', ratio: 1 },
  { label: '4:5', ratio: 4 / 5 },
  { label: '4:3', ratio: 4 / 3 },
  { label: '21:9', ratio: 21 / 9 },
];

export function nearestNamedAspect(srcRatio: number): string {
  if (!(srcRatio > 0)) return '16:9';
  let best = '16:9';
  let bestDiff = Infinity;
  for (const a of NAMED_ASPECTS) {
    const diff = Math.abs(Math.log(srcRatio) - Math.log(a.ratio));
    if (diff < bestDiff) {
      bestDiff = diff;
      best = a.label;
    }
  }
  return best;
}

/** "9:16" → 0.5625; "original" (or empty) → the named ratio nearest the source. */
export function parseAspectRatio(
  aspect: string | undefined,
  srcRatio: number,
): { ratio: number; label: string } {
  const raw = (aspect || 'original').trim();
  if (raw && raw !== 'original') {
    const [rw, rh] = raw.split(':').map(Number);
    if (rw > 0 && rh > 0) return { ratio: rw / rh, label: raw };
  }
  const label = nearestNamedAspect(srcRatio > 0 ? srcRatio : 16 / 9);
  const named = NAMED_ASPECTS.find((a) => a.label === label);
  return { ratio: named?.ratio ?? (srcRatio > 0 ? srcRatio : 16 / 9), label };
}

/** Output pixel size for a quality + aspect choice, given the source's display size. */
export function exportFrameSize(
  quality: ExportQuality,
  aspect: string | undefined,
  srcWidth: number,
  srcHeight: number,
): { width: number; height: number; aspect: string } {
  const srcRatio = srcWidth > 0 && srcHeight > 0 ? srcWidth / srcHeight : 0;
  const { ratio, label } = parseAspectRatio(aspect, srcRatio);
  return { ...canvasForAspect(quality, ratio), aspect: label };
}

/**
 * Constant-quality quantizer for the encoder, or 0 for bitrate rate control.
 *
 * H.264 uses the bitrate: hardware H.264 encoders at a CRF-20-like quantizer
 * land near 12 Mbps at 1080p — larger than most phone sources — for no visible
 * gain, and encode no faster. VP9 (a software encoder in most browsers) keeps
 * quantizer 32, its visual equivalent of the server's libvpx crf 34.
 */
export function exportVideoQuantizer(format: ExportFormat): number {
  return format === 'webm' ? 32 : 0;
}

/** Output frame rate cap for "faster export": 60 fps sources render at 30. */
export const FAST_EXPORT_FPS = 30;

/**
 * Target bitrate (and the cap under a quantizer): ~8 Mbps at 1080p, scaled by
 * pixel count — YouTube's recommendation for 1080p uploads. Sharp text edges
 * are the first thing a starved encoder smears. VP9 needs about a third less.
 */
export function exportVideoBitrate(format: ExportFormat, width: number, height: number): number {
  const scale = Math.pow((width * height) / (1920 * 1080), 0.95);
  const base = 8_000_000 * scale * (format === 'webm' ? 0.65 : 1);
  return Math.max(1_000_000, Math.round(base / 1000) * 1000);
}
