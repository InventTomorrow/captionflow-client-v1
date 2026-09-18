/**
 * The template picker's card catalog (moved out of EditorPage.tsx so the admin
 * Templates page shares it) and the admin's arrangement on top of it.
 *
 * Card keys are stored on the project (style.templateKey) and in the server's
 * export log (server/src/models/ExportEvent.ts), so never rename a key.
 */
import type { CaptionTemplate } from '../components/CaptionOverlay';
import type { DisplayMode } from './displayCaptions';
import { ANTIGRAVITY_UNIFIED_TEMPLATES } from './captionTemplates';

/** Style a card applies (a subset of the editor's style state). */
export interface TemplatePreset {
  displayMode: DisplayMode;
  template: CaptionTemplate;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  color?: string;
  backgroundColor?: string;
  highlightColor?: string;
  activeFill?: string;
  textTransform?: 'none' | 'uppercase' | 'lowercase';
  animation?: string;
  displayWords?: number;
}

/**
 * One unified template catalog: every entry is a unique purpose + look.
 * No color-only duplicates — each card must read differently at a glance.
 */
export interface UnifiedTemplate {
  key: string;
  name: string;
  tag?: string;
  /** Small pills under the name. */
  tags?: string[];
  /** One-line “use this when…” purpose. */
  purpose: string;
  desc: string;
  preset: TemplatePreset;
}

const HERO_WORD_CARD = ANTIGRAVITY_UNIFIED_TEMPLATES.find((t) => t.key === 'hero-word')!;
const INDUSTRIAL_CARD = ANTIGRAVITY_UNIFIED_TEMPLATES.find((t) => t.key === 'industrial')!;

export const TEMPLATE_CATALOG: UnifiedTemplate[] = [
  // Hero Word pinned first — it's the flagship template.
  HERO_WORD_CARD,
  // Industrial Display pinned second.
  INDUSTRIAL_CARD,
  {
    key: 'beat-karaoke',
    name: 'Beat Karaoke',
    tag: 'Popular',
    purpose: 'Music · hooks · talking-head',
    desc: 'Phrase stays up; the spoken word lights in sync with audio.',
    preset: {
      displayMode: 'karaoke',
      template: 'classic',
      fontFamily: 'Poppins',
      fontWeight: 700,
      color: '#FFFFFF',
      backgroundColor: 'rgba(0,0,0,0)',
      highlightColor: '#FFC43D',
      animation: 'fade',
    },
  },
  {
    key: 'hero-punch',
    name: 'Hero Punch',
    tag: 'Premium',
    purpose: 'Key message · brand words',
    desc: 'Each word on its own line - the hero word alone, big and loud.',
    preset: {
      displayMode: 'phrase',
      template: 'hero',
      fontFamily: 'Montserrat',
      fontWeight: 900,
      color: '#FFFFFF',
      backgroundColor: 'rgba(0,0,0,0)',
      highlightColor: '#8FE649',
      animation: 'pop',
    },
  },
  {
    key: 'word-blast',
    name: 'Word Blast',
    tag: 'Impact',
    purpose: 'Hype · punchlines · drops',
    desc: 'One giant word at a time, timed to each spoken beat.',
    preset: {
      displayMode: 'word',
      template: 'bigpop',
      fontFamily: 'Anton',
      fontWeight: 900,
      color: '#FFFFFF',
      backgroundColor: 'rgba(0,0,0,0)',
      highlightColor: '#FFFFFF',
      animation: 'bounce',
    },
  },
  {
    key: 'soft-flicker',
    name: 'Soft Flicker',
    tag: 'Flicker',
    purpose: 'Cinematic · trailers · drama',
    desc: 'A bright word with a soft flicker glow for tense moments.',
    preset: {
      displayMode: 'phrase',
      template: 'classic',
      fontFamily: 'Bebas Neue',
      fontWeight: 700,
      color: '#FFFFFF',
      backgroundColor: 'rgba(0,0,0,0)',
      highlightColor: '#FFFFFF',
      animation: 'pop',
      displayWords: 3,
    },
  },
  {
    key: 'marker-pen',
    name: 'Marker Pen',
    tag: 'Accent',
    purpose: 'Tutorials · tips · emphasis',
    desc: 'Key word sits on a highlighter stroke - teach and point.',
    preset: {
      displayMode: 'phrase',
      template: 'highlight',
      fontFamily: 'Poppins',
      fontWeight: 700,
      color: '#FFFFFF',
      backgroundColor: 'rgba(0,0,0,0)',
      highlightColor: '#FFC43D',
      animation: 'fade',
    },
  },
  {
    key: 'stack-verse',
    name: 'Stack Verse',
    tag: 'Stylish',
    purpose: 'Poetry · storytelling · ads',
    desc: 'Mixed-size stacked lines - reads like a designed poster.',
    preset: {
      displayMode: 'phrase',
      template: 'stack',
      fontFamily: 'Oswald',
      fontWeight: 700,
      color: '#FFFFFF',
      backgroundColor: 'rgba(0,0,0,0)',
      highlightColor: '#E7C65C',
      animation: 'slideUp',
    },
  },
  {
    key: 'full-sentence',
    name: 'Full Sentence',
    purpose: 'Quotes · subtitles · accessibility',
    desc: 'Keeps a full sentence on screen until the next one starts.',
    preset: {
      displayMode: 'sentence',
      template: 'classic',
      fontFamily: 'Inter',
      fontWeight: 600,
      color: '#FFFFFF',
      backgroundColor: 'rgba(0,0,0,0)',
      highlightColor: '#FFFFFF',
      animation: 'fade',
    },
  },
  {
    key: 'word-reveal',
    name: 'Word Reveal',
    purpose: 'Story builds · suspense',
    desc: 'Words paint on one after another as they are spoken.',
    preset: {
      displayMode: 'paintOn',
      template: 'classic',
      fontFamily: 'Poppins',
      fontWeight: 700,
      color: '#FFFFFF',
      backgroundColor: 'rgba(0,0,0,0)',
      highlightColor: '#8FE649',
      animation: 'fade',
    },
  },
  {
    key: 'typewriter',
    name: 'Typewriter',
    purpose: 'Tech · ASMR · focus moments',
    desc: 'Characters type out one by one with a blinking caret.',
    preset: {
      displayMode: 'typewriter',
      template: 'classic',
      fontFamily: 'Rubik',
      fontWeight: 600,
      color: '#FFFFFF',
      backgroundColor: 'rgba(0,0,0,0)',
      highlightColor: '#FFFFFF',
      animation: 'none',
    },
  },
  // Antigravity / TikTok-style presets — appended; previous cards unchanged.
  // Hero Word and Industrial are pinned above.
  ...ANTIGRAVITY_UNIFIED_TEMPLATES.filter((t) => t.key !== 'hero-word' && t.key !== 'industrial'),
];

