/**
 * export/layout/cssValues.ts — parse the computed-style strings the compiler
 * reads (Chrome/Firefox/Safari serialisations) into plain numbers and colours
 * a canvas understands. Pure string handling; no DOM.
 */

import type { Paint, Rect, Shadow } from './types';

/** Split a comma list, ignoring commas inside parentheses. */
export function splitTopLevel(input: string, sep = ','): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of input) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === sep && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function px(value: string | null | undefined): number {
  if (!value) return 0;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

const clampByte = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
const clampAlpha = (v: number) => Math.max(0, Math.min(1, v));

/**
 * Normalise a CSS colour to `rgba(r, g, b, a)`. Handles rgb()/rgba() (comma or
 * space syntax), #hex, `transparent`, and `color(srgb r g b / a)` — which is
 * how Chrome serialises color-mix() results such as the hero glow in index.css.
 * Returns null for anything it cannot read.
 */
export function normalizeColor(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = input.trim().toLowerCase();
  if (s === 'transparent') return 'rgba(0, 0, 0, 0)';
  let m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(s);
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : Number(m[4]);
    return `rgba(${clampByte(+m[1])}, ${clampByte(+m[2])}, ${clampByte(+m[3])}, ${clampAlpha(a)})`;
  }
  m = /^color\(\s*srgb\s+([\d.e-]+)\s+([\d.e-]+)\s+([\d.e-]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/.exec(s);
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : Number(m[4]);
    return `rgba(${clampByte(+m[1] * 255)}, ${clampByte(+m[2] * 255)}, ${clampByte(+m[3] * 255)}, ${clampAlpha(a)})`;
  }
  m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    let hex = m[1];
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join('');
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
    return `rgba(${r}, ${g}, ${b}, ${Number(a.toFixed(3))})`;
  }
  return null;
}

export function colorAlpha(rgba: string | null): number {
  if (!rgba) return 0;
  const m = /rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/.exec(rgba);
  return m ? Number(m[1]) : 1;
}

/** Pull the colour token out of a shadow/decoration part (colour may lead or trail). */
function takeColor(part: string): { color: string | null; rest: string } {
  const re = /(rgba?\([^)]*\)|color\([^)]*\)|#[0-9a-fA-F]{3,8}\b|transparent)/;
  const m = re.exec(part);
  if (!m) return { color: null, rest: part };
  return { color: normalizeColor(m[1]), rest: (part.slice(0, m.index) + part.slice(m.index + m[1].length)).trim() };
}

/** text-shadow / box-shadow (outer only) list. */
export function parseShadows(value: string | null | undefined, fallbackColor: string): Shadow[] {
  if (!value || value === 'none') return [];
  const out: Shadow[] = [];
  for (const part of splitTopLevel(value)) {
    if (/\binset\b/.test(part)) continue;
    const { color, rest } = takeColor(part);
    const nums = rest.split(/\s+/).filter(Boolean).map(px);
    if (nums.length < 2) continue;
    const c = color ?? normalizeColor(fallbackColor) ?? 'rgba(0, 0, 0, 1)';
    if (colorAlpha(c) <= 0) continue;
    out.push({ x: nums[0], y: nums[1], blur: nums[2] ?? 0, color: c });
  }
  return out;
}

/** `drop-shadow(color x y blur)` inside a filter list. */
export function parseDropShadow(filter: string | null | undefined): Shadow | null {
  if (!filter || filter === 'none') return null;
  const m = /drop-shadow\((.*)\)/.exec(filter);
  if (!m) return null;
  const { color, rest } = takeColor(m[1]);
  const nums = rest.split(/\s+/).filter(Boolean).map(px);
  if (nums.length < 2) return null;
  return { x: nums[0], y: nums[1], blur: nums[2] ?? 0, color: color ?? 'rgba(0, 0, 0, 1)' };
}

export function parseBlurFilter(filter: string | null | undefined): number {
  const m = /blur\(\s*([\d.]+)px\s*\)/.exec(filter ?? '');
  return m ? Number(m[1]) : 0;
}

/** First linear-gradient() in a background-image, spanning `box`. */
export function parseLinearGradient(image: string | null | undefined, box: Rect): Paint | null {
  if (!image || image === 'none') return null;
  const m = /linear-gradient\((.*)\)/.exec(image);
  if (!m) return null;
  const parts = splitTopLevel(m[1]);
  let angle = 180;
  if (parts.length && /deg|turn|^to /.test(parts[0])) {
    const first = parts.shift() as string;
    if (first.endsWith('deg')) angle = parseFloat(first);
    else if (first.endsWith('turn')) angle = parseFloat(first) * 360;
    else {
      const dirs: Record<string, number> = {
        'to top': 0, 'to right': 90, 'to bottom': 180, 'to left': 270,
        'to top right': 45, 'to bottom right': 135, 'to bottom left': 225, 'to top left': 315,
      };
      angle = dirs[first] ?? 180;
    }
  }
  const stops: Array<{ offset: number; color: string }> = [];
  parts.forEach((p, i) => {
    const { color, rest } = takeColor(p);
    if (!color) return;
    const pos = /([\d.]+)%/.exec(rest);
    stops.push({ offset: pos ? Number(pos[1]) / 100 : parts.length > 1 ? i / (parts.length - 1) : 0, color });
  });
  if (stops.length < 2) return null;
  return { type: 'linear', angle, stops, box };
}

/** Family names in a CSS font-family list, unquoted, generics dropped. */
export function familyNames(list: string): string[] {
  const generic = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'emoji', 'math', 'fangsong', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded']);
  return splitTopLevel(list)
    .map((f) => f.trim().replace(/^['"]|['"]$/g, ''))
    .filter((f) => f && !generic.has(f.toLowerCase()));
}
