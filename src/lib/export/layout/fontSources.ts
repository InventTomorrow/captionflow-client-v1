/**
 * export/layout/fontSources.ts — find the exact font files the preview draws
 * caption text with, so the export worker can load the same ones.
 *
 * The editor loads caption fonts from Google Fonts stylesheets (index.html and
 * the @imports at the top of index.css). A worker cannot see the document's
 * fonts, so this reads those stylesheets' @font-face rules (fetching the CSS —
 * Google serves it with CORS) and returns every face of the families a track
 * uses, with its unicode-range. Families that can't be found that way fall
 * back to the bundled TTFs in /fonts (render/fonts.ts).
 *
 * Main thread only.
 */

import { FONT_FILES, fontFileUrl } from '../../render/fonts';
import { familyNames } from './cssValues';
import type { FontSource, LayoutTrack } from './types';

const GOOGLE_CSS = /^https:\/\/fonts\.googleapis\.com\//;

function stylesheetFontUrls(): string[] {
  const urls = new Set<string>();
  const visit = (sheet: CSSStyleSheet) => {
    if (sheet.href && GOOGLE_CSS.test(sheet.href)) urls.add(sheet.href);
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      return; // cross-origin sheet: its href (above) is all we need
    }
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSImportRule && GOOGLE_CSS.test(rule.href)) urls.add(rule.href);
    }
  };
  for (const sheet of Array.from(document.styleSheets)) visit(sheet);
  return [...urls];
}

let cssCache: Promise<FontSource[]> | null = null;

function parseFontFaces(css: string): FontSource[] {
  const out: FontSource[] = [];
  const blocks = css.match(/@font-face\s*{[^}]*}/g) ?? [];
  for (const block of blocks) {
    const prop = (name: string) => new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(block)?.[1].trim();
    const family = prop('font-family')?.replace(/^['"]|['"]$/g, '');
    const url = /url\(([^)]+)\)/.exec(block)?.[1].replace(/^['"]|['"]$/g, '');
    if (!family || !url) continue;
    out.push({
      family,
      style: prop('font-style') ?? 'normal',
      weight: prop('font-weight') ?? '400',
      url,
      unicodeRange: prop('unicode-range'),
    });
  }
  return out;
}

async function googleFontFaces(): Promise<FontSource[]> {
  if (!cssCache) {
    cssCache = Promise.all(
      stylesheetFontUrls().map((url) =>
        fetch(url, { mode: 'cors', credentials: 'omit' })
          .then((r) => (r.ok ? r.text() : ''))
          .catch(() => ''),
      ),
    ).then((texts) => texts.flatMap(parseFontFaces));
    // A failed fetch should be retried by the next export, not cached forever.
    void cssCache.then((faces) => {
      if (!faces.length) cssCache = null;
    });
  }
  return cssCache;
}

/** weight/style a bundled TTF carries, from its file name. */
function ttfDescriptor(file: string): { weight: string; style: string } {
  const suffix = file.replace(/\.ttf$/i, '').split('-').pop() ?? '';
  const style = /italic/i.test(suffix) ? 'italic' : 'normal';
  const weight = /black|heavy/i.test(suffix) ? '900' : /bold/i.test(suffix) ? '700' : '400';
  return { weight, style };
}

/** Every font face (Google subset or bundled TTF) the track needs. */
export async function resolveFontSources(track: Pick<LayoutTrack, 'fontUses'>): Promise<FontSource[]> {
  const wanted = new Set<string>();
  for (const use of track.fontUses) for (const f of familyNames(use.fontFamily)) wanted.add(f.toLowerCase());
  if (!wanted.size) return [];

  const google = await googleFontFaces();
  const out: FontSource[] = google.filter((f) => wanted.has(f.family.toLowerCase()));
  const found = new Set(out.map((f) => f.family.toLowerCase()));

  for (const [family, files] of Object.entries(FONT_FILES)) {
    if (!wanted.has(family.toLowerCase()) || found.has(family.toLowerCase())) continue;
    for (const file of files) {
      out.push({ family, ...ttfDescriptor(file), url: new URL(fontFileUrl(file), location.href).href });
    }
  }
  return out;
}
