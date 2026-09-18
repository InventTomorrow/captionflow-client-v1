/**
 * captionTemplates — Antigravity / TikTok-style caption presets.
 *
 * Adapted for Asaan Caption's StyleState. Existing UNIFIED_TEMPLATES are untouched;
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
  /** The single badge in the card's corner ("New", "Popular", …). */
  tag?: string;
  /** Small pills under the name ("Kinetic", "Cinematic", …). */
  tags?: string[];
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
  /** Asaan Caption style snapshot applied when the card is selected. */
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
  desc: 'Black text on a white rounded pill - max two lines, centered.',
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
  desc: 'Plain white captions - no border box, no highlight chrome.',
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

/**
 * Mixed Styles 2 — a calmer, more "content worthy" successor to Mixed Styles.
 *
 * Same per-sentence rotation mechanic, but every sub-style was picked to feel
 * premium and editorial rather than playful: no comic/cartoon faces, no
 * bounce/overshoot animation, a restrained graphite/ivory/gold/teal/terracotta
 * palette instead of candy colours — Modern Grotesk, Quiet Serif, Studio
 * Technical, Frosted Card, Editorial Pairing, Warm Minimal, Museum Gold,
 * Broadcast Line (see MIXED_STYLE_COUNT in CaptionOverlay.tsx and
 * MIXED_STYLE_SPECS_2 in server/src/services/export.service.ts, which must
 * stay in sync with each other).
 *
 * `style`/`colors`/`preset.*` below are fallbacks only — the per-caption CSS
 * class (`.cap-mixed2-N`) fully overrides font, color, shadow and animation.
 */
export const MIXED_STYLES_2: AntigravityCaptionTemplate = {
  id: 'mixed-styles-2',
  name: 'Mixed Styles 2',
  type: 'lines',
  tag: 'Premium',
  purpose: 'Every sentence feels special · still content-worthy, never cartoonish',
  desc: 'Eight refined rotating looks - grotesk, serif, technical, frosted, editorial, minimal, museum gold, broadcast - premium, not playful.',
  style: {
    fontFamily: 'Archivo Black',
    fontSize: 60,
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
    keyword: '#E8B44A',
  },
  preset: {
    displayMode: 'phrase',
    template: 'mixed2',
    fontFamily: 'Archivo Black',
    fontSize: 60,
    fontWeight: 700,
    color: '#FFFFFF',
    backgroundColor: 'rgba(0,0,0,0)',
    highlightColor: '#E8B44A',
    activeFill: 'transparent',
    textTransform: 'none',
    animation: 'fade',
    displayWords: 6,
  },
};

/** Template — Creator Yellow Box (Hormozi / MrBeast-style bold box captions) */
export const CREATOR_YELLOW_BOX: AntigravityCaptionTemplate = {
  id: 'creator-yellow-box',
  name: 'Creator Yellow Box',
  type: 'lines',
  tag: 'Trending',
  purpose: 'YouTube Shorts · high-retention talking-head',
  desc: 'Bold black-on-yellow box captions - the most-copied high-view creator caption style.',
  style: {
    fontFamily: 'Poppins',
    fontUrl: 'https://fonts.gstatic.com/s/poppins/v15/pxiByp8kv8JHgFVrLCz7V1tvFP-KUEg.ttf',
    fontSize: 60,
    color: '#111111',
    align: 'center',
    textTransform: 'uppercase',
    stroke: null,
    shadow: null,
  },
  colors: {
    appeared: '#111111',
    active: '#111111',
    activeFill: 'transparent',
    background: '#FFE100',
    keyword: '#7A3E00',
  },
  preset: {
    displayMode: 'phrase',
    template: 'classic',
    fontFamily: 'Poppins',
    fontSize: 60,
    fontWeight: 800,
    color: '#111111',
    backgroundColor: '#FFE100',
    highlightColor: '#7A3E00',
    activeFill: 'transparent',
    textTransform: 'uppercase',
    animation: 'fade',
    displayWords: 5,
  },
};

