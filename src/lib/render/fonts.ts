/**
 * render/fonts.ts — which TTF file each caption font family resolves to.
 *
 * SHARED MODULE: the client copy is canonical and is mirrored into
 * server/src/services/render/ (see server/scripts/sync-render.mjs). It must
 * stay free of DOM and Node imports so both hosts can use it as-is.
 *
 * The files live in server/fonts/ (canonical, fetched by
 * server/scripts/download-fonts.mjs) and are mirrored byte-for-byte into
 * client/public/fonts/ (server/scripts/sync-fonts.mjs). The browser export
 * worker loads exactly these bytes, so a caption measured in the browser and
 * one measured on the server come out the same width.
 *
 * This is the one table `BUNDLED_FONT_FILES` in export.service.ts,
 * `KINETIC_FONT_FILES` in captionPng.service.ts and the Hero Word / Mixed
 * font lists used to be — kept here once so they cannot drift.
 */

/** CSS family → candidate files, in preference order (weight may reorder). */
export const FONT_FILES: Record<string, readonly string[]> = {
  Montserrat: ['Montserrat-Bold.ttf', 'Montserrat-Black.ttf'],
  Poppins: ['Poppins-Bold.ttf'],
  Inter: ['Inter-Bold.ttf'],
  Roboto: ['Roboto-Bold.ttf'],
  'Open Sans': ['OpenSans-Bold.ttf'],
  Lato: ['Lato-Bold.ttf'],
  Raleway: ['Raleway-Bold.ttf'],
  Nunito: ['Nunito-Bold.ttf'],
  Rubik: ['Rubik-Bold.ttf'],
  Kanit: ['Kanit-Bold.ttf'],
  Barlow: ['Barlow-Bold.ttf'],
  Manrope: ['Manrope-Bold.ttf'],
  'Work Sans': ['WorkSans-Bold.ttf'],
  'DM Sans': ['DMSans-Bold.ttf'],
  Outfit: ['Outfit-Bold.ttf'],
  Sora: ['Sora-Bold.ttf'],
  'Exo 2': ['Exo2-Bold.ttf'],
  'Josefin Sans': ['JosefinSans-Bold.ttf'],
  Quicksand: ['Quicksand-Bold.ttf'],
  Comfortaa: ['Comfortaa-Bold.ttf'],
  Fredoka: ['Fredoka-Bold.ttf'],
  'Baloo 2': ['Baloo2-Bold.ttf'],
  Oswald: ['Oswald-Bold.ttf'],
  'Bebas Neue': ['BebasNeue-Regular.ttf'],
  Anton: ['Anton-Regular.ttf'],
  'Archivo Black': ['ArchivoBlack-Regular.ttf'],
  Archivo: ['Archivo-Bold.ttf'],
  Rajdhani: ['Rajdhani-Bold.ttf'],
  Teko: ['Teko-Bold.ttf'],
  Staatliches: ['Staatliches-Regular.ttf'],
  'Fjalla One': ['FjallaOne-Regular.ttf'],
  'Saira Condensed': ['SairaCondensed-Black.ttf', 'SairaCondensed-Bold.ttf'],
  'Barlow Condensed': [
    'BarlowCondensed-Black.ttf',
    'BarlowCondensed-Bold.ttf',
    'BarlowCondensed-BoldItalic.ttf',
  ],
  'Russo One': ['RussoOne-Regular.ttf'],
  Righteous: ['Righteous-Regular.ttf'],
  'Alfa Slab One': ['AlfaSlabOne-Regular.ttf'],
  'Concert One': ['ConcertOne-Regular.ttf'],
  'Secular One': ['SecularOne-Regular.ttf'],
  'Passion One': ['PassionOne-Black.ttf', 'PassionOne-Bold.ttf'],
  'Titan One': ['TitanOne-Regular.ttf'],
  Bangers: ['Bangers-Regular.ttf'],
  Bungee: ['Bungee-Regular.ttf'],
  'Luckiest Guy': ['LuckiestGuy-Regular.ttf'],
  Orbitron: ['Orbitron-Bold.ttf'],
  'Playfair Display': ['PlayfairDisplay-Bold.ttf', 'PlayfairDisplay-Italic.ttf'],
  Merriweather: ['Merriweather-Bold.ttf'],
  Lora: ['Lora-Bold.ttf'],
  'PT Serif': ['PTSerif-Bold.ttf'],
  'Crimson Text': ['CrimsonText-Bold.ttf'],
  Cinzel: ['Cinzel-Bold.ttf'],
  'Cormorant Garamond': ['CormorantGaramond-Bold.ttf'],
  'Abril Fatface': ['AbrilFatface-Regular.ttf'],
  Lobster: ['Lobster-Regular.ttf'],
  Pacifico: ['Pacifico-Regular.ttf'],
  'Dancing Script': ['DancingScript-Bold.ttf'],
  Caveat: ['Caveat-Bold.ttf'],
  'Permanent Marker': ['PermanentMarker-Regular.ttf'],
  'Shadows Into Light': ['ShadowsIntoLight-Regular.ttf'],
  'Amatic SC': ['AmaticSC-Bold.ttf'],
  'Noto Nastaliq Urdu': ['NotoNastaliqUrdu-Bold.ttf'],
  'Noto Sans Arabic': ['NotoSansArabic-Bold.ttf'],
  Cairo: ['Cairo-Bold.ttf'],
  Tajawal: ['Tajawal-Black.ttf', 'Tajawal-Bold.ttf'],
  Amiri: ['Amiri-Bold.ttf'],
};

