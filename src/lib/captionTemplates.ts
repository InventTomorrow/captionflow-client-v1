/**
 * captionTemplates — Antigravity / TikTok-style caption presets.
 *
 * Adapted for CaptionFlow's StyleState. Existing UNIFIED_TEMPLATES are untouched;
 * import ANTIGRAVITY_UNIFIED_TEMPLATES and append them in the picker.
 *
 * Source inspiration:
 *   - react-video-editor-main  (caption presets, style schema, word-level timing)
 *   - template-tiktok-main     (TikTok-style word highlighting, spring animation)
 */

import type { CaptionTemplate } from '../components/CaptionOverlay';
import type { DisplayMode } from './displayCaptions';

export interface CaptionWord {
  text: string;
  /** Start time in milliseconds (relative to clip start). */
  from: number;
  /** End time in milliseconds (relative to clip start). */
  to: number;
  isKeyWord?: boolean;
  paragraphIndex?: string;
}

export interface CaptionColors {
  appeared: string;
  active: string;
  activeFill: string;
  background: string;
  keyword: string;
}

export interface AntigravityCaptionTemplate {
  id: string;
  name: string;
  type?: 'word' | 'lines';
  tag?: string;
  purpose: string;
  desc: string;
  style: {
    fontFamily: string;
    fontUrl?: string;
    fontSize: number;
    color: string;
    align: 'left' | 'center' | 'right';
    textTransform?: string;
    stroke?: { color: string; width: number } | null;
    shadow?: {
      color: string;
      alpha: number;
      blur: number;
      distance: number;
      angle: number;
    } | null;
  };
  colors: CaptionColors;
  textBoxStyle?: {
    style: 'tiktok' | 'none';
    textAlign?: 'left' | 'center' | 'right' | '';
    maxLines?: number;
    borderRadius?: number;
    horizontalPadding?: number;
    verticalPadding?: number;
  } | null;
  layout?: Record<string, number>;
  renderHints?: Record<string, unknown> | null;
  previewStatic?: string;
  previewVideo?: string;
  /** CaptionFlow style snapshot applied when the card is selected. */
  preset: {
    displayMode: DisplayMode;
    template: CaptionTemplate;
    fontFamily: string;
    fontSize: number;
    fontWeight: number;
    color: string;
    backgroundColor: string;
    highlightColor: string;
    activeFill?: string;
    textTransform?: 'none' | 'uppercase' | 'lowercase';
    animation: string;
    displayWords?: number;
  };
}

export const CAPTION_DEFAULTS = {
  fontFamily: 'Bangers',
  fontSize: 64,
  textAlign: 'center' as const,
  textTransform: 'none' as const,
};

/** Template 1 — TikTok Classic */
export const TIKTOK_CLASSIC: AntigravityCaptionTemplate = {
  id: 'tiktok-classic',
  name: 'TikTok Classic',
  type: 'lines',
  tag: 'TikTok',
  purpose: 'Hooks · talking-head · shorts',
  desc: 'White UPPERCASE with thick outline; spoken word pops bright green.',
  style: {
    fontFamily: 'Bangers',
    fontUrl: 'https://fonts.gstatic.com/s/bangers/v13/FeVQS0BTqb0h60ACL5la2bxii28.ttf',
    fontSize: 72,
    color: '#FFFFFF',
    align: 'center',
    textTransform: 'uppercase',
    stroke: { color: '#000000', width: 8 },
    shadow: null,
  },
  colors: {
    appeared: '#FFFFFF',
    active: '#39E508',
    activeFill: 'transparent',
    background: 'transparent',
    keyword: '#FFFFFF',
  },
  layout: { bottom: 350, height: 150, widthPercent: 0.9 },
  renderHints: {
    enterAnimation: 'spring',
    springConfig: { damping: 200 },
    scaleFrom: 0.8,
    scaleTo: 1.0,
  },
  preset: {
    displayMode: 'karaoke',
    template: 'classic',
    fontFamily: 'Bangers',
    fontSize: 72,
    fontWeight: 700,
    color: '#FFFFFF',
    backgroundColor: 'rgba(0,0,0,0)',
    highlightColor: '#39E508',
    activeFill: 'transparent',
    textTransform: 'uppercase',
    animation: 'pop',
    displayWords: 5,
  },
};

