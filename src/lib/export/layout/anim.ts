/**
 * export/layout/anim.ts — the preview's animations as pure functions of time.
 *
 * The editor animates captions with framer-motion variants (CaptionOverlay's
 * makeWordVariants / makeBlockVariants) and CSS @keyframes (index.css). Both
 * run on the wall clock in the browser; an export needs the same curves
 * evaluated at an exact video timestamp. Easing constants are copied from
 * motion-utils (framer) and the CSS spec.
 *
 * Pure maths, no DOM — runs in the export worker.
 */

import type { KeyframeStop, VariantValues } from './types';

/* ------------------------------------------------------------------ easing */

type Ease = (p: number) => number;

/** Cubic bezier timing function (same solver approach as browsers). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): Ease {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const sampleDX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  const solveX = (x: number) => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = sampleX(t) - x;
      if (Math.abs(err) < 1e-6) return t;
      const d = sampleDX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 40; i++) {
      const v = sampleX(t);
      if (Math.abs(v - x) < 1e-6) return t;
      if (v < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return t;
  };
  return (p) => (p <= 0 ? 0 : p >= 1 ? 1 : sampleY(solveX(p)));
}

const linear: Ease = (p) => p;

const NAMED: Record<string, Ease> = {
  linear,
  // CSS keywords
  ease: cubicBezier(0.25, 0.1, 0.25, 1),
  'ease-in': cubicBezier(0.42, 0, 1, 1),
  'ease-out': cubicBezier(0, 0, 0.58, 1),
  'ease-in-out': cubicBezier(0.42, 0, 0.58, 1),
  // framer-motion names (motion-utils/easing)
  easeIn: cubicBezier(0.42, 0, 1, 1),
  easeOut: cubicBezier(0, 0, 0.58, 1),
  easeInOut: cubicBezier(0.42, 0, 0.58, 1),
  backOut: cubicBezier(0.33, 1.53, 0.69, 0.99),
  backIn: (p) => 1 - cubicBezier(0.33, 1.53, 0.69, 0.99)(1 - p),
};

const easeCache = new Map<string, Ease>();

export function easing(name: string | undefined): Ease {
  const key = (name ?? 'ease').trim();
  const cached = easeCache.get(key);
  if (cached) return cached;
  let fn = NAMED[key];
  if (!fn) {
    const m = /^cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)$/.exec(key);
    fn = m ? cubicBezier(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])) : NAMED.ease;
  }
  easeCache.set(key, fn);
  return fn;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

/* ------------------------------------------------------------- transforms */

/** 2D affine matrix in canvas order: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Matrix = [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function translate(x: number, y: number): Matrix {
  return [1, 0, 0, 1, x, y];
}

interface Length {
  value: number;
  percent: boolean;
}

interface TransformFn {
  name: string;
  args: Length[];
}

const DEG = Math.PI / 180;

function parseLength(raw: string): Length {
  const s = raw.trim();
  if (s.endsWith('%')) return { value: parseFloat(s), percent: true };
  if (s.endsWith('deg')) return { value: parseFloat(s), percent: false };
  if (s.endsWith('rad')) return { value: parseFloat(s) / DEG, percent: false };
  return { value: parseFloat(s) || 0, percent: false };
}

const transformCache = new Map<string, TransformFn[]>();

export function parseTransform(css: string | undefined): TransformFn[] {
  const src = (css ?? 'none').trim();
  if (!src || src === 'none') return [];
  const cached = transformCache.get(src);
  if (cached) return cached;
  const out: TransformFn[] = [];
  const re = /([a-zA-Z]+)\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    out.push({ name: m[1], args: m[2].split(',').map(parseLength) });
  }
  transformCache.set(src, out);
  return out;
}

function identityArgs(name: string, count: number): Length[] {
  const one = /^scale/.test(name);
  return Array.from({ length: count }, () => ({ value: one ? 1 : 0, percent: false }));
}

/** Interpolate two transform lists function by function (CSS rules for matching lists). */
export function interpolateTransforms(a: TransformFn[], b: TransformFn[], p: number): TransformFn[] {
  if (!a.length && !b.length) return [];
  const from = a.length ? a : b.map((f) => ({ name: f.name, args: identityArgs(f.name, f.args.length) }));
  const to = b.length ? b : a.map((f) => ({ name: f.name, args: identityArgs(f.name, f.args.length) }));
  const same = from.length === to.length && from.every((f, i) => f.name === to[i].name);
  if (!same) return p < 0.5 ? from : to;
  return from.map((f, i) => ({
    name: f.name,
    args: f.args.map((arg, j) => {
      const other = to[i].args[j] ?? arg;
      return { value: lerp(arg.value, other.value, p), percent: arg.percent || other.percent };
    }),
  }));
}

/** Matrix of a transform list; `%` resolves against the element's own box. */
export function transformMatrix(fns: TransformFn[], boxW: number, boxH: number): Matrix {
  let m = IDENTITY;
  const len = (l: Length | undefined, basis: number) => (l ? (l.percent ? (l.value / 100) * basis : l.value) : 0);
  for (const f of fns) {
    const [a0, a1] = f.args;
    let n: Matrix = IDENTITY;
    switch (f.name) {
      case 'translate':
        n = translate(len(a0, boxW), len(a1, boxH));
        break;
      case 'translateX':
        n = translate(len(a0, boxW), 0);
        break;
      case 'translateY':
        n = translate(0, len(a0, boxH));
        break;
      case 'scale': {
        const sx = a0?.value ?? 1;
        const sy = a1?.value ?? sx;
        n = [sx, 0, 0, sy, 0, 0];
        break;
      }
      case 'scaleX':
        n = [a0?.value ?? 1, 0, 0, 1, 0, 0];
        break;
      case 'scaleY':
        n = [1, 0, 0, a0?.value ?? 1, 0, 0];
        break;
      case 'rotate': {
        const r = (a0?.value ?? 0) * DEG;
        n = [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0];
        break;
      }
      case 'skewX':
        n = [1, 0, Math.tan((a0?.value ?? 0) * DEG), 1, 0, 0];
        break;
      case 'skewY':
        n = [1, Math.tan((a0?.value ?? 0) * DEG), 0, 1, 0, 0];
        break;
      default:
        break;
    }
    m = multiply(m, n);
  }
  return m;
}

