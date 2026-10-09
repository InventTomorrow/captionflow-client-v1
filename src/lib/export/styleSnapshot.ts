/**
 * export/styleSnapshot.ts — the full, explicit caption style a burn-in needs,
 * built from whatever partial style the editor (or a clip) holds. Shared by
 * the editor's export and Clips so both render identically to their preview.
 */
import type { CaptionTemplate } from '../../components/CaptionOverlay';
import type { DisplayMode } from '../displayCaptions';
import { isKineticTemplate, type KineticParams } from '../kinetic/engine';
import { matchTemplateKey } from '../templateCatalog';

export interface EditorStyle {
  template: CaptionTemplate;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  color: string;
  backgroundColor: string;
  /** Accent color for hero words, karaoke highlight, marks. */
  highlightColor: string;
  /** Karaoke active-word pill fill (e.g. Viral Orange). Transparent = none. */
  activeFill: string;
  /** Optional whole-caption text transform from Antigravity presets. */
  textTransform: 'none' | 'uppercase' | 'lowercase';
  position: 'top' | 'center' | 'bottom';
  /** Custom vertical position (% from top, caption center). null = use `position` preset. */
  offsetY: number | null;
  /** Custom horizontal position (% from left, caption center). null = centered. */
  offsetX: number | null;
  animation: string;
  /** Preview/export canvas ratio (e.g. 9:16, 16:9). */
  aspectRatio: string;
  /** How captions appear on the video — derived client-side, no API calls. */
  displayMode: DisplayMode;
  /** Words per caption for phrase-based display templates. */
  displayWords: number;
  /** Blockbuster's knobs (glow / letter spacing / tilt / script size); missing = as authored. */
  kinetic?: KineticParams;
  /** Text behind person (kinetic templates): person composited over the captions. */
  behindPerson?: boolean;
  /** Picker card the style started from (lib/templateCatalog.ts); feeds the admin export log. */
  templateKey?: string;
}

/**
 * Display mode forced by the multi-size ("stacked") templates, or null when
 * the template lets the user pick freely.
 *
 * These templates size each word differently, so karaoke/word modes would
 * flatten them. Hero Word additionally builds its phrase up word by word
 * (paintOn); Neon Glow / Hero Punch / Poetic Stack show the whole block.
 *
 * MUST stay in sync with stackedDisplayMode() in
 * server/src/services/export.service.ts — that pairing is what makes the
 * preview and the burned-in export identical.
 */
export function stackedDisplayMode(template?: string): DisplayMode | null {
  if (template === 'heroWord') return 'paintOn';
  if (
    template === 'hero' ||
    template === 'stack' ||
    template === 'mixed' ||
    template === 'mixed2'
  )
    return 'phrase';
  // The kinetic templates lay out a whole caption's letters at once and stagger
  // them internally, so karaoke/word would fight the engine's own timing.
  if (isKineticTemplate(template)) return 'phrase';
  return null;
}

/**
 * Explicit full snapshot — every field the burn-in needs, with the editor's
 * defaults. Mirrors live editor rules only — never inflates fontSize/weight
 * (that made burn-in look different from the preview the user approved).
 */
export function buildExportStyle(live: Partial<EditorStyle>, opts: { defaultAspect: string }): EditorStyle {
  const aspectForBurn =
    live.aspectRatio && live.aspectRatio !== 'original' ? live.aspectRatio : opts.defaultAspect;
  const styleSnap: EditorStyle = {
    template: live.template || 'classic',
    fontFamily: live.fontFamily || 'Montserrat',
    fontSize: Number(live.fontSize) || 48,
    fontWeight: Number(live.fontWeight) || 700,
    color: live.color || '#FFFFFF',
    backgroundColor: live.backgroundColor || 'rgba(0,0,0,0)',
    highlightColor: live.highlightColor || '#FFC43D',
    activeFill: live.activeFill || 'transparent',
    textTransform: live.textTransform || 'none',
    position: live.position || 'bottom',
    offsetX: typeof live.offsetX === 'number' ? live.offsetX : 50,
    offsetY: typeof live.offsetY === 'number' ? live.offsetY : 72,
    animation: live.animation || 'fade',
    aspectRatio: aspectForBurn,
    displayMode: live.displayMode || 'phrase',
    displayWords: Number(live.displayWords) || 5,
    kinetic: live.kinetic,
    behindPerson: !!live.behindPerson,
    // Older projects saved no key: match the look to a card ("" = custom look).
    templateKey: matchTemplateKey(live) ?? '',
  };
  const forcedExportMode = stackedDisplayMode(styleSnap.template);
  if (forcedExportMode) styleSnap.displayMode = forcedExportMode;
  if (styleSnap.template === 'heroWord') {
    if (!styleSnap.highlightColor || styleSnap.highlightColor === '#FFFFFF') {
      styleSnap.highlightColor = '#FF2D9A';
    }
    styleSnap.fontWeight = styleSnap.fontWeight || 900;
    styleSnap.fontFamily = 'Montserrat';
  }
  return styleSnap;
}
