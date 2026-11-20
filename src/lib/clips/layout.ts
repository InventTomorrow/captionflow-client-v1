/**
 * clips/layout.ts — draws a framing layout (clips/framing.ts) into a 9:16
 * frame. One geometry for every place that shows a framed clip: the live
 * preview canvas (drawImage from the <video>), card and poster thumbnails, and
 * the export worker (VideoSample.draw) — so what the clip page shows is what
 * the rendered MP4 contains.
 *
 * No DOM here: it runs in the export worker too. A caller supplies
 * `drawRegion`, which copies a source rectangle (pixels of the displayed
 * source) into a destination rectangle of a context.
 */
import { integerCrop } from './cropTrack';
import { layoutRegions, regionFit, splitOf, type ClipFramingV1, type FramingFit, type FramingRect } from './framing';

/** The 2D context operations a layout uses (satisfied by window and worker canvases alike). */
export interface LayoutContext {
  fillStyle: unknown;
  globalAlpha: number;
  imageSmoothingEnabled: boolean;
  fillRect(x: number, y: number, w: number, h: number): void;
  drawImage(image: OffscreenCanvas, dx: number, dy: number, dw: number, dh: number): void;
}

/** Copies source pixels (sx,sy,sw,sh) to (dx,dy,dw,dh) of `ctx`. */
export type DrawRegion = (
  ctx: LayoutContext,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
) => void;

export interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutPanel {
  /** Normalised source region. */
  region: FramingRect;
  fit: FramingFit;
  /** Destination in output pixels (integers). */
  dst: PixelRect;
}

const WHOLE: FramingRect = { x: 0, y: 0, w: 1, h: 1 };

/** The panels a layout draws into a W×H frame, back to front. */
export function panelsFor(f: ClipFramingV1, W: number, H: number): LayoutPanel[] {
  const full: PixelRect = { x: 0, y: 0, w: W, h: H };
  const a = f.a ?? WHOLE;
  const b = f.b ?? WHOLE;
  switch (f.layout) {
    case 'single':
    case 'gameplay':
      return [{ region: a, fit: regionFit(f, 'a'), dst: full }];
    case 'full':
      return [{ region: WHOLE, fit: 'contain', dst: full }];
    case 'dual':
    case 'stacked': {
      const topH = Math.round(H * splitOf(f));
      const top: PixelRect = { x: 0, y: 0, w: W, h: topH };
      const bottom: PixelRect = { x: 0, y: topH, w: W, h: H - topH };
      const first = { region: a, fit: regionFit(f, 'a') };
      const second = { region: b, fit: regionFit(f, 'b') };
      return f.swap
        ? [{ ...second, dst: top }, { ...first, dst: bottom }]
        : [{ ...first, dst: top }, { ...second, dst: bottom }];
    }
    case 'pip': {
      const p = f.pip ?? { x: 0.56, y: 0.05, w: 0.38, h: 0.2 };
      const x = Math.round(p.x * W);
      const y = Math.round(p.y * H);
      const box: PixelRect = { x, y, w: Math.max(2, Math.round((p.x + p.w) * W) - x), h: Math.max(2, Math.round((p.y + p.h) * H) - y) };
      return [
        { region: a, fit: regionFit(f, 'a'), dst: full },
        { region: b, fit: regionFit(f, 'b'), dst: box },
      ];
    }
  }
}