/** Template — Cinematic Subtitle (Netflix-style translucent bar, serif) */
export const CINEMATIC_SUBTITLE: AntigravityCaptionTemplate = {
  id: 'cinematic-subtitle',
  name: 'Cinematic Subtitle',
  type: 'lines',
  tag: 'Premium',
  purpose: 'Documentary · film · premium brand voiceover',
  desc: 'Understated serif captions on a soft translucent bar - a premium, cinematic subtitle look.',
  style: {
    fontFamily: 'Lora',
    fontSize: 44,
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
    background: 'rgba(0,0,0,0.55)',
    keyword: '#F2C879',
  },
  preset: {
    displayMode: 'phrase',
    template: 'classic',
    fontFamily: 'Lora',
    fontSize: 44,
    fontWeight: 700,
    color: '#FFFFFF',
    backgroundColor: 'rgba(0,0,0,0.55)',
    highlightColor: '#F2C879',
    activeFill: 'transparent',
    textTransform: 'none',
    animation: 'fade',
    displayWords: 6,
  },
};

/** Template — Bubble Candy (playful rounded box, comic-style face) */
export const BUBBLE_CANDY: AntigravityCaptionTemplate = {
  id: 'bubble-candy',
  name: 'Bubble Candy',
  type: 'lines',
  tag: 'Playful',
  purpose: 'Lifestyle · comedy · beauty · vlogs',
  desc: 'Bouncy bubble-font captions on a hot-pink box - playful and unmissable.',
  style: {
    fontFamily: 'Luckiest Guy',
    fontSize: 52,
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
    background: '#FF3E9A',
    keyword: '#FFF04D',
  },
  preset: {
    displayMode: 'phrase',
    template: 'classic',
    fontFamily: 'Luckiest Guy',
    fontSize: 52,
    fontWeight: 400,
    color: '#FFFFFF',
    backgroundColor: '#FF3E9A',
    highlightColor: '#FFF04D',
    activeFill: 'transparent',
    textTransform: 'none',
    animation: 'pop',
    displayWords: 5,
  },
};

/**
 * Six kinetic templates ported from CaptionTemplates.jsx (self-contained word-
 * by-word animated components). CaptionOverlay.tsx renders the live preview;
 * server/src/services/captionPng.service.ts renders the matching burned-in
 * export for all six via real-metrics canvas PNG overlays (see
 * PNG_OVERLAY_TEMPLATES in export.service.ts) — not ASS/libass, which can't
 * measure text precisely enough for these templates' word-fit sizing and
 * highlighter/mark boxes.
 */
export const EDITOR_MASALA: AntigravityCaptionTemplate = {
  id: 'editor-masala',
  name: 'Editor Masala',
  type: 'lines',
  tag: 'Smart',
  purpose: 'Bold kinetic hooks · talking-head',
  desc: 'Tiny lowercase lead-in pops into a giant yellow shout word.',
  style: {
    fontFamily: 'Anton',
    fontSize: 64,
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
    keyword: '#FFD60A',
  },
  preset: {
    displayMode: 'phrase',
    template: 'editorMasala',
    fontFamily: 'Anton',
    fontSize: 64,
    fontWeight: 700,
    color: '#FFFFFF',
    backgroundColor: 'rgba(0,0,0,0)',
    highlightColor: '#FFD60A',
    activeFill: 'transparent',
    textTransform: 'none',
    animation: 'fade',
    displayWords: 6,
  },
};

export const AURA: AntigravityCaptionTemplate = {
  id: 'aura',
  name: 'Aura',
  type: 'lines',
  tag: 'Editorial',
  purpose: 'Editorial · lifestyle · brand voiceover',
  desc: 'Serif italic paired with an electric-blue uppercase accent.',
  style: {
    fontFamily: 'Playfair Display',
    fontSize: 60,
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
    keyword: '#2F6BFF',
  },
  preset: {
    displayMode: 'phrase',
    template: 'aura',
    fontFamily: 'Playfair Display',
    fontSize: 60,
    fontWeight: 900,
    color: '#FFFFFF',
    backgroundColor: 'rgba(0,0,0,0)',
    highlightColor: '#2F6BFF',
    activeFill: 'transparent',
    textTransform: 'none',
    animation: 'fade',
    displayWords: 6,
  },
};

