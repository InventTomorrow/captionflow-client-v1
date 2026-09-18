/**
 * export/layout/types.ts — a caption track compiled from the live preview's
 * own DOM, ready to paint on a canvas.
 *
 * Why a compiled layout: the editor previews every non-kinetic template with
 * DOM + CSS (components/CaptionOverlay.tsx + index.css). Re-implementing that
 * layout by hand on canvas would drift (line breaks, letter-spacing, boxes,
 * inline-block baselines). Instead compile.tsx renders the very same
 * CaptionWords markup off-screen, lets the browser lay it out, and records
 * what it drew — positioned text runs, boxes and the animated groups they
 * belong to. painter.ts replays that at export resolution in the worker.
 *
 * All lengths are in REFERENCE pixels: the layout is measured in a frame whose
 * long edge is REF_LONG_EDGE (roughly the editor's preview size), so fixed-px
 * CSS (shadow radii, paddings, 16px box corners) keeps the proportions the
 * user saw. The painter multiplies everything by exportWidth / refWidth.
 *
 * Plain data only (structured-clonable, no DOM types) — shared by the main
 * thread and the export worker.
 */

/** Long edge of the frame the preview layout is measured in. */
export const REF_LONG_EDGE = 720;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Shadow {
  x: number;
  y: number;
  /** CSS blur radius (text-shadow / box-shadow semantics: sigma = blur / 2). */
  blur: number;
  color: string;
}

export type Paint =
  | { type: 'color'; color: string }
  | {
      type: 'linear';
      /** CSS gradient angle in degrees (0 = to top, 90 = to right). */
      angle: number;
      stops: Array<{ offset: number; color: string }>;
      /** Box the gradient spans (the element that owns the background). */
      box: Rect;
    };

export interface TextItem {
  type: 'text';
  /** Left edge of the run and its alphabetic baseline. */
  x: number;
  y: number;
  /** Already text-transformed. */
  text: string;
  fontStyle: string;
  fontWeight: string;
  fontSize: number;
  fontFamily: string;
  letterSpacing: number;
  /** Measured run width (used for sprite bounds and typewriter clipping). */
  width: number;
  ascent: number;
  descent: number;
  fill: Paint;
  /** In CSS order: the first shadow is painted on top. */
  shadows: Shadow[];
  /** -webkit-text-stroke; `first` when paint-order puts the stroke under the fill. */
  stroke?: { width: number; color: string; first: boolean };
  /** filter: drop-shadow() inherited from an ancestor (sigma = blur, NOT blur/2). */
  dropShadow?: Shadow;
  decoration?: {
    style: 'solid' | 'wavy';
    color: string;
    /** 0 = automatic (font-size based). */
    thickness: number;
    /** Offset below the baseline; null = automatic. */
    offset: number | null;
  };
  /** capw word index (typewriter reveal), when the run belongs to one. */
  wordIndex?: number;
  /** Characters of the word before this run (a word is usually one run). */
  charOffset?: number;
}

export interface BoxItem {
  type: 'box';
  rect: Rect;
  /** top-left, top-right, bottom-right, bottom-left (horizontal radii). */
  radii: [number, number, number, number];
  fill?: Paint;
  border?: { width: number; color: string };
  shadows?: Shadow[];
  /** backdrop-filter: blur(px) — blurs the video behind the box. */
  backdropBlur?: number;
}

export type LayoutItem = TextItem | BoxItem;

/** How a group moves over time. */
export type GroupMotion =
  /** Caption-level fade in after a gap / fade out before one (AnimatePresence). */
  | { kind: 'overlay' }
  /** .cap-block framer variants (style.animation), from the caption start. */
  | { kind: 'block' }
  /** .capw framer variants; animates only when paint reveals it after mount. */
  | { kind: 'word'; wordIndex: number }
  /** Rolling mode's previous line fading in to 0.45. */
  | { kind: 'rollPrev' }
  /** A CSS @keyframes animation from index.css. */
  | {
      kind: 'css';
      name: string;
      duration: number;
      delay: number;
      easing: string;
      fill: string;
    }
  /** No motion — a group only because of its static opacity. */
  | { kind: 'static' };

export interface LayoutGroup {
  parent: number;
  motion: GroupMotion;
  /** Untransformed border box. */
  box: Rect;
  /** Transform origin, absolute. */
  originX: number;
  originY: number;
  /** Static CSS opacity (framer's inline value included). */
  opacity: number;
  /** False for plain inline elements, which CSS never transforms (opacity still applies). */
  transformable: boolean;
}

export interface LayoutLayer {
  group: number;
  items: LayoutItem[];
}

export interface LayoutState {
  groups: LayoutGroup[];
  /** Paint order. */
  layers: LayoutLayer[];
}

export interface LayoutCaption {
  start: number;
  end: number;
  /** Fade in over OVERLAY_FADE when no caption was on screen right before. */
  fadeIn: boolean;
  /** Fade out after `end` when no caption follows immediately. */
  fadeOut: boolean;
  /** Karaoke: one layout per spoken word (the current word reflows the line). */
  states: LayoutState[];
  /** Start time of each state; stateTimes[0] === start. */
  stateTimes: number[];
  /** Paint mode: reveal time per word, or null when shown from the start. */
  reveal: Array<number | null> | null;
  /** Typewriter mode: per-word start times and char counts. */
  typewriter: { starts: number[]; lengths: number[]; end: number } | null;
}

export interface FramerTransition {
  duration: number;
  ease: string;
  times?: number[];
}

/** One framer-motion variant, reduced to the values CaptionOverlay uses. */
export interface VariantValues {
  opacity?: number;
  y?: number;
  scale?: number | number[];
  transition?: FramerTransition;
}

export interface KeyframeStop {
  offset: number;
  opacity?: number;
  transform?: string;
  filter?: string;
  /** animation-timing-function declared inside this keyframe, if any. */
  easing?: string;
}

export interface LayoutTrack {
  version: 1;
  refWidth: number;
  refHeight: number;
  captions: LayoutCaption[];
  wordVariants: { hidden: VariantValues; shown: VariantValues };
  blockVariants: { hidden: VariantValues; enter: VariantValues };
  keyframes: Record<string, KeyframeStop[]>;
  /** Every font the track draws with, and the text drawn in it. */
  fontUses: Array<{ fontStyle: string; fontWeight: string; fontFamily: string; text: string }>;
}

/** A webfont face the worker must register (a Google Fonts subset or a bundled TTF). */
export interface FontSource {
  family: string;
  style: string;
  weight: string;
  url: string;
  unicodeRange?: string;
}

/** AnimatePresence fade used by CaptionOverlay's inner motion.div. */
export const OVERLAY_FADE = 0.12;