export interface PanelDraw {
  /** Source pixels. */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** Destination pixels (inside the panel; smaller than it for a Fit region). */
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

/**
 * Where one panel's pixels come from and go. Fill (cover): the region,
 * trimmed around its centre to the panel's proportions, fills the panel.
 * Fit (contain): the whole region, letterboxed inside the panel.
 */
export function panelDraw(p: LayoutPanel, srcW: number, srcH: number): PanelDraw {
  let rx = p.region.x * srcW;
  let ry = p.region.y * srcH;
  let rw = Math.max(1, p.region.w * srcW);
  let rh = Math.max(1, p.region.h * srcH);
  const { dst } = p;
  if (p.fit === 'cover') {
    const target = dst.w / dst.h;
    if (rw / rh > target) {
      const nw = rh * target;
      rx += (rw - nw) / 2;
      rw = nw;
    } else {
      const nh = rw / target;
      ry += (rh - nh) / 2;
      rh = nh;
    }
    const s = integerCrop({ left: rx, top: ry, width: rw, height: rh }, srcW, srcH);
    return { sx: s.left, sy: s.top, sw: s.width, sh: s.height, dx: dst.x, dy: dst.y, dw: dst.w, dh: dst.h };
  }
  const s = integerCrop({ left: rx, top: ry, width: rw, height: rh }, srcW, srcH);
  const scale = Math.min(dst.w / s.width, dst.h / s.height);
  const dw = Math.max(1, Math.round(s.width * scale));
  const dh = Math.max(1, Math.round(s.height * scale));
  return {
    sx: s.left,
    sy: s.top,
    sw: s.width,
    sh: s.height,
    dx: dst.x + Math.round((dst.w - dw) / 2),
    dy: dst.y + Math.round((dst.h - dh) / 2),
    dw,
    dh,
  };
}

/** True when some part of the frame is not covered by video (a Fit panel, or Full shot). */
export function hasBars(f: ClipFramingV1, W: number, H: number, srcW: number, srcH: number): boolean {
  return panelsFor(f, W, H).some((p) => {
    if (p.fit === 'cover') return false;
    const d = panelDraw(p, srcW, srcH);
    return d.dw < p.dst.w - 1 || d.dh < p.dst.h - 1;
  });
}

const scratch = new Map<string, OffscreenCanvas>();
function scratchCanvas(key: string, w: number, h: number): OffscreenCanvas {
  let c = scratch.get(key);
  if (!c || c.width !== w || c.height !== h) {
    c = new OffscreenCanvas(w, h);
    scratch.set(key, c);
  }
  return c;
}

/**
 * The blurred backdrop behind Fit panels: the whole frame, cover-cropped,
 * shrunk to a few dozen pixels and stretched back up (smooth scaling blurs
 * it — no canvas filter, so it looks the same in every browser and the
 * worker), then darkened so the picture in front stands out.
 */
function drawBlurBackdrop(ctx: LayoutContext, W: number, H: number, srcW: number, srcH: number, drawRegion: DrawRegion) {
  const tw = Math.max(4, Math.round(W / 40));
  const th = Math.max(4, Math.round(H / 40));
  const mw = tw * 4;
  const mh = th * 4;
  const tiny = scratchCanvas('tiny', tw, th);
  const mid = scratchCanvas('mid', mw, mh);
  const tctx = tiny.getContext('2d') as unknown as LayoutContext | null;
  const mctx = mid.getContext('2d') as unknown as LayoutContext | null;
  if (!tctx || !mctx) return;
  const d = panelDraw({ region: WHOLE, fit: 'cover', dst: { x: 0, y: 0, w: tw, h: th } }, srcW, srcH);
  tctx.imageSmoothingEnabled = true;
  drawRegion(tctx, d.sx, d.sy, d.sw, d.sh, 0, 0, tw, th);
  mctx.imageSmoothingEnabled = true;
  mctx.drawImage(tiny, 0, 0, mw, mh);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(mid, 0, 0, W, H);
  ctx.globalAlpha = 0.4;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 1;
}

/** Draws the framed source into a W×H frame (captions are drawn after, by the caller). */
export function drawLayout(
  ctx: LayoutContext,
  W: number,
  H: number,
  f: ClipFramingV1,
  srcW: number,
  srcH: number,
  drawRegion: DrawRegion,
): void {
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  if (!srcW || !srcH) return;
  if (f.bg === 'blur' && hasBars(f, W, H, srcW, srcH)) drawBlurBackdrop(ctx, W, H, srcW, srcH, drawRegion);
  ctx.imageSmoothingEnabled = true;
  for (const p of panelsFor(f, W, H)) {
    const d = panelDraw(p, srcW, srcH);
    drawRegion(ctx, d.sx, d.sy, d.sw, d.sh, d.dx, d.dy, d.dw, d.dh);
  }
}

/** Regions a layout needs that are missing (an unusable framing draws as the original crop instead). */
export function missingRegions(f: ClipFramingV1): string[] {
  return layoutRegions(f.layout).filter((k) => !f[k]);
}