export const SWISS: AntigravityCaptionTemplate = {
  id: 'swiss',
  name: 'Swiss',
  type: 'lines',
  tag: 'Editorial',
  purpose: 'Editorial · minimal grotesk · statements',
  desc: 'Heavy grotesk stack with a yellow punch on the key word.',
  style: {
    fontFamily: 'Archivo',
    fontSize: 64,
    color: '#FFFFFF',
    align: 'center',
    textTransform: 'uppercase',
    stroke: null,
    shadow: null,
  },
  colors: {
    appeared: '#FFFFFF',
    active: '#FFFFFF',
    activeFill: 'transparent',
    background: 'transparent',
    keyword: '#FFD60A',
  },
  preset: {
    displayMode: 'phrase',
    template: 'swiss',
    fontFamily: 'Archivo',
    fontSize: 64,
    fontWeight: 900,
    color: '#FFFFFF',
    backgroundColor: 'rgba(0,0,0,0)',
    highlightColor: '#FFD60A',
    activeFill: 'transparent',
    textTransform: 'uppercase',
    animation: 'fade',
    displayWords: 6,
  },
};

export const THE_BIG_RED: AntigravityCaptionTemplate = {
  id: 'the-big-red',
  name: 'The Big Red',
  type: 'lines',
  tag: 'New',
  purpose: 'Monumental hero word · posters · punchlines',
  desc: 'One monumental red serif word with a thin caption crossing it.',
  style: {
    fontFamily: 'Playfair Display',
    fontSize: 72,
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
    keyword: '#D11A24',
  },
  preset: {
    displayMode: 'phrase',
    template: 'theBigRed',
    fontFamily: 'Playfair Display',
    fontSize: 72,
    fontWeight: 900,
    color: '#FFFFFF',
    backgroundColor: 'rgba(0,0,0,0)',
    highlightColor: '#D11A24',
    activeFill: 'transparent',
    textTransform: 'none',
    animation: 'fade',
    displayWords: 6,
  },
};

export const SCRIBBLE: AntigravityCaptionTemplate = {
  id: 'scribble',
  name: 'Scribble',
  type: 'lines',
  tag: 'New',
  purpose: 'Handwritten · vlogs · casual notes',
  desc: 'Handwritten script with a green highlighter mark behind one word.',
  style: {
    fontFamily: 'Caveat',
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
    keyword: '#37D66B',
  },
  preset: {
    displayMode: 'phrase',
    template: 'scribble',
    fontFamily: 'Caveat',
    fontSize: 56,
    fontWeight: 700,
    color: '#FFFFFF',
    backgroundColor: 'rgba(0,0,0,0)',
    highlightColor: '#37D66B',
    activeFill: 'transparent',
    textTransform: 'none',
    animation: 'fade',
    displayWords: 6,
  },
};

export const ARCHIVES: AntigravityCaptionTemplate = {
  id: 'archives',
  name: 'Archives',
  type: 'lines',
  tag: 'New',
  purpose: 'Elegant script · storytelling · quotes',
  desc: 'Elegant script with one word underlined by hand.',
  style: {
    fontFamily: 'Dancing Script',
    fontSize: 52,
    color: '#F3F1EA',
    align: 'center',
    textTransform: 'none',
    stroke: null,
    shadow: null,
  },
  colors: {
    appeared: '#F3F1EA',
    active: '#F3F1EA',
    activeFill: 'transparent',
    background: 'transparent',
    keyword: '#F3F1EA',
  },
  preset: {
    displayMode: 'phrase',
    template: 'archives',
    fontFamily: 'Dancing Script',
    fontSize: 52,
    fontWeight: 700,
    color: '#F3F1EA',
    backgroundColor: 'rgba(0,0,0,0)',
    highlightColor: '#F3F1EA',
    activeFill: 'transparent',
    textTransform: 'none',
    animation: 'fade',
    displayWords: 6,
  },
};