/** Template 2 — Viral Orange (Bangers) */
export const VIRAL_ORANGE: AntigravityCaptionTemplate = {
  id: 'viral-orange',
  name: 'Viral Orange',
  type: 'lines',
  tag: 'Viral',
  purpose: 'Reels · hype · product clips',
  desc: 'White Bangers with an orange pill behind the spoken word.',
  style: {
    fontFamily: 'Bangers',
    fontUrl: 'https://fonts.gstatic.com/s/bangers/v13/FeVQS0BTqb0h60ACL5la2bxii28.ttf',
    fontSize: 68,
    color: '#FFFFFF',
    align: 'center',
    textTransform: 'uppercase',
    stroke: { color: '#000000', width: 4 },
    shadow: { color: '#000000', alpha: 0.5, blur: 4, distance: 0, angle: 0 },
  },
  colors: {
    appeared: '#FFFFFF',
    active: '#FFFFFF',
    activeFill: '#FF5700',
    background: 'transparent',
    keyword: '#FFFFFF',
  },
  layout: { widthPercent: 0.8, bottomOffsetPx: 185 },
  preset: {
    displayMode: 'karaoke',
    template: 'classic',
    fontFamily: 'Bangers',
    fontSize: 68,
    fontWeight: 700,
    color: '#FFFFFF',
    backgroundColor: 'rgba(0,0,0,0)',
    highlightColor: '#FFFFFF',
    activeFill: '#FF5700',
    textTransform: 'uppercase',
    animation: 'pop',
    displayWords: 5,
  },
};

/** Template 3 — Roboto Word Pop */
export const ROBOTO_WORD: AntigravityCaptionTemplate = {
  id: 'roboto-word',
  name: 'Roboto Word Pop',
  type: 'word',
  tag: 'Word',
  purpose: 'Punchlines · drops · big moments',
  desc: 'One giant uppercase word at a time, timed to each spoken beat.',
  style: {
    fontFamily: 'Roboto',
    fontUrl: 'https://fonts.gstatic.com/s/roboto/v29/KFOlCnqEu92Fr1MmYUtvAx05IsDqlA.ttf',
    fontSize: 64,
    color: '#FFFFFF',
    align: 'center',
    textTransform: 'uppercase',
    stroke: { color: '#000000', width: 6 },
    shadow: null,
  },
  colors: {
    appeared: '#FFFFFF',
    active: '#FFFFFF',
    activeFill: 'transparent',
    background: 'transparent',
    keyword: 'transparent',
  },
  previewStatic: 'https://cdn.designcombo.dev/caption_previews/static-preset18.png',
  previewVideo: 'https://cdn.designcombo.dev/caption_previews/dynamic-preset18.webm',
  preset: {
    displayMode: 'word',
    template: 'bigpop',
    fontFamily: 'Roboto',
    fontSize: 64,
    fontWeight: 900,
    color: '#FFFFFF',
    backgroundColor: 'rgba(0,0,0,0)',
    highlightColor: '#FFFFFF',
    activeFill: 'transparent',
    textTransform: 'uppercase',
    animation: 'bounce',
  },
};

/** Template 4 — TikTok Pill */
export const TIKTOK_PILL: AntigravityCaptionTemplate = {
  id: 'tiktok-pill',
  name: 'TikTok Pill',
  type: 'lines',
  tag: 'Pill',
  purpose: 'UGC · clean social · captions over busy video',
  desc: 'Black text on a white rounded pill — max two lines, centered.',
  style: {
    fontFamily: 'Poppins',
    fontUrl: 'https://fonts.gstatic.com/s/poppins/v15/pxiByp8kv8JHgFVrLCz7V1tvFP-KUEg.ttf',
    fontSize: 48,
    color: '#000000',
    align: 'center',
    textTransform: 'none',
    stroke: null,
    shadow: null,
  },
  colors: {
    appeared: '#000000',
    active: '#000000',
    activeFill: 'transparent',
    background: '#FFFFFF',
    keyword: 'transparent',
  },
  textBoxStyle: {
    style: 'tiktok',
    textAlign: 'center',
    maxLines: 2,
    borderRadius: 16,
    horizontalPadding: 48,
    verticalPadding: 16,
  },
  previewStatic: 'https://cdn.designcombo.dev/caption_previews/static-preset2.png',
  previewVideo: 'https://cdn.designcombo.dev/caption_previews/dynamic-preset2.webm',
  preset: {
    displayMode: 'phrase',
    template: 'classic',
    fontFamily: 'Poppins',
    fontSize: 48,
    fontWeight: 600,
    color: '#000000',
    backgroundColor: '#FFFFFF',
    highlightColor: '#000000',
    activeFill: 'transparent',
    textTransform: 'none',
    animation: 'fade',
    displayWords: 5,
  },
};