/** Cards kept in the code but left out of the picker until an admin shows them. */
export const DEFAULT_HIDDEN_TEMPLATE_KEYS: readonly string[] = ['mixed-styles-2', 'clean-white', 'editor-masala'];

/** Picker arrangement saved on the admin Templates page (SystemConfig.templateLayout). */
export interface TemplateLayout {
  order: string[];
  hidden: string[];
}

export type ArrangedTemplate = UnifiedTemplate & { hidden: boolean };

/**
 * Every card in picker order: the admin's order first, then cards the admin
 * hasn't placed yet (added to the code later) in catalog order. A card the
 * admin hasn't placed keeps its default visibility.
 */
export function arrangeTemplates(layout?: TemplateLayout | null): ArrangedTemplate[] {
  const byKey = new Map(TEMPLATE_CATALOG.map((t) => [t.key, t]));
  const placed = new Set([...(layout?.order ?? []), ...(layout?.hidden ?? [])]);
  const hidden = new Set(layout?.hidden ?? []);
  const out: ArrangedTemplate[] = [];
  const seen = new Set<string>();
  for (const key of layout?.order ?? []) {
    const card = byKey.get(key);
    if (!card || seen.has(key)) continue;
    seen.add(key);
    out.push({ ...card, hidden: hidden.has(key) });
  }
  for (const card of TEMPLATE_CATALOG) {
    if (seen.has(card.key)) continue;
    out.push({
      ...card,
      hidden: placed.has(card.key) ? hidden.has(card.key) : DEFAULT_HIDDEN_TEMPLATE_KEYS.includes(card.key),
    });
  }
  return out;
}

/** The cards the editor's picker shows, in order. */
export function pickerTemplates(layout?: TemplateLayout | null): UnifiedTemplate[] {
  return arrangeTemplates(layout).filter((t) => !t.hidden);
}

export function templateByKey(key: string | undefined | null): UnifiedTemplate | undefined {
  return key ? TEMPLATE_CATALOG.find((t) => t.key === key) : undefined;
}

type StyleLike = {
  templateKey?: string;
  template?: string;
  displayMode?: string;
  animation?: string;
  fontFamily?: string;
  highlightColor?: string;
};

const sameText = (a?: string | null, b?: string | null) => (a || '').toUpperCase() === (b || '').toUpperCase();

/**
 * The card a style came from: its saved key, else the card whose look it
 * matches (older projects saved no key). Exact look first, then the same
 * renderer + display mode (preferring the same font), then a renderer only one
 * card uses. undefined = a custom look.
 */
export function matchTemplateKey(style: StyleLike | null | undefined): string | undefined {
  if (!style) return undefined;
  if (style.templateKey && templateByKey(style.templateKey)) return style.templateKey;
  const exact = TEMPLATE_CATALOG.find(
    (t) =>
      style.displayMode === t.preset.displayMode &&
      style.template === t.preset.template &&
      (t.preset.animation == null || style.animation === t.preset.animation) &&
      (style.fontFamily || '') === (t.preset.fontFamily || '') &&
      sameText(style.highlightColor, t.preset.highlightColor),
  );
  if (exact) return exact.key;
  const sameMode = TEMPLATE_CATALOG.filter(
    (t) => t.preset.template === style.template && t.preset.displayMode === style.displayMode,
  );
  if (sameMode.length) return (sameMode.find((t) => t.preset.fontFamily === style.fontFamily) ?? sameMode[0]).key;
  const sameRenderer = TEMPLATE_CATALOG.filter((t) => t.preset.template === style.template);
  return sameRenderer.length === 1 ? sameRenderer[0].key : undefined;
}
