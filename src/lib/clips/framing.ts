/**
 * clips/framing.ts — framing layouts for vertical clips: how a 9:16 clip is
 * composed from its source (one crop, two crops stacked, a picture-in-picture
 * box, or the whole frame fitted). Chosen and adjusted by hand in the clip
 * page; nothing here detects speakers, faces or gameplay.
 *
 * Mirrors server/src/services/clipFraming.ts (the server validates the same
 * shape). Rectangles are normalised 0..1 of the displayed (rotated) source —
 * the `pip` box is normalised to the output frame instead. `null` framing =
 * the original crop (Auto / Manual / Fit), unchanged.
 */

export type VideoType = 'podcast' | 'gaming';
export type FramingLayout = 'single' | 'dual' | 'full' | 'stacked' | 'pip' | 'gameplay';
export type FramingFit = 'cover' | 'contain';
export type RegionKey = 'a' | 'b';

export interface FramingRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ClipFramingV1 {
  v: 1;
  layout: FramingLayout;
  a?: FramingRect;
  b?: FramingRect;
  fitA?: FramingFit;
  fitB?: FramingFit;
  /** Top panel's share of the output height (dual / stacked), 0.2–0.8. */
  split?: number;
  /** Stacked: the second region goes on top. */
  swap?: boolean;
  /** Picture-in-picture box, normalised to the output frame. */
  pip?: FramingRect;
  bg?: 'black' | 'blur';
}

/** Smallest region side (matches the server's MIN_REGION). */
export const MIN_REGION = 0.05;
/** Output proportions every layout composes into (width / height). */
export const OUT_ASPECT = 9 / 16;

export const LAYOUTS_FOR: Record<VideoType, FramingLayout[]> = {
  podcast: ['single', 'dual', 'full'],
  gaming: ['stacked', 'pip', 'gameplay'],
};

export const LAYOUT_LABEL: Record<FramingLayout, string> = {
  single: 'Single speaker',
  dual: 'Dual speaker',
  full: 'Full shot',
  stacked: 'Stacked',
  pip: 'Facecam PiP',
  gameplay: 'Gameplay focus',
};

/** The regions a layout draws, and what the user calls them. */
export function layoutRegions(layout: FramingLayout): RegionKey[] {
  if (layout === 'dual' || layout === 'stacked' || layout === 'pip') return ['a', 'b'];
  if (layout === 'single' || layout === 'gameplay') return ['a'];
  return [];
}

export function regionLabel(layout: FramingLayout, key: RegionKey): string {
  if (layout === 'dual') return key === 'a' ? 'Speaker A' : 'Speaker B';
  if (layout === 'single') return 'Speaker';
  return key === 'a' ? 'Gameplay' : 'Facecam';
}

