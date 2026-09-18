/**
 * kinetic/browser.ts — the browser half of the kinetic engine.
 *
 * The engine itself (engine.ts) is platform-free: it needs a 2D context to
 * measure and to draw, and nothing else. This file supplies the browser's,
 * plus the one thing canvas gets wrong on its own — webfont loading.
 */

import type { KineticFace, KineticTemplateId, Metrics, TextCtx } from './engine';
import { KINETIC_FACES, KINETIC_TEMPLATE_ID, createMetrics, facesForTemplate } from './engine';

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
  style?: string,
  timeoutMs = 8000,
): Promise<FontStatus> {
  if (typeof document === 'undefined' || !document.fonts) {
    return { ok: false, family, reason: 'no-font-api' };
  }

  const primary = family.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
  const spec = `${style ? `${style} ` : ''}${weight} 1000px "${primary}"`;

  let timedOut = false;
  const timeout = new Promise<void>((r) =>
    setTimeout(() => {
      timedOut = true;
      r();
    }, timeoutMs),
  );

  // Retried, not one-shot: the families come from an @import'ed Google Fonts
  // stylesheet, and if that sheet hasn't been parsed yet when fonts.load()
  // runs, the call resolves with no matching face at all — then fonts.ready
  // registers the face UNLOADED and check() says "fallback-in-use" even
  // though nothing failed. A second load() after ready fetches it normally.
  while (!timedOut) {
    try {
      await Promise.race([document.fonts.load(spec, 'HAMBURGEFONTSIV'), timeout]);
      await Promise.race([document.fonts.ready, timeout]);
    } catch {
      /* fall through to the check below */
    }
    if (document.fonts.check(spec)) return { ok: true, family: primary, reason: 'loaded' };
    if (timedOut) break;
    await Promise.race([new Promise<void>((r) => setTimeout(r, 200)), timeout]);
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

export function createBrowserMetrics(family: string, weight: number, style?: string): Metrics {
  return createMetrics(createMeasuringContext(), family, weight, style);
}

/** What each face degrades to if it never loads — the same class of type, so
 *  the preview still reads right while the orange banner explains the drift. */
const FACE_FALLBACK: Record<KineticFace, string> = {
  bebasNeue: "'Anton', Impact, sans-serif",
  orbitron: "'Anton', Impact, sans-serif",
  anton: "'Bebas Neue', Impact, sans-serif",
  caveatBold: "'Dancing Script', cursive",
  barlowBlack: "'Saira Condensed', 'Oswald', Impact, sans-serif",
  barlowItalic: "'Barlow', 'Roboto', sans-serif",
  montserratBlack: "'Archivo Black', 'Arial Black', sans-serif",
  montserratBold: "'Inter', Arial, sans-serif",
  alfaSlab: "'Rockwell', Georgia, serif",
  oswaldBold: "'Barlow Condensed', 'Arial Narrow', sans-serif",
  playfairBold: "Georgia, 'Times New Roman', serif",
  playfairItalic: "Georgia, 'Times New Roman', serif",
  bungee: "'Luckiest Guy', Impact, sans-serif",
  montserratRegular: "'Inter', Arial, sans-serif",
  playfairBoldItalic: "Georgia, 'Times New Roman', serif",
};

/** The pinned face, as a CSS font-family stack. */
export function kineticFontStack(face: KineticFace): {
  family: string;
  weight: number;
  style?: string;
} {
  const f = KINETIC_FACES[face];
  return {
    family: `'${f.family}', ${FACE_FALLBACK[face]}`,
    weight: f.weight,
    ...(f.style ? { style: f.style } : {}),
  };
}

export interface KineticFontSet {
  template: KineticTemplateId;
  fontFor: (face: KineticFace) => { family: string; weight: number; style?: string };
  metricsFor: (face: KineticFace) => Metrics;
  statuses: FontStatus[];
  /** Every requested face confirmed loaded. */
  ok: boolean;
}

const fontSets = new Map<KineticTemplateId, Promise<KineticFontSet>>();

/**
 * Load every face a template needs and build one cached metrics table per
 * face. Anime Edit intercuts looks, so both Bebas Neue and Orbitron have to
 * be ready before its first frame; Blockbuster needs Anton and Caveat at once.
 * Measuring a caption with the wrong face's advances overlaps its own letters.
 *
 * Metrics are cached by FACE, not by look, so the four Bebas Neue looks share
 * one table instead of measuring the same glyphs four times. The whole set is
 * cached per template so the preview layer and every picker thumbnail share
 * one gate — but only a fully loaded set is kept: a timed-out load must be
 * retried by the next caller, not served back as a cached failure.
 */
export function loadKineticFonts(
  template: KineticTemplateId = KINETIC_TEMPLATE_ID,
): Promise<KineticFontSet> {
  const cached = fontSets.get(template);
  if (cached) return cached;
  const p = loadFontSet(template).then((set) => {
    if (!set.ok) fontSets.delete(template);
    return set;
  });
  fontSets.set(template, p);
  return p;
}

async function loadFontSet(template: KineticTemplateId): Promise<KineticFontSet> {
  const faces = facesForTemplate(template);
  const statuses = await Promise.all(
    faces.map((face) => {
      const f = kineticFontStack(face);
      return ensureKineticFontReady(f.family, f.weight, f.style);
    }),
  );

  const metricsCache = new Map<string, Metrics>();
  const metricsFor = (face: KineticFace): Metrics => {
    const f = kineticFontStack(face);
    // Style is part of the key: the same family at the same weight measures
    // differently upright vs italic.
    const key = `${f.style ?? ''}|${f.family}|${f.weight}`;
    let m = metricsCache.get(key);
    if (!m) {
      m = createBrowserMetrics(f.family, f.weight, f.style);
      metricsCache.set(key, m);
    }
    return m;
  };

  return {
    template,
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