function parseBlur(filter: string | undefined): number {
  const m = /blur\(\s*([\d.]+)px\s*\)/.exec(filter ?? '');
  return m ? Number(m[1]) : 0;
}

/* --------------------------------------------------------------- keyframes */

export interface AnimatedValues {
  opacity: number;
  transform: TransformFn[];
  /** Filter blur radius in px (0 = none). */
  blur: number;
}

/**
 * Value of a CSS @keyframes animation at `elapsed` seconds after the element
 * appeared. `base*` are the element's own (un-animated) values, used for any
 * property a keyframe list leaves out at 0% / 100%.
 */
export function evalKeyframes(
  stops: KeyframeStop[],
  elapsed: number,
  spec: { duration: number; delay: number; easing: string; fill: string },
  baseOpacity: number,
): AnimatedValues {
  const active = elapsed - spec.delay;
  const fillBackwards = spec.fill === 'both' || spec.fill === 'backwards';
  const fillForwards = spec.fill === 'both' || spec.fill === 'forwards';
  let progress: number;
  if (active < 0) {
    if (!fillBackwards) return { opacity: baseOpacity, transform: [], blur: 0 };
    progress = 0;
  } else if (spec.duration <= 0 || active >= spec.duration) {
    if (!fillForwards) return { opacity: baseOpacity, transform: [], blur: 0 };
    progress = 1;
  } else {
    progress = active / spec.duration;
  }

  const propAt = <T>(pick: (s: KeyframeStop) => T | undefined, base: T, mix: (a: T, b: T, p: number) => T): T => {
    const defined = stops.filter((s) => pick(s) !== undefined);
    const list: Array<{ offset: number; value: T; easing?: string }> = defined.map((s) => ({
      offset: s.offset,
      value: pick(s) as T,
      easing: s.easing,
    }));
    if (!list.length) return base;
    if (list[0].offset > 0) list.unshift({ offset: 0, value: base, easing: undefined });
    if (list[list.length - 1].offset < 1) list.push({ offset: 1, value: base, easing: undefined });
    let i = 0;
    while (i < list.length - 2 && progress > list[i + 1].offset) i++;
    const a = list[i];
    const b = list[i + 1];
    const span = b.offset - a.offset;
    const local = span > 0 ? clamp01((progress - a.offset) / span) : 1;
    return mix(a.value, b.value, easing(a.easing ?? spec.easing)(local));
  };

  const opacity = propAt((s) => s.opacity, baseOpacity, lerp);
  const transform = propAt<TransformFn[]>(
    (s) => (s.transform === undefined ? undefined : parseTransform(s.transform)),
    [],
    interpolateTransforms,
  );
  const blur = propAt((s) => (s.filter === undefined ? undefined : parseBlur(s.filter)), 0, lerp);
  return { opacity, transform, blur };
}

/* ------------------------------------------------------------ framer motion */

export interface MotionValues {
  opacity: number;
  y: number;
  scale: number;
}

/**
 * framer-motion going from `from` to the `to` variant, started `elapsed`
 * seconds ago, with `to.transition`. Keyframe arrays (bounce) use `times`,
 * with the ease applied per segment as framer does.
 */
export function evalVariant(from: VariantValues, to: VariantValues, elapsed: number): MotionValues {
  const tr = to.transition ?? { duration: 0.3, ease: 'easeOut' };
  const p = tr.duration <= 0 ? 1 : clamp01(elapsed / tr.duration);
  const ease = easing(tr.ease);
  const start = (v: number | number[] | undefined, dflt: number) =>
    Array.isArray(v) ? (v[0] ?? dflt) : (v ?? dflt);

  const scalar = (a: number | number[] | undefined, b: number | number[] | undefined, dflt: number): number => {
    if (Array.isArray(b)) {
      const frames = b;
      const times = tr.times && tr.times.length === frames.length
        ? tr.times
        : frames.map((_, i) => i / Math.max(1, frames.length - 1));
      let i = 0;
      while (i < frames.length - 2 && p > times[i + 1]) i++;
      const span = times[i + 1] - times[i];
      const local = span > 0 ? clamp01((p - times[i]) / span) : 1;
      return lerp(frames[i], frames[i + 1], ease(local));
    }
    return lerp(start(a, dflt), b ?? start(a, dflt), ease(p));
  };

  return {
    opacity: scalar(from.opacity, to.opacity, 1),
    y: scalar(from.y, to.y, 0),
    scale: scalar(from.scale, to.scale, 1),
  };
}

/** A variant's resting values (no transition in progress). */
export function variantRest(v: VariantValues): MotionValues {
  const last = (x: number | number[] | undefined, d: number) =>
    Array.isArray(x) ? (x[x.length - 1] ?? d) : (x ?? d);
  return { opacity: last(v.opacity, 1), y: last(v.y, 0), scale: last(v.scale, 1) };
}

export function motionTransform(v: MotionValues): TransformFn[] {
  const out: TransformFn[] = [];
  if (v.y) out.push({ name: 'translateY', args: [{ value: v.y, percent: false }] });
  if (v.scale !== 1) out.push({ name: 'scale', args: [{ value: v.scale, percent: false }] });
  return out;
}