/* ---------- Anime Edit (per-letter kinetic canvas) ----------
 * ONE card, five internal looks. lib/kinetic/engine.ts picks a look per caption
 * (pickKineticLook) so a sequence never repeats the same treatment — the job an
 * AMV editor does by hand. Same one-id/many-sub-looks shape as mixed/mixed2.
 *
 * The `style`/`colors` block below is picker metadata only. The renderer reads
 * just `preset`, and of that only displayMode, template, color and
 * highlightColor have any effect: faces are pinned per look in KINETIC_FONTS
 * and cannot be changed from the Text panel, and every size and position comes
 * from the layout engine.
 */

export const ANIME_EDIT: AntigravityCaptionTemplate = {
  id: 'anime-edit',
  name: 'Anime Edit',
  type: 'lines',
  tag: 'Kinetic',
  purpose: 'AMV / anime edits · hard cuts, slowmo',
  desc: 'Per-letter kinetic typography that changes treatment every line - scatter, slam, chaos, neon and glitch.',
  style: {
    fontFamily: 'Bebas Neue',
    fontSize: 64,
    color: '#FFFFFF',
    align: 'center',
    textTransform: 'uppercase',
    stroke: null,
    shadow: null,
  },
  colors: {
    appeared: '#FFFFFF',
    active: '#FFFFFF',
    activeFill: 'transparent',
    background: 'transparent',
    keyword: '#E11D48',
  },
  preset: {
    displayMode: 'phrase',
    template: 'animeEdit',
    fontFamily: 'Bebas Neue',
    fontSize: 64,
    fontWeight: 400,
    color: '#FFFFFF',
    backgroundColor: 'rgba(0,0,0,0)',
    highlightColor: '#E11D48',
    activeFill: 'transparent',
    textTransform: 'uppercase',
    animation: 'fade',
    displayWords: 5,
  },
};

/* ---------- Blockbuster (per-letter kinetic canvas) ----------
 * The same engine as Anime Edit, drawing one fixed two-line look per caption:
 * a heavy red condensed uppercase heading (glow, hard dark-red shadow, slight
 * tilt) over a large white handwritten script line that overlaps its bottom
 * edge. The last two words of a caption become the script line (the last one
 * when the caption has three words or fewer) — see splitBlockbusterWords in
 * lib/kinetic/engine.ts.
 *
 * `color` is the script line, `highlightColor` is the heading + its glow;
 * fontSize is relative to KINETIC_BASE_FONT_SIZE like Anime Edit; the extra
 * knobs (glow / letter spacing / tilt / script size) live in style.kinetic.
 */

export const BLOCKBUSTER: AntigravityCaptionTemplate = {
  id: 'blockbuster',
  name: 'Blockbuster',
  type: 'lines',
  tag: 'New',
  tags: ['Kinetic', 'Cinematic'],
  purpose: 'Trailers · hooks · big reveals',
  desc: 'Heavy red condensed heading with a glow and a hard shadow, over a big white handwritten punchline.',
  style: {
    fontFamily: 'Anton',
    fontSize: 64,
    color: '#FFFFFF',
    align: 'center',
    textTransform: 'none',
    stroke: null,
    shadow: null,
  },
  colors: {
    appeared: '#FFFFFF',
    active: '#FF1F1F',
    activeFill: 'transparent',
    background: 'transparent',
    keyword: '#FF1F1F',
  },
  preset: {
    displayMode: 'phrase',
    template: 'blockbuster',
    fontFamily: 'Anton',
    fontSize: 64,
    fontWeight: 400,
    color: '#FFFFFF',
    backgroundColor: 'rgba(0,0,0,0)',
    highlightColor: '#FF1F1F',
    activeFill: 'transparent',
    textTransform: 'none',
    animation: 'fade',
    displayWords: 6,
  },
};


