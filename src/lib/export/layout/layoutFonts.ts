/**
 * export/layout/layoutFonts.ts — register, inside the export worker, the font
 * faces a compiled caption track draws with.
 *
 * Mirrors CSS font matching closely enough for caption text: per font use it
 * picks the family's faces with the right style, the nearest weight (CSS
 * weight-matching order), and only the unicode-range subsets that cover the
 * characters actually drawn. Faces are fetched as bytes and registered with
 * `new FontFace(family, buffer, descriptors)` — the path every engine supports
 * in workers (URL-sourced FontFace loads are unreliable in Safari workers).
 *
 * Type-checks under DOM and WebWorker libs; runs in the worker.
 */

import { familyNames } from './cssValues';
import type { FontSource, LayoutTrack } from './types';

interface FontFaceSetLike {
  add(face: FontFace): unknown;
}

function fontSet(): FontFaceSetLike {
  const set = (globalThis as unknown as { fonts?: FontFaceSetLike }).fonts;
  if (!set) throw new Error('The FontFace API is not available in this context');
  return set;
}

type Range = [number, number];

function parseUnicodeRange(value: string | undefined): Range[] | null {
  if (!value) return null;
  const out: Range[] = [];
  for (const part of value.split(',')) {
    const m = /U\+([0-9A-F?]+)(?:-([0-9A-F]+))?/i.exec(part.trim());
    if (!m) continue;
    if (m[1].includes('?')) {
      out.push([parseInt(m[1].replace(/\?/g, '0'), 16), parseInt(m[1].replace(/\?/g, 'F'), 16)]);
    } else {
      const lo = parseInt(m[1], 16);
      out.push([lo, m[2] ? parseInt(m[2], 16) : lo]);
    }
  }
  return out.length ? out : null;
}

function covers(ranges: Range[] | null, codepoints: number[]): boolean {
  if (!ranges) return true;
  return codepoints.some((cp) => ranges.some(([lo, hi]) => cp >= lo && cp <= hi));
}

function weightRange(weight: string): Range {
  const nums = weight.split(/\s+/).map(Number).filter((n) => Number.isFinite(n));
  if (!nums.length) return weight === 'bold' ? [700, 700] : [400, 400];
  return [nums[0], nums[1] ?? nums[0]];
}

/** CSS Fonts 4 weight matching over the available faces. */
function pickWeight(desired: number, faces: FontSource[]): FontSource[] {
  const ranges = faces.map((f) => ({ f, r: weightRange(f.weight) }));
  const exact = ranges.filter(({ r }) => desired >= r[0] && desired <= r[1]);
  if (exact.length) return exact.map((x) => x.f);
  const distinct = [...new Set(ranges.map(({ r }) => r[0]))].sort((a, b) => a - b);
  let chosen: number | undefined;
  const below = distinct.filter((w) => w < desired).reverse();
  const above = distinct.filter((w) => w > desired);
  if (desired >= 400 && desired <= 500) {
    chosen = above.find((w) => w <= 500) ?? below[0] ?? above[0];
  } else if (desired < 400) {
    chosen = below[0] ?? above[0];
  } else {
    chosen = above[0] ?? below[0];
  }
  return ranges.filter(({ r }) => r[0] === chosen).map((x) => x.f);
}

const loaded = new Map<string, Promise<void>>();

async function loadFace(src: FontSource): Promise<void> {
  const key = `${src.family}|${src.style}|${src.weight}|${src.url}|${src.unicodeRange ?? ''}`;
  let p = loaded.get(key);
  if (!p) {
    p = (async () => {
      const res = await fetch(src.url, { mode: 'cors', credentials: 'omit' });
      if (!res.ok) throw new Error(`${src.family}: HTTP ${res.status}`);
      const face = new FontFace(src.family, await res.arrayBuffer(), {
        style: src.style,
        weight: src.weight,
        ...(src.unicodeRange ? { unicodeRange: src.unicodeRange } : {}),
      });
      await face.load();
      fontSet().add(face);
    })();
    loaded.set(key, p);
    p.catch(() => loaded.delete(key));
  }
  return p;
}

export async function loadLayoutFonts(
  sources: FontSource[],
  uses: LayoutTrack['fontUses'],
): Promise<{ faces: number; unmatched: string[] }> {
  const byFamily = new Map<string, FontSource[]>();
  for (const s of sources) {
    const key = s.family.toLowerCase();
    const list = byFamily.get(key) ?? [];
    list.push(s);
    byFamily.set(key, list);
  }

  const wanted = new Map<string, FontSource>();
  const unmatched: string[] = [];
  for (const use of uses) {
    const codepoints = [...use.text].map((c) => c.codePointAt(0) ?? 0);
    const families = familyNames(use.fontFamily);
    let matchedAny = false;
    for (const fam of families) {
      const faces = byFamily.get(fam.toLowerCase());
      if (!faces?.length) continue;
      matchedAny = true;
      const italic = use.fontStyle === 'italic' || use.fontStyle.startsWith('oblique');
      let styled = faces.filter((f) => (f.style === 'italic' || f.style.startsWith('oblique')) === italic);
      if (!styled.length) styled = faces; // the browser synthesises the slant
      const desired = Number(use.fontWeight) || 400;
      for (const face of pickWeight(desired, styled)) {
        if (!covers(parseUnicodeRange(face.unicodeRange), codepoints)) continue;
        wanted.set(`${face.url}|${face.style}|${face.weight}|${face.unicodeRange ?? ''}`, face);
      }
    }
    if (!matchedAny && families.length) unmatched.push(use.fontFamily);
  }

  const results = await Promise.allSettled([...wanted.values()].map(loadFace));
  const failed = results.filter((r) => r.status === 'rejected');
  if (failed.length && failed.length === results.length) {
    throw new Error((failed[0] as PromiseRejectedResult).reason?.message ?? 'caption fonts failed to load');
  }
  return { faces: results.length - failed.length, unmatched };
}
