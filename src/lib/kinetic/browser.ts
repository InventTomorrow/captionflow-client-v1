/**
 * kinetic/browser.ts — the browser half of the kinetic engine.
 *
 * The engine itself (engine.ts) is platform-free: it needs a 2D context to
 * measure and to draw, and nothing else. This file supplies the browser's,
 * plus the one thing canvas gets wrong on its own — webfont loading.
 */

import type { KineticLook, Metrics, TextCtx } from './engine';
import { KINETIC_FONTS, KINETIC_LOOK_NAMES, createMetrics } from './engine';

export interface FontStatus {
  ok: boolean;
  family: string;
  reason: 'loaded' | 'fallback-in-use' | 'no-font-api' | 'timeout';
}

/**
 * Wait until the requested family is genuinely usable for canvas drawing.
 *
 * Canvas does NOT trigger a webfont download the way DOM text does. Without
 * this gate the first frames silently rasterise in the fallback face and the
 * metrics cache is built from the WRONG font — which is what makes letters
 * overlap or drift apart. index.css @imports these families, but "imported"
 * and "loaded" are not the same thing.
 */
export async function ensureKineticFontReady(
  family: string,
  weight: number,
  timeoutMs = 8000,
): Promise<FontStatus> {
  if (typeof document === 'undefined' || !document.fonts) {
    return { ok: false, family, reason: 'no-font-api' };
  }

  const primary = family.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
  const spec = `${weight} 1000px "${primary}"`;

  let timedOut = false;
  const timeout = new Promise<void>((r) =>
    setTimeout(() => {
      timedOut = true;
      r();
    }, timeoutMs),
  );

  try {
    await Promise.race([document.fonts.load(spec, 'HAMBURGEFONTSIV'), timeout]);
    await Promise.race([document.fonts.ready, timeout]);
  } catch {
    /* fall through to the check below */
  }

  const ok = document.fonts.check(spec);
  return { ok, family: primary, reason: ok ? 'loaded' : timedOut ? 'timeout' : 'fallback-in-use' };
}

/** A detached canvas used only for measuring. */
export function createMeasuringContext(): TextCtx {
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 8;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('kinetic: 2D canvas unavailable');
  return ctx as unknown as TextCtx;
}

export function createBrowserMetrics(family: string, weight: number): Metrics {
  return createMetrics(createMeasuringContext(), family, weight);
}

/** The pinned face for one look, as a CSS font-family stack. */
export function kineticFontStack(look: KineticLook): { family: string; weight: number } {
  const f = KINETIC_FONTS[look];
  return { family: `'${f.family}', 'Anton', Impact, sans-serif`, weight: f.weight };
}

export interface KineticFontSet {
  fontFor: (look: KineticLook) => { family: string; weight: number };
  metricsFor: (look: KineticLook) => Metrics;
  statuses: FontStatus[];
  /** Every requested face confirmed loaded. */
  ok: boolean;
}

/**
 * Load every face the five looks need and build one cached metrics table per
 * face. A single project intercuts looks, so both Bebas Neue and Orbitron have
 * to be ready before the first frame — measuring a caption with the wrong
 * face's advances overlaps its own letters.
 *
 * Metrics are cached by FAMILY, not by look, so the four Bebas Neue looks share
 * one table instead of measuring the same glyphs four times.
 */
export async function loadKineticFonts(): Promise<KineticFontSet> {
  const families = new Map<string, { family: string; weight: number }>();
  for (const look of KINETIC_LOOK_NAMES) {
    const f = kineticFontStack(look);
    if (!families.has(f.family)) families.set(f.family, f);
  }

  const statuses = await Promise.all(
    [...families.values()].map((f) => ensureKineticFontReady(f.family, f.weight)),
  );

  const metricsCache = new Map<string, Metrics>();
  const metricsFor = (look: KineticLook): Metrics => {
    const f = kineticFontStack(look);
    const key = `${f.family}|${f.weight}`;
    let m = metricsCache.get(key);
    if (!m) {
      m = createBrowserMetrics(f.family, f.weight);
      metricsCache.set(key, m);
    }
    return m;
  };

  return {
    fontFor: kineticFontStack,
    metricsFor,
    statuses,
    ok: statuses.every((s) => s.ok),
  };
}

/**
 * Size the backing store in DEVICE pixels and scale the context so drawing
 * coordinates stay frame units.
 *
 * A `<canvas width={640}>` stretched by CSS across a 1200px panel at DPR 2 is a
 * 640px bitmap upscaled to 2400 device pixels — soft type that has nothing to
 * do with the export. Cap at 2x; past that there is no visible gain.
 */
export const MAX_KINETIC_RENDER_SCALE = 2;

export function setupKineticCanvas(
  canvas: HTMLCanvasElement,
  frame: { W: number; H: number },
  renderScale: number,
): TextCtx {
  const w = Math.max(1, Math.round(frame.W * renderScale));
  const h = Math.max(1, Math.round(frame.H * renderScale));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) throw new Error('kinetic: 2D canvas unavailable');
  ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return ctx as unknown as TextCtx;
}