/* ── "Living Inside It" — five takes on one three-row idea ─────────────────
 * A small lead-in over two very large lines. Each card has its own face
 * pairing, alignment and entry (LIVING_VARIANTS in lib/kinetic/engine.ts);
 * the geometry lives in livingInsideLook there. The faces are pinned by the
 * engine — fontFamily/fontWeight below only describe them for the Text panel.
 * Each card is set as the design's HTML preview draws it (LIVING_VARIANTS).
 * highlightColor paints the headline and color the second line; the presets
 * below are the design's colours, and the lead-in keeps its design tint until
 * either colour is changed. */

export const LIVING_BLUE: AntigravityCaptionTemplate = {
  id: 'livingBlue',
  name: 'Living - Blue',
  type: 'lines',
  tag: 'New',
  tags: ['Kinetic', 'Editorial'],
  purpose: 'Hooks · vlogs · statement openers',
  desc: 'Electric blue headline over a solid white second line. Barlow Condensed at its heaviest - tight and loud, made for 9:16.',
  style: {
    fontFamily: 'Barlow Condensed',
    fontSize: 64,
    color: '#FFFFFF',
    align: 'left',
    textTransform: 'none',
    stroke: null,
    shadow: null,
  },
  colors: {
    appeared: '#FFFFFF',
    active: '#38BDF8',
    activeFill: 'transparent',
    background: 'transparent',
    keyword: '#38BDF8',
  },
  preset: {
    displayMode: 'phrase',
    template: 'livingBlue',
    fontFamily: 'Barlow Condensed',
    fontSize: 64,
    fontWeight: 900,
    color: '#FFFFFF',
    backgroundColor: 'rgba(0,0,0,0)',
    highlightColor: '#38BDF8',
    activeFill: 'transparent',
    textTransform: 'none',
    animation: 'fade',
    displayWords: 7,
  },
};

export const LIVING_TEAL: AntigravityCaptionTemplate = {
  id: 'livingTeal',
  name: 'Living - Teal',
  type: 'lines',
  tag: 'New',
  tags: ['Kinetic', 'Editorial'],
  purpose: 'Hooks · vlogs · statement openers',
  desc: 'Centred Montserrat block. A glowing teal word over a bold white line - calm authority for talking-head vlogs.',
  style: {
    fontFamily: 'Montserrat',
    fontSize: 64,
    color: '#FFFFFF',
    align: 'center',
    textTransform: 'none',
    stroke: null,
    shadow: null,
  },
  colors: {
    appeared: '#FFFFFF',
    active: '#2DD4BF',
    activeFill: 'transparent',
    background: 'transparent',
    keyword: '#2DD4BF',
  },
  preset: {
    displayMode: 'phrase',
    template: 'livingTeal',
    fontFamily: 'Montserrat',
    fontSize: 64,
    fontWeight: 900,
    color: '#FFFFFF',
    backgroundColor: 'rgba(0,0,0,0)',
    highlightColor: '#2DD4BF',
    activeFill: 'transparent',
    textTransform: 'none',
    animation: 'fade',
    displayWords: 7,
  },
};

export const LIVING_ORANGE: AntigravityCaptionTemplate = {
  id: 'livingOrange',
  name: 'Living - Orange',
  type: 'lines',
  tag: 'New',
  tags: ['Kinetic', 'Editorial'],
  purpose: 'Hooks · vlogs · statement openers',
  desc: 'Right-aligned in the top corner. Warm caps lead-in, a glowing orange accent, a near-white closer - punchy drama.',
  style: {
    fontFamily: 'Oswald',
    fontSize: 64,
    color: '#F0F0F0',
    align: 'right',
    textTransform: 'none',
    stroke: null,
    shadow: null,
  },
  colors: {
    appeared: '#F0F0F0',
    active: '#F97316',
    activeFill: 'transparent',
    background: 'transparent',
    keyword: '#F97316',
  },
  preset: {
    displayMode: 'phrase',
    template: 'livingOrange',
    fontFamily: 'Oswald',
    fontSize: 64,
    fontWeight: 700,
    color: '#F0F0F0',
    backgroundColor: 'rgba(0,0,0,0)',
    highlightColor: '#F97316',
    activeFill: 'transparent',
    textTransform: 'none',
    animation: 'fade',
    displayWords: 7,
  },
};

