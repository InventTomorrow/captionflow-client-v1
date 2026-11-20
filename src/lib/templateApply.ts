/**
 * lib/templateApply.ts — what applying a template card does to a caption style.
 *
 * One rule for the editor's picker, a clip's look, New Clips and the
 * preview/export parity page, so a card looks the same wherever it is applied
 * and whatever was applied before it:
 *   - every look field a template owns is reset to the card's value, or to the
 *     editor default when the card doesn't set it (nothing carries over from the
 *     previous template — e.g. one template's 2 words per caption);
 *   - everything else (position, aspect, behind-person, Blockbuster knobs…) and
 *     the captions themselves are left alone;
 *   - the stacked templates' forced display mode and Hero Word's fixed
 *     font/accent rules are applied (same rules as buildExportStyle).
 */
import { stackedDisplayMode } from './export/styleSnapshot';
import { TEMPLATE_CATALOG, templateByKey, type UnifiedTemplate } from './templateCatalog';

/** The look fields a template owns, with the editor's defaults (EditorPage's initial style). */
export const TEMPLATE_LOOK_DEFAULTS = {
  fontFamily: 'Montserrat',
  fontSize: 48,
  fontWeight: 700,
  color: '#FFFFFF',
  backgroundColor: 'rgba(0,0,0,0)',
  highlightColor: '#FFC43D',
  activeFill: 'transparent',
  textTransform: 'none' as 'none' | 'uppercase' | 'lowercase',
  animation: 'fade',
  displayWords: 5,
};

type Look = typeof TEMPLATE_LOOK_DEFAULTS & { template: string; displayMode: string; templateKey: string };

/** `current` switched to `card`'s look; fields a template doesn't own are kept. */
export function styleWithTemplate<S extends object>(current: S, card: UnifiedTemplate): Omit<S, keyof Look> & Look {
  const next = {
    ...current,
    ...TEMPLATE_LOOK_DEFAULTS,
    ...card.preset,
    templateKey: card.key,
  } as Omit<S, keyof Look> & Look;
  const forced = stackedDisplayMode(next.template);
  if (forced) next.displayMode = forced;
  if (next.template === 'heroWord') {
    if (!next.highlightColor || next.highlightColor.toUpperCase() === '#FFFFFF') next.highlightColor = '#FF2D9A';
    next.fontWeight = 900;
    next.fontFamily = 'Montserrat';
  }
  return next;
}

type StyleLike = {
  templateKey?: string;
  template?: string;
  displayMode?: string;
  animation?: string;
  fontFamily?: string;
  highlightColor?: string;
};

/**
 * The card this style is currently showing, or undefined for a custom look.
 * A card counts as applied while the style still renders with that card's
 * template and display mode — after switching the renderer or display mode
 * elsewhere, no card claims to be applied. Colour or size tweaks keep it.
 */
export function appliedTemplateKey(style: StyleLike | null | undefined): string | undefined {
  if (!style) return undefined;
  // A saved card key, or (older projects saved none) a card whose look this
  // style matches exactly — never matchTemplateKey's loose "same renderer"
  // guess, which would show a card as applied that the user never picked.
  const saved = templateByKey(style.templateKey);
  const card =
    saved ??
    TEMPLATE_CATALOG.find((t) => {
      const look = styleWithTemplate({}, t);
      return (
        look.template === style.template &&
        look.displayMode === style.displayMode &&
        look.animation === style.animation &&
        (look.fontFamily || '') === (style.fontFamily || '') &&
        (look.highlightColor || '').toUpperCase() === (style.highlightColor || '').toUpperCase()
      );
    });
  if (!card) return undefined;
  const look = styleWithTemplate({}, card);
  return look.template === style.template && look.displayMode === style.displayMode ? card.key : undefined;
}