export const DEFAULT_FONT_FAMILY = 'Montserrat';

/**
 * The file a user-selectable family renders with. Weight ≥ 900 prefers a
 * Black/Heavy cut when the family ships one — same rule as the server's
 * `pickBundledFontFile`, minus the on-disk existence check (the sync script
 * guarantees the file set).
 */
export function pickFontFile(family: string, fontWeight = 700): string | null {
  const requested = (family || DEFAULT_FONT_FAMILY).split(',')[0].trim().replace(/^['"]|['"]$/g, '');
  const candidates = FONT_FILES[requested];
  if (!candidates?.length) return null;
  if (fontWeight < 900) return candidates[0];
  const score = (f: string) => (/black|heavy/i.test(f) ? 0 : /bold|extra/i.test(f) ? 1 : 2);
  return [...candidates].sort((a, b) => score(a) - score(b))[0];
}

/** Faces pinned by templates that ignore the font picker. */
export const TEMPLATE_FONT_FILES = {
  // Hero Word tiers (HERO_WORD_TIERS in export.service.ts / .cap-hw-* in index.css)
  montserratBlack: 'Montserrat-Black.ttf',
  montserratBold: 'Montserrat-Bold.ttf',
  playfairItalic: 'PlayfairDisplay-Italic.ttf',
  // editorMasala / aura / swiss / theBigRed / scribble / archives (captionPng.service.ts)
  anton: 'Anton-Regular.ttf',
  archivoBold: 'Archivo-Bold.ttf',
  archivoBlack: 'ArchivoBlack-Regular.ttf',
  playfairBold: 'PlayfairDisplay-Bold.ttf',
  dancingScript: 'DancingScript-Bold.ttf',
  interBold: 'Inter-Bold.ttf',
  caveat: 'Caveat-Bold.ttf',
  // Mixed Styles 1 (in addition to some of the above)
  orbitron: 'Orbitron-Bold.ttf',
  poppins: 'Poppins-Bold.ttf',
  lora: 'Lora-Bold.ttf',
  cinzel: 'Cinzel-Bold.ttf',
  luckiestGuy: 'LuckiestGuy-Regular.ttf',
  // Mixed Styles 2
  ptSerif: 'PTSerif-Bold.ttf',
  rajdhani: 'Rajdhani-Bold.ttf',
  sora: 'Sora-Bold.ttf',
  merriweather: 'Merriweather-Bold.ttf',
  josefinSans: 'JosefinSans-Bold.ttf',
  cormorantGaramond: 'CormorantGaramond-Bold.ttf',
  fjallaOne: 'FjallaOne-Regular.ttf',
} as const;

export type TemplateFontKey = keyof typeof TEMPLATE_FONT_FILES;

export const HERO_WORD_FONT_FILES = [
  TEMPLATE_FONT_FILES.montserratBlack,
  TEMPLATE_FONT_FILES.montserratBold,
  TEMPLATE_FONT_FILES.playfairItalic,
] as const;

/** Where the browser fetches font files from (client/public/fonts). */
export const FONT_URL_BASE = '/fonts';

export function fontFileUrl(file: string, base: string = FONT_URL_BASE): string {
  return `${base.replace(/\/$/, '')}/${file}`;
}

/** Every distinct file the tables above reference — the set the sync keeps. */
export function allFontFiles(): string[] {
  const out = new Set<string>();
  for (const files of Object.values(FONT_FILES)) for (const f of files) out.add(f);
  for (const f of Object.values(TEMPLATE_FONT_FILES)) out.add(f);
  return [...out].sort();
}