/** Template 5 — Clean White */
export const CLEAN_WHITE: AntigravityCaptionTemplate = {
  id: 'clean-white',
  name: 'Clean White',
  type: 'lines',
  tag: 'Minimal',
  purpose: 'Subtitles · quotes · minimal edits',
  desc: 'Plain white captions — no border box, no highlight chrome.',
  style: {
    fontFamily: 'Bangers',
    fontUrl: 'https://fonts.gstatic.com/s/bangers/v13/FeVQS0BTqb0h60ACL5la2bxii28.ttf',
    fontSize: 56,
    color: '#FFFFFF',
    align: 'center',
    textTransform: 'none',
    stroke: null,
    shadow: null,
  },
  colors: {
    appeared: '#FFFFFF',
    active: '#FFFFFF',
    activeFill: 'transparent',
    background: 'transparent',
    keyword: 'transparent',
  },
  preset: {
    displayMode: 'phrase',
    template: 'classic',
    fontFamily: 'Bangers',
    fontSize: 56,
    fontWeight: 400,
    color: '#FFFFFF',
    backgroundColor: 'rgba(0,0,0,0)',
    highlightColor: '#FFFFFF',
    activeFill: 'transparent',
    textTransform: 'none',
    animation: 'fade',
    displayWords: 5,
  },
};

/** Template 6 — Poppins Bold (Social) */
export const POPPINS_BOLD: AntigravityCaptionTemplate = {
  id: 'poppins-bold',
  name: 'Poppins Bold',
  type: 'lines',
  tag: 'Social',
  purpose: 'Instagram Reels · YouTube Shorts',
  desc: 'White Poppins Bold; spoken word lights yellow.',
  style: {
    fontFamily: 'Poppins',
    fontUrl: 'https://fonts.gstatic.com/s/poppins/v15/pxiByp8kv8JHgFVrLCz7V1tvFP-KUEg.ttf',
    fontSize: 64,
    color: '#FFFFFF',
    align: 'center',
    textTransform: 'none',
    stroke: { color: '#000000', width: 3 },
    shadow: { color: '#000000', alpha: 0.4, blur: 6, distance: 2, angle: Math.PI / 4 },
  },
  colors: {
    appeared: '#FFFFFF',
    active: '#FFE000',
    activeFill: 'transparent',
    background: 'transparent',
    keyword: '#FFE000',
  },
  preset: {
    displayMode: 'karaoke',
    template: 'classic',
    fontFamily: 'Poppins',
    fontSize: 64,
    fontWeight: 700,
    color: '#FFFFFF',
    backgroundColor: 'rgba(0,0,0,0)',
    highlightColor: '#FFE000',
    activeFill: 'transparent',
    textTransform: 'none',
    animation: 'fade',
    displayWords: 5,
  },
};

/** Template 7 — Industrial Display */
export const INDUSTRIAL: AntigravityCaptionTemplate = {
  id: 'industrial',
  name: 'Industrial Display',
  type: 'lines',
  tag: 'Hype',
  purpose: 'Sports · hype · condensed display',
  desc: 'Tall condensed uppercase; active word burns orange-red.',
  style: {
    fontFamily: 'Oswald',
    fontUrl:
      'https://fonts.gstatic.com/s/oswald/v49/TK3_WkUHHAIjg75cFRf3bXL8LICs1_FvgUFoZAaRliE.ttf',
    fontSize: 72,
    color: '#FFFFFF',
    align: 'center',
    textTransform: 'uppercase',
    stroke: { color: '#000000', width: 5 },
    shadow: null,
  },
  colors: {
    appeared: '#FFFFFF',
    active: '#FF3D00',
    activeFill: 'transparent',
    background: 'transparent',
    keyword: '#FF3D00',
  },
  preset: {
    displayMode: 'karaoke',
    template: 'classic',
    fontFamily: 'Oswald',
    fontSize: 72,
    fontWeight: 700,
    color: '#FFFFFF',
    backgroundColor: 'rgba(0,0,0,0)',
    highlightColor: '#FF3D00',
    activeFill: 'transparent',
    textTransform: 'uppercase',
    animation: 'pop',
    displayWords: 4,
  },
};