export const LIVING_RED: AntigravityCaptionTemplate = {
  id: 'livingRed',
  name: 'Living - Red',
  type: 'lines',
  tag: 'New',
  tags: ['Kinetic', 'Editorial'],
  purpose: 'Hooks · vlogs · statement openers',
  desc: 'A huge editorial red serif under a faint italic lead-in, closed by tracked Bebas caps - maximum tension, minimum elements.',
  style: {
    fontFamily: 'Playfair Display',
    fontSize: 64,
    color: '#F5F5F5',
    align: 'center',
    textTransform: 'none',
    stroke: null,
    shadow: null,
  },
  colors: {
    appeared: '#F5F5F5',
    active: '#DC2626',
    activeFill: 'transparent',
    background: 'transparent',
    keyword: '#DC2626',
  },
  preset: {
    displayMode: 'phrase',
    template: 'livingRed',
    fontFamily: 'Playfair Display',
    fontSize: 64,
    fontWeight: 700,
    color: '#F5F5F5',
    backgroundColor: 'rgba(0,0,0,0)',
    highlightColor: '#DC2626',
    activeFill: 'transparent',
    textTransform: 'none',
    animation: 'fade',
    displayWords: 7,
  },
};

export const LIVING_PURPLE: AntigravityCaptionTemplate = {
  id: 'livingPurple',
  name: 'Living - Purple',
  type: 'lines',
  tag: 'New',
  tags: ['Kinetic', 'Editorial'],
  purpose: 'Hooks · vlogs · statement openers',
  desc: 'Chunky Anton caps anchored bottom-left: a hollow purple outline over a solid lilac line - builds mystery from the bottom.',
  style: {
    fontFamily: 'Anton',
    fontSize: 64,
    color: '#D8B4FE',
    align: 'left',
    textTransform: 'none',
    stroke: null,
    shadow: null,
  },
  colors: {
    appeared: '#D8B4FE',
    active: '#A855F7',
    activeFill: 'transparent',
    background: 'transparent',
    keyword: '#A855F7',
  },
  preset: {
    displayMode: 'phrase',
    template: 'livingPurple',
    fontFamily: 'Anton',
    fontSize: 64,
    fontWeight: 400,
    color: '#D8B4FE',
    backgroundColor: 'rgba(0,0,0,0)',
    highlightColor: '#A855F7',
    activeFill: 'transparent',
    textTransform: 'none',
    animation: 'fade',
    displayWords: 7,
  },
};

export const CAPTION_TEMPLATES: AntigravityCaptionTemplate[] = [
  HERO_WORD_TEMPLATE,
  ANIME_EDIT,
  BLOCKBUSTER,
  LIVING_BLUE,
  LIVING_TEAL,
  LIVING_ORANGE,
  LIVING_RED,
  LIVING_PURPLE,
  MIXED_STYLES_2,
  CREATOR_YELLOW_BOX,
  CINEMATIC_SUBTITLE,
  BUBBLE_CANDY,
  INDUSTRIAL,
  TIKTOK_CLASSIC,
  ROBOTO_WORD,
  TIKTOK_PILL,
  CLEAN_WHITE,
  POPPINS_BOLD,
  EDITOR_MASALA,
  AURA,
  SWISS,
  THE_BIG_RED,
  SCRIBBLE,
  ARCHIVES,
];

/** Picker cards — same shape as EditorPage UNIFIED_TEMPLATES entries. */
export const ANTIGRAVITY_UNIFIED_TEMPLATES = CAPTION_TEMPLATES.map((t) => ({
  key: t.id,
  name: t.name,
  tag: t.tag,
  tags: t.tags,
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