export function layoutVideoType(layout: FramingLayout): VideoType {
  return LAYOUTS_FOR.gaming.includes(layout) ? 'gaming' : 'podcast';
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Default fit of a region in a layout. */
export function regionFit(f: ClipFramingV1, key: RegionKey): FramingFit {
  const set = key === 'a' ? f.fitA : f.fitB;
  if (set) return set;
  if (f.layout === 'gameplay' || f.layout === 'full') return 'contain';
  return 'cover';
}

export function splitOf(f: ClipFramingV1): number {
  return clamp(f.split ?? (f.layout === 'stacked' ? 0.65 : 0.5), 0.2, 0.8);
}

/** Pixel proportions (w/h) of the output panel a region fills, in a 9:16 frame. */
export function panelAspect(f: ClipFramingV1, key: RegionKey): number {
  if (f.layout === 'dual' || f.layout === 'stacked') {
    const s = splitOf(f);
    const top: RegionKey = f.swap ? 'b' : 'a';
    return OUT_ASPECT / (key === top ? s : 1 - s);
  }
  if (f.layout === 'pip' && key === 'b' && f.pip) return (f.pip.w / f.pip.h) * OUT_ASPECT;
  return OUT_ASPECT;
}

/**
 * The same rectangle with the given proportions (normalised w/h), keeping its
 * centre and roughly its area, scaled down and moved as needed to stay inside
 * the frame.
 */
export function withRatio(r: FramingRect, ratio: number): FramingRect {
  const area = Math.max(MIN_REGION * MIN_REGION, r.w * r.h);
  let w = Math.sqrt(area * ratio);
  let h = Math.sqrt(area / ratio);
  const over = Math.max(w, h, 1);
  if (over > 1) {
    w /= over;
    h /= over;
  }
  if (w < MIN_REGION) {
    h *= MIN_REGION / w;
    w = MIN_REGION;
  }
  if (h < MIN_REGION) {
    w *= MIN_REGION / h;
    h = MIN_REGION;
  }
  w = Math.min(1, w);
  h = Math.min(1, h);
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  return clampRect({ x: cx - w / 2, y: cy - h / 2, w, h });
}

/** Inside the frame, at least MIN_REGION on each side. */
export function clampRect(r: FramingRect): FramingRect {
  const w = clamp(r.w, MIN_REGION, 1);
  const h = clamp(r.h, MIN_REGION, 1);
  return { x: clamp(r.x, 0, 1 - w), y: clamp(r.y, 0, 1 - h), w, h };
}

/** Normalised w/h of a region that fills a panel of pixel proportions `panel` exactly. */
export function coverRatio(panel: number, srcW: number, srcH: number): number {
  return (panel * srcH) / srcW;
}

/**
 * Locks every Fill (cover) region to its panel's proportions, so what the box
 * shows in the source view is exactly what the panel shows. Fit regions keep
 * any shape. Needs the source size; without it the framing is returned as is.
 */
export function normalizeFraming(f: ClipFramingV1, srcW?: number, srcH?: number): ClipFramingV1 {
  if (!srcW || !srcH) return f;
  const out: ClipFramingV1 = { ...f };
  for (const key of layoutRegions(f.layout)) {
    const r = out[key];
    if (!r) continue;
    out[key] = regionFit(out, key) === 'cover' ? withRatio(r, coverRatio(panelAspect(out, key), srcW, srcH)) : clampRect(r);
  }
  if (out.pip) out.pip = clampRect(out.pip);
  return out;
}

/** A centred region of normalised proportions `ratio`, `size` of the frame's height (shrunk to fit). */
function centred(ratio: number, size: number, cx = 0.5, cy = 0.5): FramingRect {
  let h = size;
  let w = h * ratio;
  if (w > 1) {
    w = 1;
    h = w / ratio;
  }
  return clampRect({ x: cx - w / 2, y: cy - h / 2, w, h });
}

/**
 * A layout with sensible starting boxes for this source. Placeholders only —
 * the app does not know where the speakers or the webcam are; the user moves
 * the boxes. Regions already set on `prev` are kept where they still apply.
 */
export function defaultFraming(layout: FramingLayout, srcW = 16, srcH = 9, prev?: ClipFramingV1 | null): ClipFramingV1 {
  const ratio = (panel: number) => coverRatio(panel, srcW, srcH);
  let f: ClipFramingV1;
  switch (layout) {
    case 'single':
      f = { v: 1, layout, a: centred(ratio(OUT_ASPECT), 1) };
      break;
    case 'dual': {
      const r = ratio(OUT_ASPECT / 0.5);
      f = { v: 1, layout, split: 0.5, a: centred(r, 0.7, 0.27), b: centred(r, 0.7, 0.73) };
      break;
    }
    case 'full':
      f = { v: 1, layout, bg: 'blur' };
      break;
    case 'stacked':
      f = {
        v: 1,
        layout,
        split: 0.65,
        a: centred(ratio(OUT_ASPECT / 0.65), 1),
        b: centred(ratio(OUT_ASPECT / 0.35), 0.28, 0.86, 0.17),
      };
      break;
    case 'pip': {
      const pip = { x: 0.56, y: 0.05, w: 0.38, h: 0.2 };
      f = {
        v: 1,
        layout,
        a: { x: 0, y: 0, w: 1, h: 1 },
        fitA: 'contain',
        bg: 'blur',
        pip,
        b: centred(ratio((pip.w / pip.h) * OUT_ASPECT), 0.28, 0.86, 0.17),
      };
      break;
    }
    case 'gameplay':
      f = { v: 1, layout, a: { x: 0, y: 0, w: 1, h: 1 }, fitA: 'contain', bg: 'blur' };
      break;
  }
  // Keep the boxes the user already placed (same roles), refitted to the new panels.
  if (prev && layoutVideoType(prev.layout) === layoutVideoType(layout)) {
    for (const key of layoutRegions(layout)) {
      const old = prev[key];
      if (old) f[key] = old;
    }
    if (layout === 'pip' && prev.pip) f.pip = prev.pip;
  }
  return normalizeFraming(f, srcW, srcH);
}

/** Short stable key of a framing, for caches and change detection ('' = none). */
export function framingKey(f: ClipFramingV1 | null | undefined): string {
  if (!f) return '';
  const r = (rect?: FramingRect) => (rect ? [rect.x, rect.y, rect.w, rect.h].map((n) => n.toFixed(3)).join(',') : '-');
  return [f.layout, r(f.a), r(f.b), f.fitA ?? '', f.fitB ?? '', f.split?.toFixed(3) ?? '', f.swap ? 's' : '', r(f.pip), f.bg ?? ''].join('|');
}

const isRect = (r: unknown): r is FramingRect => {
  if (!r || typeof r !== 'object') return false;
  const { x, y, w, h } = r as Record<string, unknown>;
  return [x, y, w, h].every((n) => typeof n === 'number' && Number.isFinite(n));
};

/** A stored framing the client can draw, or null (unknown version or shape → the original crop). */
export function readFraming(value: unknown): ClipFramingV1 | null {
  if (!value || typeof value !== 'object') return null;
  const f = value as ClipFramingV1;
  if (f.v !== 1 || !(f.layout in LAYOUT_LABEL)) return null;
  for (const key of layoutRegions(f.layout)) if (!isRect(f[key])) return null;
  if (f.layout === 'pip' && !isRect(f.pip)) return null;
  return f;
}