/**
 * Hero Word — progressive word reveal with AI-picked hero + support words.
 *
 * Words build up inside a fixed block ("Hi" → "Hi how" → "Hi how are" → …):
 * the whole phrase is laid out from frame one, hidden words just have zero
 * opacity, so nothing ever reflows mid-caption.
 *
 * Three tiers, mirrored 1:1 by the ASS burn-in (see HERO_WORD_TIERS in
 * server/src/services/export.service.ts and .tpl-heroWord in index.css):
 *   hero    — 1.55× · Montserrat 900 · UPPERCASE · highlightColor
 *   support — 1.55× · Playfair Display 400 italic · base color (no bold, no color)
 *   normal  — 0.72× · Montserrat 700 · base color
 *
 * `displayMode: 'paintOn'` is what drives the reveal — the editor and the
 * exporter both special-case it for this template.
 */
export const HERO_WORD_TEMPLATE: AntigravityCaptionTemplate = {
  id: 'hero-word',
  name: 'Hero Word',
  type: 'word',
  purpose: 'Viral hooks · storytelling · talking-head',
  desc: 'Words build up one by one; AI picks a bold colored hero and a large italic support word.',
  style: {
    fontFamily: 'Montserrat',
    fontSize: 72,
    color: '#FFFFFF',
    align: 'center',
    textTransform: 'none',
  },
  colors: {
    appeared: '#FFFFFF',
    active: '#FF2D9A',
    activeFill: 'transparent',
    background: 'transparent',
    keyword: '#FF2D9A',
  },
  layout: { accentScale: 1.55, normalScale: 0.72, wordGap: 0.3 },
  renderHints: {
    reveal: 'cumulative',
    heroUppercase: true,
    supportFontFamily: 'Playfair Display',
  },
  preset: {
    displayMode: 'paintOn',
    template: 'heroWord',
    fontFamily: 'Montserrat',
    fontSize: 72,
    fontWeight: 900,
    color: '#FFFFFF',
    backgroundColor: 'rgba(0,0,0,0)',
    highlightColor: '#FF2D9A',
    activeFill: 'transparent',
    textTransform: 'none',
    animation: 'pop',
    displayWords: 5,
  },
};

export const CAPTION_TEMPLATES: AntigravityCaptionTemplate[] = [
  HERO_WORD_TEMPLATE,
  INDUSTRIAL,
  TIKTOK_CLASSIC,
  VIRAL_ORANGE,
  ROBOTO_WORD,
  TIKTOK_PILL,
  CLEAN_WHITE,
  POPPINS_BOLD,
  
];

/** Picker cards — same shape as EditorPage UNIFIED_TEMPLATES entries. */
export const ANTIGRAVITY_UNIFIED_TEMPLATES = CAPTION_TEMPLATES.map((t) => ({
  key: t.id,
  name: t.name,
  tag: t.tag,
  purpose: t.purpose,
  desc: t.desc,
  preset: t.preset,
}));

export function buildCaptionConfig(
  template: AntigravityCaptionTemplate,
  words: CaptionWord[],
  overrides: { style?: Partial<AntigravityCaptionTemplate['style']>; colors?: Partial<CaptionColors> } = {},
) {
  return {
    id: template.id,
    name: template.name,
    type: template.type ?? 'lines',
    style: { ...template.style, ...(overrides.style ?? {}) },
    colors: { ...template.colors, ...(overrides.colors ?? {}) },
    textBoxStyle: template.textBoxStyle ?? null,
    layout: template.layout ?? {},
    renderHints: template.renderHints ?? null,
    words: words.map((w) => ({
      text: w.text,
      from: w.from,
      to: w.to,
      isKeyWord: w.isKeyWord ?? false,
      paragraphIndex: w.paragraphIndex ?? '',
    })),
  };
}

export function getActiveWord(words: CaptionWord[], currentTimeMs: number): CaptionWord | null {
  return words.find((w) => currentTimeMs >= w.from && currentTimeMs < w.to) ?? null;
}

export function getWordStyle(
  word: CaptionWord,
  activeWord: CaptionWord | null,
  colors: CaptionColors,
): { color: string; background: string } {
  const isActive = Boolean(activeWord && word.from === activeWord.from);
  if (isActive) {
    return { color: colors.active, background: colors.activeFill };
  }
  if (word.isKeyWord && colors.keyword && colors.keyword !== 'transparent') {
    return { color: colors.keyword, background: 'transparent' };
  }
  return { color: colors.appeared, background: 'transparent' };
}
