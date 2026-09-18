/**
 * export/workerFonts.ts — the kinetic engine's font host inside a Web Worker.
 *
 * A worker cannot see the page's Google Fonts stylesheet (`document.fonts`
 * belongs to the document), so it loads the exact TTF files the server
 * registers — client/public/fonts, mirrored from server/fonts — through the
 * FontFace API under private family names. This is the path the parity test
 * (ParityPage + server/src/scripts/parity-check.ts) already proves draws the
 * same letters as the server's @napi-rs/canvas export.
 *
 * Italic faces get no `italic` keyword: the file itself is the italic, and
 * asking for italic on top would synthesise a second slant (the server does
 * the same).
 *
 * Written against globalThis so it type-checks under both the DOM and the
 * WebWorker libs; it is only ever run inside the export worker.
 */

import {
  KINETIC_FACES,
  createMetrics,
  facesForTemplate,
  type KineticFace,
  type KineticTemplateId,
  type Metrics,
  type TextCtx,
} from '../kinetic/engine';

/**
 * Per-face fingerprints the server measures from server/fonts — copied from
 * EXPECTED_FINGERPRINTS in server/src/scripts/parity-check.ts. A browser that
 * measures a different number is drawing different glyph advances, so its
 * layout would not match the preview the user approved.
 */
export const EXPECTED_KINETIC_FINGERPRINTS: Readonly<Record<KineticFace, number>> = {
  bebasNeue: 58030,
  orbitron: 118810,
  anton: 69917,
  caveatBold: 78330,
  barlowBlack: 71270,
  barlowItalic: 66680,
  montserratBlack: 110510,
  montserratBold: 108800,
  alfaSlab: 116660,
  oswaldBold: 80370,
  playfairBold: 102190,
  playfairItalic: 97960,
  bungee: 106630,
  montserratRegular: 0,
  playfairBoldItalic: 0,
};

interface FontFaceSetLike {
  add(face: FontFace): unknown;
}

function fontFaceSet(): FontFaceSetLike {
  const set = (globalThis as unknown as { fonts?: FontFaceSetLike }).fonts;
  if (!set || typeof set.add !== 'function') {
    throw new Error('The FontFace API is not available in this context');
  }
  return set;
}

const aliasFor = (face: KineticFace) => `CfKinetic-${face}`;

/** One load per alias for the worker's lifetime; failed loads are retried. */
const loads = new Map<string, Promise<void>>();

async function loadFace(alias: string, url: string, weight: number): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`font ${url} → HTTP ${res.status}`);
  const bytes = await res.arrayBuffer();
  const face = new FontFace(alias, bytes, { weight: String(weight) });
  await face.load();
  fontFaceSet().add(face);
}

export interface WorkerKineticFonts {
  fontFor: (face: KineticFace) => { family: string; weight: number };
  metricsFor: (face: KineticFace) => Metrics;
}

export async function loadKineticFontsForWorker(
  template: KineticTemplateId,
  fontsBase: string,
): Promise<WorkerKineticFonts> {
  const base = fontsBase.replace(/\/$/, '');
  await Promise.all(
    facesForTemplate(template).map((face) => {
      const alias = aliasFor(face);
      let p = loads.get(alias);
      if (!p) {
        const spec = KINETIC_FACES[face];
        p = loadFace(alias, `${base}/${spec.file}`, spec.weight);
        loads.set(alias, p);
        p.catch(() => loads.delete(alias));
      }
      return p;
    }),
  );

  const measuring = new OffscreenCanvas(8, 8).getContext('2d');
  if (!measuring) throw new Error('2D canvas unavailable in this worker');

  const fontFor = (face: KineticFace) => ({
    family: `"${aliasFor(face)}"`,
    weight: KINETIC_FACES[face].weight,
  });
  const cache = new Map<KineticFace, Metrics>();
  const metricsFor = (face: KineticFace): Metrics => {
    let m = cache.get(face);
    if (!m) {
      const f = fontFor(face);
      m = createMetrics(measuring as unknown as TextCtx, f.family, f.weight);
      cache.set(face, m);
    }
    return m;
  };
  return { fontFor, metricsFor };
}

/** Faces whose measured fingerprint differs from the server's. */
export function fingerprintMismatches(fingerprints: Partial<Record<KineticFace, number>>): string[] {
  const out: string[] = [];
  for (const [face, value] of Object.entries(fingerprints)) {
    const expected = EXPECTED_KINETIC_FINGERPRINTS[face as KineticFace];
    if (expected !== undefined && value !== expected) out.push(`${face}:${value}≠${expected}`);
  }
  return out;
}
