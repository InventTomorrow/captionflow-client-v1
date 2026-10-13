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

/** Faces found in one sampled frame: centre x (0..1 of the frame width) and area (0..1 of the frame). */
export interface FaceSample {
  t: number;
  faces: Array<{ cx: number; area: number }>;
}

export interface SmoothOptions {
  /** Ignore movements smaller than this (fraction of the source width). */
  deadZone?: number;
  /** Fastest pan, in source widths per second. */
  maxSpeed?: number;
  /** A move bigger than this is a camera cut or a speaker switch: cut, don't pan. */
  cutThreshold?: number;
}

/**
 * Face detections → a calm virtual camera path (CropTrack keyframes).
 *
 * Follows the largest face, holds the framing through frames with no face,
 * drops one-frame mis-detections (median of 5), ignores jitter inside a dead
 * zone and pans no faster than maxSpeed — a camera operator, not a tracker.
 * A jump past cutThreshold (a multi-camera cut, the other speaker) is taken
 * as a hard cut instead, so the frame never drifts across empty background.
 * The camera starts moving after it has seen the subject move, never before.
 */
export function smoothTrack(samples: FaceSample[], opts: SmoothOptions = {}): CropTrack {
  const deadZone = opts.deadZone ?? 0.08;
  const maxSpeed = opts.maxSpeed ?? 0.35;
  const cutThreshold = opts.cutThreshold ?? 0.25;
  const sorted = [...samples].sort((a, b) => a.t - b.t);

  // 1. Largest face per frame; gaps hold, leading gaps take the first face seen.
  const raw: Array<number | null> = sorted.map((s) =>
    s.faces.length ? s.faces.reduce((best, f) => (f.area > best.area ? f : best)).cx : null,
  );
  const first = raw.find((x): x is number => x !== null);
  if (first === undefined) return [[0, 0.5]];
  let held = first;
  const targets = raw.map((x) => (held = x ?? held));

  // 2. Median of 5 (symmetric window, narrowed at the ends).
  const median = targets.map((_, i) => {
    const r = Math.min(2, i, targets.length - 1 - i);
    const win = targets.slice(i - r, i + r + 1).sort((a, b) => a - b);
    return win[r];
  });

  // 3. Dead zone + speed limit, reacting to the previous frame's target.
  const out: CropTrack = [[sorted[0].t, clamp01(median[0])]];
  let pos = clamp01(median[0]);
  let moving = false;
  for (let i = 1; i < sorted.length; i++) {
    const dt = Math.max(0, sorted[i].t - sorted[i - 1].t);
    const target = clamp01(median[i - 1]);
    const d = target - pos;
    if (Math.abs(d) > cutThreshold) {
      // A step, not a ramp: the new framing starts right after the frame that revealed it.
      out.push([sorted[i - 1].t + Math.min(0.001, dt / 2), target]);
      pos = target;
      moving = false;
    } else if (!moving && Math.abs(d) > deadZone) moving = true;
    if (moving) {
      const step = maxSpeed * dt;
      if (Math.abs(d) <= step) {
        pos = target;
        moving = false;
      } else {
        pos += Math.sign(d) * step;
      }
    }
    out.push([sorted[i].t, pos]);
  }

  // 4. Keep only points that carry information (flat stretches → their ends).
  return out.filter(
    (p, i) => i === 0 || i === out.length - 1 || p[1] !== out[i - 1][1] || p[1] !== out[i + 1][1],
  );
}

/**
 * CSS object-position that shows, with object-fit: cover, the same
 * outW:outH window the render crops around centre `cx` (0..1 of the width).
 */
export function coverObjectPosition(videoW: number, videoH: number, outW: number, outH: number, cx: number): string {
  const r = cropRect(videoW, videoH, outW, outH, cx);
  const px = videoW > r.width ? r.left / (videoW - r.width) : 0.5;
  const py = videoH > r.height ? r.top / (videoH - r.height) : 0.5;
  return `${(px * 100).toFixed(2)}% ${(py * 100).toFixed(2)}%`;
}
