/**
 * clips/cropTrack.ts — reframing math for vertical clips.
 *
 * A crop track is a list of [clipTime, cx] keyframes, cx being the horizontal
 * centre of the crop window as a fraction of the source width (0..1). The
 * preview (object-position) and the export worker (drawWithFit crop) both
 * read it through these functions, so the two always frame identically.
 */

export type CropTrack = Array<[number, number]>;

export interface CropRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Crop centre at clip time t: linear between keyframes, held at the ends. */
export function cropXAt(track: CropTrack, t: number): number {
  if (!track.length) return 0.5;
  if (t <= track[0][0]) return clamp01(track[0][1]);
  const last = track[track.length - 1];
  if (t >= last[0]) return clamp01(last[1]);
  for (let i = 1; i < track.length; i++) {
    const [t1, x1] = track[i];
    if (t <= t1) {
      const [t0, x0] = track[i - 1];
      const k = t1 > t0 ? (t - t0) / (t1 - t0) : 1;
      return clamp01(x0 + (x1 - x0) * k);
    }
  }
  return clamp01(last[1]);
}

/**
 * The largest source rectangle with the output's aspect ratio, centred
 * horizontally on cx·srcW and kept inside the source. A source that is
 * already as narrow as the output (or narrower) keeps its full width and is
 * cropped top/bottom around the centre instead — never zoomed sideways.
 */
export function cropRect(srcW: number, srcH: number, outW: number, outH: number, cx: number): CropRect {
  const outAspect = outW / outH;
  if (srcW / srcH <= outAspect) {
    const height = Math.min(srcH, srcW / outAspect);
    return { left: 0, top: (srcH - height) / 2, width: srcW, height };
  }
  const width = srcH * outAspect;
  const left = Math.min(srcW - width, Math.max(0, clamp01(cx) * srcW - width / 2));
  return { left, top: 0, width, height: srcH };
}

/**
 * Snap a crop rectangle to whole pixels inside the source — Mediabunny's
 * drawWithFit rejects fractional crops. Size rounds to nearest, position
 * rounds then clamps so the window never spills past the source edge.
 */
export function integerCrop(rect: CropRect, srcW: number, srcH: number): CropRect {
  const width = Math.max(1, Math.min(srcW, Math.round(rect.width)));
  const height = Math.max(1, Math.min(srcH, Math.round(rect.height)));
  const left = Math.min(srcW - width, Math.max(0, Math.round(rect.left)));
  const top = Math.min(srcH - height, Math.max(0, Math.round(rect.top)));
  return { left, top, width, height };
}
