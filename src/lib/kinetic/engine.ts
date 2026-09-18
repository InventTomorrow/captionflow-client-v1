/**
 * kinetic/engine.ts — THE single source of truth for the per-letter canvas
 * templates.
 *
 * Two templates share this engine:
 *   - 'animeEdit'   — five internal looks (scatteredStack, neonDisappear,
 *                     letterChaos, impactSlam, glitchSplit) intercut per caption
 *                     by pickKineticLook, so a sequence varies the way a
 *                     hand-made AMV edit does instead of repeating one effect.
 *   - 'blockbuster' — one fixed two-line look: a heavy red condensed heading
 *                     with glow + hard shadow + a slight tilt, over a large white
 *                     handwritten script line that overlaps its bottom edge.
 *
 * This file is BYTE-IDENTICAL in two places:
 *   client/src/lib/kinetic/engine.ts        — browser preview (CaptionOverlay)
 *   server/src/services/kinetic/engine.ts   — burn-in export (@napi-rs/canvas)
 *
 * Run `npm run kinetic:sync` (server) to copy client -> server, and
 * `npm run test:smoke` to assert they have not drifted. The client copy is
 * canonical; never hand-edit the server copy.
 *
 * Every other template in this project keeps preview and export in sync by
 * hand-mirroring constants (HERO_WORD_TIERS vs .tpl-heroWord, MIXED_STYLE_SPECS
 * vs .cap-mixed-N). Per-letter layout has far too many numbers for that to hold,
 * so this shares one implementation instead of two mirrored ones.
 *
 * Five rules this engine enforces:
 *
 *  R1  LAYOUT IS NORMALISED. Positions are fractions of the frame, never pixels,
 *      so one composition is correct at 640x360 preview and 3840x2160 export.
 *
 *  R2  LAYOUT USES REAL FONT METRICS. Letter advances come from measureText(),
 *      never a guessed ratio like `fontSize * 0.58`. (The spec this is built
 *      from used 0.58; Bebas Neue is ~0.45 em, so that guess overlaps letters.)
 *
 *  R3  LAYOUT IS SEEDED. All randomness derives from a seed hashed from the
 *      caption's own text, so preview and export produce the same scatter and a
 *      re-export never reshuffles.
 *
 *  R4  ANIMATION IS A PURE FUNCTION OF TIME. No Math.random(), no per-frame
 *      counters. render(t) gives identical pixels at 30fps, 60fps or 144Hz.
 *
 *  R5  EVERY SIZE IS RELATIVE. Shadow offsets, glow radii and chroma splits are
 *      in em, so they scale instead of vanishing at 1080 or swamping 360.
 */

/** Bump when a change alters pixel output. */
export const KINETIC_ENGINE_VERSION = 2;

/**
 * Template ids this engine renders. Each is ONE picker card; the looks below are
 * internal sub-styles, not separate templates the user picks between — same
 * shape as `mixed`/`mixed2`, which cycle 8 curated sub-looks under a single id.
 *
 * 'animeEdit' replaces what an AMV editor does by hand: vary the treatment line
 * by line so a sequence never feels like one repeated effect. The editor chooses
 * "Anime Edit" once; `pickKineticLook` decides per caption. 'blockbuster' has a
 * single look and always draws it.
 */
export const KINETIC_TEMPLATE_IDS = [
  'animeEdit',
  'blockbuster',
  // "Living Inside It" — five takes on one three-row idea (a small lead-in over
  // two big lines). Each is its own template id (and its own picker card): the
  // face pairing, alignment, entry and second-line treatment all differ per
  // variant (LIVING_VARIANTS); only the row split and the paint order are shared.
  'livingBlue',
  'livingTeal',
  'livingOrange',
  'livingRed',
  'livingPurple',
] as const;

export type KineticTemplateId = (typeof KINETIC_TEMPLATE_IDS)[number];

/** The original (and default) template id — kept for the diag scripts. */
export const KINETIC_TEMPLATE_ID: KineticTemplateId = 'animeEdit';

export const KINETIC_LOOK_NAMES = [
  'scatteredStack',
  'neonDisappear',
  'letterChaos',
  'impactSlam',
  'glitchSplit',
  'blockbuster',
  'livingBlue',
  'livingTeal',
  'livingOrange',
  'livingRed',
  'livingPurple',
] as const;

export type KineticLook = (typeof KINETIC_LOOK_NAMES)[number];

/**
 * Which looks each template may draw. A single-look template always draws that
 * look; a multi-look template goes through pickKineticLook (whose buckets only
 * ever name the five Anime Edit looks, so 'blockbuster' can never be picked
 * for an Anime Edit caption).
 */
export const KINETIC_TEMPLATE_LOOKS: Record<KineticTemplateId, readonly KineticLook[]> = {
  animeEdit: ['scatteredStack', 'neonDisappear', 'letterChaos', 'impactSlam', 'glitchSplit'],
  blockbuster: ['blockbuster'],
  livingBlue: ['livingBlue'],
  livingTeal: ['livingTeal'],
  livingOrange: ['livingOrange'],
  livingRed: ['livingRed'],
  livingPurple: ['livingPurple'],
};

export function isKineticTemplate(t: string | undefined): t is KineticTemplateId {
  return (KINETIC_TEMPLATE_IDS as readonly string[]).includes(t ?? '');
}

/**
 * The faces the looks draw in. Pinned per look, exactly like KINETIC_FONT_FILES
 * in captionPng.service.ts — these looks depend on a specific display face, and
 * letting the Text panel swap in Noto Nastaliq would break the layouts.
 *
 * `file` must exist in server/fonts (download-fonts.mjs TARGETS) and `family`
 * must be imported in client/src/index.css (or linked from client/index.html).
 * Every face below satisfies both today.
 */
export const KINETIC_FACE_NAMES = [
  'bebasNeue',
  'orbitron',
  'anton',
  'caveatBold',
  'barlowBlack',
  'barlowItalic',
  'montserratBlack',
  'montserratBold',
  'alfaSlab',
  'oswaldBold',
  'playfairBold',
  'playfairItalic',
  'bungee',
  'montserratRegular',
  'playfairBoldItalic',
] as const;

export type KineticFace = (typeof KINETIC_FACE_NAMES)[number];

export interface KineticFaceSpec {
  family: string;
  file: string;
  weight: number;
  /** Set for oblique faces. Feeds both the canvas font string and the metrics
   *  cache key — an italic measured with the upright face mis-spaces. */
  style?: 'italic';
}

export const KINETIC_FACES: Record<KineticFace, KineticFaceSpec> = {
  // Bebas Neue ships ONE weight. Asking for 900 makes the browser synthesise a
  // fake bold by smearing outlines, which is why display type looked mushy.
  bebasNeue: { family: 'Bebas Neue', file: 'BebasNeue-Regular.ttf', weight: 400 },
  orbitron: { family: 'Orbitron', file: 'Orbitron-Bold.ttf', weight: 700 },
  // Blockbuster: heavy condensed heading + handwritten script line. Both are
  // single-weight files; the weight here is what the file itself carries.
  anton: { family: 'Anton', file: 'Anton-Regular.ttf', weight: 400 },
  caveatBold: { family: 'Caveat', file: 'Caveat-Bold.ttf', weight: 700 },
  // Living Inside It: the design's ultra-heavy condensed sans at 900 for the
  // two big lines, and the same family at 700 italic for the small lead-in.
  barlowBlack: { family: 'Barlow Condensed', file: 'BarlowCondensed-Black.ttf', weight: 900 },
  barlowItalic: {
    family: 'Barlow Condensed',
    file: 'BarlowCondensed-BoldItalic.ttf',
    weight: 700,
    style: 'italic',
  },
  // Living Inside It — Teal: geometric sans, Black for the lines and Bold for
  // the tracked-out caps lead-in.
  montserratBlack: { family: 'Montserrat', file: 'Montserrat-Black.ttf', weight: 900 },
  montserratBold: { family: 'Montserrat', file: 'Montserrat-Bold.ttf', weight: 700 },
  // Living Inside It — Orange: a single-weight slab serif for the lines under
  // a condensed caps lead-in.
  alfaSlab: { family: 'Alfa Slab One', file: 'AlfaSlabOne-Regular.ttf', weight: 400 },
  oswaldBold: { family: 'Oswald', file: 'Oswald-Bold.ttf', weight: 700 },
  // Living Inside It — Red: editorial serif, the lead-in in the family's
  // italic (a 400 file — the only italic Playfair the bundle carries).
  playfairBold: { family: 'Playfair Display', file: 'PlayfairDisplay-Bold.ttf', weight: 700 },
  playfairItalic: {
    family: 'Playfair Display',
    file: 'PlayfairDisplay-Italic.ttf',
    weight: 400,
    style: 'italic',
  },
  // Living Inside It — Purple: one chunky single-weight display face for every row.
  bungee: { family: 'Bungee', file: 'Bungee-Regular.ttf', weight: 400 },
  // Living — Orange and Purple lead-ins: the design's body face at 400.
  montserratRegular: { family: 'Montserrat', file: 'Montserrat-Regular.ttf', weight: 400 },
  // Living — Red lead-in: the only italic Playfair the design loads is 700.
  playfairBoldItalic: {
    family: 'Playfair Display',
    file: 'PlayfairDisplay-BoldItalic.ttf',
    weight: 700,
    style: 'italic',
  },
};

/* ---- "Living Inside It" variants ------------------------------------------
 * Five picker cards on one idea — a small lead-in over two big lines — each
 * set exactly as the design's HTML preview draws it
 * (living-caption-templates.html): every row's face, size, letter-spacing,
 * line-height, margins, colour, glow and stroke, and the block's anchoring
 * and padding. Sizes are CSS px of that preview's card (LI_CARD_W wide);
 * livingInsideLook lays the rows out with the CSS box model. Declared here,
 * ahead of the face tables, because KINETIC_LOOK_FACES reads each variant's
 * faces.
 *
 * Where the design's CSS asks for a weight or style its page never loads,
 * the face is the one Chrome actually draws: Montserrat 500 renders as 400,
 * 600 as 700, and a Montserrat italic as the upright face slanted
 * (`fakeItalic`) — so the caption matches the preview people approved. */

/**
 * How the rows arrive. 'rise' lifts each row into place in turn; 'pop' scales
 * the whole block up about its centre; 'slideLeft' pushes the rows in from
 * the right; 'sweep' fades the letters up one after another, left to right;
 * 'converge' slides the two big lines in from opposite sides.
 */
type LivingEntry = 'rise' | 'pop' | 'slideLeft' | 'sweep' | 'converge';

/** One row, in the design's own CSS terms (px of the LI_CARD_W-wide card). */
interface LivingRow {
  face: KineticFace;
  /** font-size. */
  px: number;
  /** letter-spacing in em — added after every character, spaces included. */
  trackEm: number;
  /** line-height; 'normal' = the face's ascent + descent (LI_LINE_METRICS). */
  lineHeight: number | 'normal';
  textCase: 'upper' | 'lower';
  marginTopPx?: number;
  marginBottomPx?: number;
  /** This row's own padding-left. */
  insetPx?: number;
  /** Italic asked of a face with no italic loaded: Chrome slants the upright one. */
  fakeItalic?: boolean;
  /** false = hollow (color: transparent). */
  fill: boolean;
  /** -webkit-text-stroke width in px, in the row's colour at strokeAlpha. */
  strokePx?: number;
  strokeAlpha?: number;
  /**
   * text-shadow: 0 0 blurPx — the row's colour at alpha. `match` scales the
   * ring glow to Chrome's measured brightness for this face: a blur keeps less
   * of a thin stem than a thick one, which a dilation cannot know.
   */
  glow?: { blurPx: number; alpha: number; match: number };
  /** width: 100% + text-align(-last): justify — the words spread across the padding box. */
  justify?: boolean;
}

export interface LivingVariant {
  /** Preset colours: highlightColor paints line 1, color paints line 2. */
  accent: string;
  base: string;
  /**
   * The lead-in's design colour, used while its source colour (`tint`) is
   * still the preset one; once the user picks another colour the lead-in
   * follows it (see livingLeadColor).
   */
  lead: LivingRow & { color: string; alpha: number; tint: 'accent' | 'base' };
  line1: LivingRow;
  /** `alpha`: opacity of line 2's colour (the design's rgba). */
  line2: LivingRow & { alpha: number };
  /** align-items of the design's flex column. */
  hAlign: 'left' | 'right' | 'center';
  /** justify-content of it. */
  vAlign: 'top' | 'center' | 'bottom';
  /** The text layer's padding, px. */
  pad: { top: number; right: number; bottom: number; left: number };
  entry: LivingEntry;
}

export type LivingLook = Extract<KineticLook, `living${string}`>;

export const LIVING_VARIANTS: Record<LivingLook, LivingVariant> = {
  // "it should be / LIVING / INSIDE IT": electric blue over solid white,
  // top-left, condensed at 900.
  livingBlue: {
    accent: '#38BDF8',
    base: '#FFFFFF',
    lead: {
      face: 'montserratBold',
      px: 10,
      trackEm: 0.18,
      lineHeight: 'normal',
      textCase: 'upper',
      marginBottomPx: 3,
      fakeItalic: true,
      fill: true,
      color: 'rgba(186,230,253,0.6)',
      alpha: 0.6,
      tint: 'accent',
    },
    line1: {
      face: 'barlowBlack',
      px: 52,
      trackEm: -0.01,
      lineHeight: 0.85,
      textCase: 'upper',
      fill: true,
      glow: { blurPx: 60, alpha: 0.6, match: 0.71 },
    },
    line2: {
      face: 'barlowBlack',
      px: 46,
      trackEm: -0.01,
      lineHeight: 0.9,
      textCase: 'upper',
      fill: true,
      alpha: 1,
    },
    hAlign: 'left',
    vAlign: 'top',
    pad: { top: 24, right: 16, bottom: 0, left: 16 },
    entry: 'rise',
  },
  // "this is the / NEW / STANDARD": centred Montserrat, a glowing teal word
  // over a white line thickened by its own stroke.
  livingTeal: {
    accent: '#2DD4BF',
    base: '#FFFFFF',
    lead: {
      face: 'montserratBold',
      px: 10,
      trackEm: 0.22,
      lineHeight: 'normal',
      textCase: 'upper',
      marginBottomPx: 5,
      fill: true,
      color: 'rgba(167,243,208,0.55)',
      alpha: 0.55,
      tint: 'accent',
    },
    line1: {
      face: 'montserratBlack',
      px: 24,
      trackEm: 0.08,
      lineHeight: 1,
      textCase: 'upper',
      fill: true,
      glow: { blurPx: 40, alpha: 0.5, match: 0.64 },
    },
    line2: {
      face: 'montserratBlack',
      px: 40,
      trackEm: 0.06,
      lineHeight: 1,
      textCase: 'upper',
      fill: true,
      strokePx: 1.5,
      strokeAlpha: 0.9,
      alpha: 1,
    },
    hAlign: 'center',
    vAlign: 'center',
    pad: { top: 0, right: 12, bottom: 0, left: 12 },
    entry: 'pop',
  },
  // "and then it / ALL / FELL APART": right-aligned Oswald, top-right, a
  // glowing orange word over near-white.
  livingOrange: {
    accent: '#F97316',
    base: '#F0F0F0',
    lead: {
      face: 'montserratRegular',
      px: 13,
      trackEm: 0.18,
      lineHeight: 1,
      textCase: 'upper',
      fill: true,
      color: 'rgba(255,200,120,0.85)',
      alpha: 0.85,
      tint: 'accent',
    },
    line1: {
      face: 'oswaldBold',
      px: 46,
      trackEm: 0.02,
      lineHeight: 0.88,
      textCase: 'upper',
      fill: true,
      glow: { blurPx: 60, alpha: 0.4, match: 0.58 },
    },
    line2: {
      face: 'oswaldBold',
      px: 42,
      trackEm: 0.02,
      lineHeight: 0.9,
      textCase: 'upper',
      fill: true,
      alpha: 0.95,
    },
    hAlign: 'right',
    vAlign: 'top',
    pad: { top: 22, right: 18, bottom: 0, left: 18 },
    entry: 'slideLeft',
  },
  // "the story / BEHIND / THE STORY": an italic whisper over a huge justified
  // red serif word and a tracked Bebas closer, centred vertically.
  livingRed: {
    accent: '#DC2626',
    base: '#F5F5F5',
    lead: {
      face: 'playfairBoldItalic',
      px: 11,
      trackEm: 0.12,
      lineHeight: 'normal',
      textCase: 'lower',
      marginBottomPx: 3,
      insetPx: 2,
      fill: true,
      color: 'rgba(255,255,255,0.55)',
      alpha: 0.55,
      tint: 'base',
    },
    line1: {
      face: 'playfairBold',
      px: 58,
      trackEm: -0.01,
      lineHeight: 0.85,
      textCase: 'upper',
      fill: true,
      glow: { blurPx: 80, alpha: 0.5, match: 0.53 },
      justify: true,
    },
    line2: {
      face: 'bebasNeue',
      px: 36,
      trackEm: 0.12,
      lineHeight: 'normal',
      textCase: 'upper',
      marginTopPx: 2,
      fill: true,
      alpha: 0.97,
    },
    hAlign: 'left',
    vAlign: 'center',
    pad: { top: 0, right: 16, bottom: 0, left: 16 },
    entry: 'sweep',
  },
  // "nothing is / WHAT / IT SEEMS": Anton caps anchored bottom-left, a hollow
  // purple line over a solid lilac one.
  livingPurple: {
    accent: '#A855F7',
    base: '#D8B4FE',
    lead: {
      face: 'montserratRegular',
      px: 10,
      trackEm: 0.2,
      lineHeight: 'normal',
      textCase: 'upper',
      marginBottomPx: 4,
      fill: true,
      color: 'rgba(200,180,255,0.5)',
      alpha: 0.5,
      tint: 'accent',
    },
    line1: {
      face: 'anton',
      px: 42,
      trackEm: 0.04,
      lineHeight: 0.88,
      textCase: 'upper',
      fill: false,
      strokePx: 2,
      strokeAlpha: 1,
    },
    line2: {
      face: 'anton',
      px: 42,
      trackEm: 0.04,
      lineHeight: 0.88,
      textCase: 'upper',
      fill: true,
      alpha: 1,
    },
    hAlign: 'left',
    vAlign: 'bottom',
    pad: { top: 0, right: 14, bottom: 28, left: 14 },
    entry: 'converge',
  },
};

/** Faces a Living variant draws besides line 1's (its primary face). */
function livingExtraFaces(v: LivingVariant): KineticFace[] {
  return [v.lead.face, v.line2.face].filter((f, i, all) => f !== v.line1.face && all.indexOf(f) === i);
}

/**
 * The PRIMARY face of each look — the one its scene reports and the one every
 * letter uses unless the letter names its own `face` (blockbuster's script
 * line does: it is Caveat on top of an Anton heading).
 */
export const KINETIC_LOOK_FACES: Record<KineticLook, KineticFace> = {
  scatteredStack: 'bebasNeue',
  neonDisappear: 'bebasNeue',
  letterChaos: 'bebasNeue',
  impactSlam: 'bebasNeue',
  glitchSplit: 'orbitron',
  blockbuster: 'anton',
  livingBlue: LIVING_VARIANTS.livingBlue.line1.face,
  livingTeal: LIVING_VARIANTS.livingTeal.line1.face,
  livingOrange: LIVING_VARIANTS.livingOrange.line1.face,
  livingRed: LIVING_VARIANTS.livingRed.line1.face,
  livingPurple: LIVING_VARIANTS.livingPurple.line1.face,
};

/** Faces a look draws beyond its primary one. */
const KINETIC_LOOK_EXTRA_FACES: Partial<Record<KineticLook, readonly KineticFace[]>> = {
  blockbuster: ['caveatBold'],
  livingBlue: livingExtraFaces(LIVING_VARIANTS.livingBlue),
  livingTeal: livingExtraFaces(LIVING_VARIANTS.livingTeal),
  livingOrange: livingExtraFaces(LIVING_VARIANTS.livingOrange),
  livingRed: livingExtraFaces(LIVING_VARIANTS.livingRed),
  livingPurple: livingExtraFaces(LIVING_VARIANTS.livingPurple),
};

/** Every face a template can draw — what a renderer must have loaded up front. */
export function facesForTemplate(template: KineticTemplateId): KineticFace[] {
  const out: KineticFace[] = [];
  for (const look of KINETIC_TEMPLATE_LOOKS[template]) {
    for (const face of [KINETIC_LOOK_FACES[look], ...(KINETIC_LOOK_EXTRA_FACES[look] ?? [])]) {
      if (!out.includes(face)) out.push(face);
    }
  }
  return out;
}

/**
 * The style.fontSize this template's looks are authored against — the value the
 * Anime Edit preset applies. The Text panel's size slider is interpreted
 * relative to it (fontSize / 64), so 64 = as designed, 96 = 1.5x, 32 = 0.5x.
 */
export const KINETIC_BASE_FONT_SIZE = 64;

/**
 * Fraction of the frame kept clear on each edge for paint that extends past the
 * glyph box: drop shadows, outline strokes, the neon halo, the chroma split.
 * boundsOf() measures glyphs, not ink, so without this a composition scaled to
 * fill the frame gets its last row clipped.
 */
export const KINETIC_PAINT_BLEED = 0.025;

/**
 * User-tunable knobs for a look, persisted as `style.kinetic` and passed to
 * build() on both sides. Only Blockbuster reads them today; the Anime Edit
 * looks ignore them. Every field is optional — a missing one means "as
 * authored" (KINETIC_PARAM_DEFAULTS), so old projects render unchanged.
 */
export interface KineticParams {
  /** Heading glow strength multiplier (0 = none, 1 = as designed, 2 = double). */
  glow?: number;
  /** Extra heading letter spacing in em of the heading size (0.03 = 3%). */
  letterSpacing?: number;
  /** Heading tilt in degrees (negative = anticlockwise). */
  tilt?: number;
  /** Script line size multiplier relative to the heading (1 = as designed). */
  scriptScale?: number;
}

export const KINETIC_PARAM_DEFAULTS: Required<KineticParams> = {
  glow: 1,
  letterSpacing: 0.03,
  tilt: -2,
  scriptScale: 1,
};

function resolveParams(p?: KineticParams): Required<KineticParams> {
  const n = (v: number | undefined, d: number) =>
    typeof v === 'number' && Number.isFinite(v) ? v : d;
  return {
    glow: n(p?.glow, KINETIC_PARAM_DEFAULTS.glow),
    letterSpacing: n(p?.letterSpacing, KINETIC_PARAM_DEFAULTS.letterSpacing),
    tilt: n(p?.tilt, KINETIC_PARAM_DEFAULTS.tilt),
    scriptScale: n(p?.scriptScale, KINETIC_PARAM_DEFAULTS.scriptScale),
  };
}

/* ---- Blockbuster constants ------------------------------------------------
 * The look was designed against a 9:16 frame, where sizes are quoted as
 * fractions of frame HEIGHT. The engine's nSize is a fraction of frame WIDTH,
 * so build() converts with BB_REF_ASPECT — deliberately the DESIGN aspect and
 * not the live one. Keying off the live aspect instead made the whole template
 * shrink to a third of its weight on the 16:9 and 1:1 canvases the editor also
 * offers (0.078 of 720px is 56px of type on a 1280-wide frame). Every other
 * look in this engine sizes as a fraction of width for exactly that reason —
 * see the note on caption wrapping in export.service.ts. */

/** The frame the look was authored on (9:16), as H/W. */
const BB_REF_ASPECT = 16 / 9;
/** Heading font size, fraction of the design frame's height. */
const BB_HEADING_SIZE = 0.078;
/** Script font size, fraction of the design frame's height. */
const BB_SCRIPT_SIZE = 0.125;
/** Baseline of the heading's first line, fraction of frame height. */
const BB_HEADING_Y = 0.47;
/** Heading baseline-to-baseline, in em. The spec says 1.0, but that is a
 *  single-line spec: real captions wrap, and at 1.0 Anton's caps plus the hard
 *  shadow of the line above literally touch the line below. The Anime Edit
 *  looks use 1.12-1.2 for the same reason. */
const BB_LINE_HEIGHT = 1.12;
/** Script baseline below the heading's LAST baseline, in em OF THE SCRIPT SIZE
 *  (0.115/0.125 at the authored size). Em-relative rather than a fixed frame
 *  fraction so the `scriptScale` knob moves the line clear of the heading
 *  instead of driving it through it. */
const BB_SCRIPT_GAP_EM = 0.92;
/** Wrap width for the heading, fraction of frame width. */
const BB_MAX_WIDTH = 0.9;
/** Anton's mean glyph advance in em — converts the spec's additive letter
 *  spacing (a fraction of font size added per glyph) into the engine's
 *  multiplicative tracking. */
const BB_ANTON_MEAN_ADVANCE = 0.45;
/** Hard shadow offset of the heading, in em (spec dx 0.035 / dy 0.045). */
const BB_SHADOW_DX = 0.035;
const BB_SHADOW_DY = 0.045;
/** How far toward black the heading colour is mixed for its hard shadow
 *  (#FF1F1F -> ~#6E0000, the spec's shadow colour). */
const BB_SHADOW_DARKEN = 0.57;
/** Heading glow radius in em at glow strength 1 (spec blur 0.45em). */
const BB_GLOW_EM = 0.45;
/** Entry timings: spec frames at 30fps (6f pop-in, 8f slide-up, 4f fade-out). */
const BB_POP_MS = 200;
const BB_SLIDE_MS = 267;
const BB_FADE_MS = 133;
/** Script line's slide-up distance, in em of its own size (spec 0.5). */
const BB_SLIDE_EM = 0.5;
/** Script line's soft shadow offset in em (spec dy 0.03, blur 0.2). */
const BB_SCRIPT_SHADOW_DY = 0.03;
/** Letter slot ids inside a blockbuster caption. */
const BB_SLOT_HEADING = 0;
const BB_SLOT_SCRIPT = 1;

/* ---- "Living Inside It" constants -----------------------------------------
 * Three rows — a small lead-in, then two large lines — laid out the way the
 * design's HTML preview lays them out (see LIVING_VARIANTS). */

/**
 * Width, in CSS px, of the preview every design size is quoted against: one
 * card of the design page's three-column grid at desktop width,
 * (1152 − 2 × 20) / 3, less the card's two 1px borders.
 * A design px becomes a fraction of frame WIDTH through it — the convention
 * every look here uses — so a caption on 1080-wide video is the card scaled up.
 */
const LI_CARD_W = 1112 / 3 - 2;
/**
 * Line metrics of the faces the Living rows use, in em: the ascent and descent
 * CSS builds a line box from, as Chrome on Windows reads them (OS/2 typo
 * metrics when USE_TYPO_METRICS is set, else win). Hard-coded, not measured,
 * so every renderer places the baselines identically. Every lineGap is 0.
 */
const LI_LINE_METRICS: Partial<Record<KineticFace, { ascent: number; descent: number }>> = {
  montserratRegular: { ascent: 0.968, descent: 0.251 },
  montserratBold: { ascent: 0.968, descent: 0.251 },
  montserratBlack: { ascent: 0.968, descent: 0.251 },
  oswaldBold: { ascent: 1.193, descent: 0.289 },
  playfairBold: { ascent: 1.082, descent: 0.251 },
  playfairBoldItalic: { ascent: 1.082, descent: 0.251 },
  bebasNeue: { ascent: 0.95, descent: 0.35 },
  anton: { ascent: 1.1763, descent: 0.3291 },
  barlowBlack: { ascent: 1, descent: 0.2 },
};
/** Chrome's synthetic oblique: the upright glyph skewed by 1/4 (Skia's fake italic). */
const LI_FAKE_ITALIC_SKEW = 0.25;
/**
 * text-shadow glow, drawn as concentric strokes — never shadowBlur (see the
 * neonDisappear note). CSS blurs the glyph with a gaussian of σ = blur / 2;
 * each ring dilates the glyph by `r`σ and the rings' stacked opacities follow
 * that gaussian's falloff, widest first. LI_GLOW_GAIN is the share of the
 * shadow colour a blurred glyph edge keeps (a stem spread over a wide
 * gaussian), and each row's `glow.match` corrects it per face. Both were
 * fitted to Chrome's own render of the design: glow brightness binned by
 * distance from the text, design vs engine, at 3x.
 */
const LI_GLOW_RINGS = [
  { r: 2.0, a: 0.1 },
  { r: 1.5, a: 0.18 },
  { r: 1.2, a: 0.17 },
  { r: 0.9, a: 0.11 },
  { r: 0.6, a: 0.14 },
  { r: 0.35, a: 0.12 },
  { r: 0.15, a: 0.18 },
];
const LI_GLOW_GAIN = 0.12;
/** The design's padding is the margin: the generic safe area would shove a
 *  top- or bottom-anchored block off its place. Oversized blocks still shrink. */
const LI_SAFE_AREA = { x: 0, y: 0 };
const LI_FADE_MS = 133;
/** 'rise': the lead-in fades, then each big line rises into place, staggered. */
const LI_LEAD_MS = 150;
const LI_RISE_MS = 250;
const LI_STAGGER_MS = 80;
/** How far each big line rises, in em of its own size. */
const LI_RISE_EM = 0.35;
/** 'pop': the block scales from LI_POP_FROM to 1; the lead-in follows behind. */
const LI_POP_MS = 280;
const LI_POP_LEAD_DELAY_MS = 120;
const LI_POP_FROM = 0.82;
/** 'slideLeft': rows push in from the right, staggered; travel in em. */
const LI_SLIDE_MS = 280;
const LI_SLIDE_STAGGER_MS = 90;
const LI_SLIDE_EM = 0.6;
const LI_SLIDE_LEAD_EM = 0.25;
/** 'sweep': each letter fades up in turn, left to right, row after row. */
const LI_SWEEP_MS = 220;
const LI_SWEEP_ROW_MS = 140;
const LI_SWEEP_LETTER_MS = 22;
const LI_SWEEP_RISE_EM = 0.12;
/** 'converge': the big lines slide in from opposite sides; travel in em. */
const LI_CONVERGE_MS = 260;
const LI_CONVERGE_ROW_MS = 70;
const LI_CONVERGE_EM = 0.5;

/** Entry length of one letter AFTER its own delay (the scene adds the max delay). */
const LI_ENTRY_MS: Record<LivingEntry, number> = {
  rise: LI_RISE_MS,
  pop: LI_POP_MS,
  slideLeft: LI_SLIDE_MS,
  sweep: LI_SWEEP_MS,
  converge: LI_CONVERGE_MS,
};

/** Lead-in budget: at most this many words, within this many characters. */
const LI_LEAD_MAX_WORDS = 3;
const LI_LEAD_MAX_CHARS = 12;

const LI_SLOT_LEAD = 0;
const LI_SLOT_LINE1 = 1;
const LI_SLOT_LINE2 = 2;

/**
 * Split one caption across the three lines, keeping every word visible.
 *
 * The design's own copy is "it should be" / "LIVING" / "INSIDE IT" — a short
 * lead-in and two big lines — so short captions drop the lead-in rather than
 * starving the lines that carry the look.
 */
export function splitLivingWords(words: string[]): {
  lead: string[];
  line1: string[];
  line2: string[];
} {
  const n = words.length;
  if (n === 0) return { lead: [], line1: [], line2: [] };
  if (n === 1) return { lead: [], line1: words, line2: [] };
  if (n === 2) return { lead: [], line1: [words[0]], line2: [words[1]] };

  // The lead-in takes the leading SHORT words — up to three, within a
  // character budget. That is what makes the design's own line ("it should
  // be" / LIVING / INSIDE IT) fall out naturally: three tiny function words
  // set the phrase up, and the words with weight get the big type. A fixed
  // count would break it at "it should | BE LIVING | INSIDE IT".
  let lead = 0;
  let chars = 0;
  while (lead < LI_LEAD_MAX_WORDS && lead < n - 2) {
    const next = words[lead].length;
    if (chars + next > LI_LEAD_MAX_CHARS) break;
    chars += next;
    lead += 1;
  }
  if (lead === 0) lead = 1; // n >= 3 always keeps a lead-in

  const rest = words.slice(lead);
  // floor, not ceil: with three words left the design puts ONE on the first
  // big line and two on the second (LIVING / INSIDE IT), not the reverse.
  const half = Math.max(1, Math.floor(rest.length / 2));
  return { lead: words.slice(0, lead), line1: rest.slice(0, half), line2: rest.slice(half) };
}

/** Vowel-ish letters eligible for the auto-accent in scatteredStack. */
const ACCENT_LETTERS = new Set(['s', 'e', 'a', 'o', 'i', 'n']);

/** Dim grey used by letterChaos for its recessive letters. */
const DIM_COLOR = '#8c8c8c';
/** impactSlam's last-letter punch. Intrinsic to the look, like KINETIC_ACCENT. */
const SLAM_ACCENT = '#f97316';
/** glitchSplit's RGB split pair. Intrinsic to the look. */
const GLITCH_CYAN = '#00f0ff';
const GLITCH_RED = '#e11d48';

/**
 * neonDisappear's bloom, widest and faintest first. `width` multiplies the
 * letter's own size × its current glow, so the halo scales with resolution.
 * Alphas ramp steeply near the glyph to mimic a gaussian falloff.
 */
const NEON_HALO = [
  { width: 2.4, alpha: 0.07 },
  { width: 1.8, alpha: 0.1 },
  { width: 1.3, alpha: 0.14 },
  { width: 0.9, alpha: 0.2 },
  { width: 0.55, alpha: 0.3 },
  { width: 0.28, alpha: 0.5 },
];

const DEG = Math.PI / 180;
/** Metrics are measured at this size, then stored as scale-free ratios. */
const REF = 1000;

/**
 * Effects are sampled on a fixed clock so a 144Hz browser and a 30fps export
 * produce the same shake and the same glitch pattern.
 */
const SHAKE_HZ = 24;
const GLITCH_HZ = 15;

/* ------------------------------------------------------------------------ *
 * 1. Determinism
 * ------------------------------------------------------------------------ */

/** mulberry32 — small, fast, and identical in every JS runtime. */
export function mulberry32(a: number): () => number {
  let s = a >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Rng {
  next: () => number;
  range: (lo: number, hi: number) => number;
  chance: (p: number) => boolean;
}

export function makeRng(seed: number): Rng {
  const next = mulberry32(seed);
  return {
    next,
    range: (lo, hi) => lo + next() * (hi - lo),
    chance: (p) => next() < p,
  };
}

/** Stable hash noise in [-1, 1]. Pure: same inputs, same output, no state. */
export function noise(i: number, step: number): number {
  let h = (Math.imul(i + 1, 0x27d4eb2d) ^ Math.imul(step + 1, 0x165667b1)) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2545f491) >>> 0;
  h ^= h >>> 13;
  return ((h >>> 0) / 4294967296) * 2 - 1;
}

/** Noise quantised to a fixed rate — the reason effects are fps-independent. */
function steppedNoise(i: number, timeMs: number, hz: number): number {
  return noise(i, Math.floor((timeMs * hz) / 1000));
}

export function hashString(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/**
 * The seed for one caption. Derived from the caption's own content, so it is
 * identical in the preview and in the export with nothing to persist, and a
 * re-export of an unedited project reproduces the same scatter forever.
 */
export function seedForCaption(template: string, text: string, sequence: number): number {
  return hashString(`${KINETIC_ENGINE_VERSION}|${template}|${sequence}|${text}`);
}

/**
 * Which look this caption gets. This is the "editor" in the template — the
 * judgement a human would make per line, encoded.
 *
 * Two rules, both learned from how these looks actually read on footage:
 *
 *  - SHORT lines get the punchy treatments. One or two words have room to be
 *    thrown around the frame; `impactSlam` and `letterChaos` hit hardest there.
 *  - LONG lines get the single-baseline treatments. Scattering eight words
 *    across the frame is unreadable, so `neonDisappear` and `glitchSplit`,
 *    which keep one centred line, take over.
 *
 * Then: never the same look twice in a row. Repetition is what makes an edit
 * read as "a filter was applied" rather than "someone made this".
 */
const LOOKS_SHORT: readonly KineticLook[] = ['impactSlam', 'letterChaos'];
const LOOKS_LONG: readonly KineticLook[] = ['neonDisappear', 'glitchSplit'];
const LOOKS_MID: readonly KineticLook[] = [
  'scatteredStack',
  'scatteredStack', // weighted: the signature look of the set
  'impactSlam',
  'letterChaos',
  'glitchSplit',
];

/** How many recent looks to avoid repeating. */
const KINETIC_AVOID_WINDOW = 2;

export function pickKineticLook(
  wordCount: number,
  rng: Rng,
  recent: readonly KineticLook[],
): KineticLook {
  const bucket = wordCount <= 2 ? LOOKS_SHORT : wordCount >= 6 ? LOOKS_LONG : LOOKS_MID;
  const avoid = new Set(recent.slice(-KINETIC_AVOID_WINDOW));

  // Filter rather than re-roll: a two-entry bucket would otherwise keep landing
  // on the excluded look. Duplicates in the bucket survive filtering, so the
  // scatteredStack weighting is preserved.
  let candidates = bucket.filter((l) => !avoid.has(l));
  if (!candidates.length) {
    // Whole bucket was recently used (short buckets are only two deep) — settle
    // for merely not repeating the immediately previous look.
    const last = recent[recent.length - 1];
    candidates = bucket.filter((l) => l !== last);
  }
  if (!candidates.length) candidates = [...bucket];

  return candidates[Math.floor(rng.next() * candidates.length)] ?? candidates[0];
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/* ------------------------------------------------------------------------ *
 * 2. Easing — the exact curves from the spec. Do not substitute.
 * ------------------------------------------------------------------------ */

export const EASE = {
  linear: (t: number) => t,
  cubicOut: (t: number) => 1 - Math.pow(1 - t, 3),
  quartOut: (t: number) => 1 - Math.pow(1 - t, 4),
  spring: (t: number) => {
    const c4 = (2 * Math.PI) / 3;
    return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -8 * t) * Math.sin((t * 8 - 0.75) * c4) + 1;
  },
  overshoot: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
};

/* ------------------------------------------------------------------------ *
 * 3. Font metrics
 *
 * Structural context type: satisfied by both the browser's
 * CanvasRenderingContext2D and @napi-rs/canvas's SKRSContext2D, so the engine
 * needs neither the DOM lib nor node types.
 * ------------------------------------------------------------------------ */

export interface TextCtx {
  font: string;
  textAlign: string;
  textBaseline: string;
  lineJoin: string;
  miterLimit: number;
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  globalAlpha: number;
  shadowColor: string;
  shadowBlur: number;
  globalCompositeOperation: string;
  measureText(text: string): {
    width: number;
    actualBoundingBoxAscent?: number;
    actualBoundingBoxDescent?: number;
  };
  fillText(text: string, x: number, y: number): void;
  strokeText(text: string, x: number, y: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(a: number): void;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  setLineDash(segments: number[]): void;
}

/** Applied identically when measuring and when drawing, or they disagree. */
function applyTextContext(ctx: TextCtx, fontSpec: string): void {
  ctx.font = fontSpec;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  // Chrome-only: disables hinted advance snapping so metrics stay continuous
  // and identical at every size. Ignored where unsupported.
  try {
    (ctx as unknown as { textRendering: string }).textRendering = 'geometricPrecision';
  } catch {
    /* not supported here */
  }
}

export interface Metrics {
  fontFamily: string;
  fontWeight: number;
  advance(ch: string): number;
  vertical(): { ascent: number; descent: number };
  runWidth(text: string, tracking?: number): number;
  fingerprint(): number;
}

/**
 * Measure each glyph once at REF px and cache the ratio. Ratios are scale-free,
 * so one table drives a 360px preview and a 2160px export.
 *
 * Build this only AFTER the font has loaded, or you cache Impact's metrics and
 * lay out Bebas Neue with them — the "letters overlap / drift apart" bug.
 */
export function createMetrics(
  ctx: TextCtx,
  fontFamily: string,
  fontWeight: number,
  fontStyle?: string,
): Metrics {
  // Style first — that is the order the CSS font shorthand requires, and an
  // italic measured as upright reports the wrong advances.
  const spec = `${fontStyle ? `${fontStyle} ` : ''}${fontWeight} ${REF}px ${fontFamily}`;
  const cache = new Map<string, number>();
  let vert: { ascent: number; descent: number } | null = null;

  const measure = (ch: string) => {
    applyTextContext(ctx, spec);
    return ctx.measureText(ch);
  };

  const api: Metrics = {
    fontFamily,
    fontWeight,

    /** Horizontal advance of one character, as a multiple of font size. */
    advance(ch) {
      let v = cache.get(ch);
      if (v === undefined) {
        v = measure(ch).width / REF;
        cache.set(ch, v);
      }
      return v;
    },

    /** Ascent/descent as multiples of font size — for bounds and hit-tests. */
    vertical() {
      if (!vert) {
        const m = measure('HXO');
        vert = {
          ascent: (m.actualBoundingBoxAscent || REF * 0.72) / REF,
          descent: (m.actualBoundingBoxDescent || REF * 0.06) / REF,
        };
      }
      return vert;
    },

    /** Width of a string at size 1, including tracking. */
    runWidth(text, tracking = 1) {
      let w = 0;
      for (const ch of text) w += api.advance(ch) * tracking;
      return w;
    },

    /**
     * Cheap sanity signal: did the intended font actually load? The preview and
     * the export each compute one; if they differ they are using different
     * fonts and the burn-in will not match.
     */
    fingerprint() {
      return Math.round(api.runWidth('HAMBURGEFONTSIV') * 10000);
    },
  };

  return api;
}

/* ------------------------------------------------------------------------ *
 * 4. Letter records
 *
 * Persisted-shaped fields have plain names and are normalised. Transient
 * per-frame fields are prefixed with _ and are never stored.
 * ------------------------------------------------------------------------ */

export interface KineticLetter {
  ch: string;
  /** Baseline-left X, fraction of frame width. */
  nx: number;
  /** Baseline Y, fraction of frame height. */
  ny: number;
  /** Font size, fraction of frame width. */
  nSize: number;
  rotation: number;
  color: string;
  wordIndex: number;
  letterIndex: number;
  delay: number;
  phase: number;
  flyFromX: number;
  flyFromY: number;
  slamFrom: number;
  /**
   * Horizontal advance of this glyph in em, INCLUDING the look's tracking —
   * measured with the face the letter is actually drawn in, so bounds and
   * centring stay exact even when one caption mixes faces.
   */
  adv: number;
  /** Ascent/descent in em for THIS letter's face; omitted = the look's primary face. */
  ascent?: number;
  descent?: number;
  /** Face override for this letter; omitted = the look's primary face. */
  face?: KineticFace;
  /** Resolved by buildKineticComposition from `face` — what the renderer sets on ctx.font. */
  fontFamily: string;
  fontWeight: number;
  /** '' for upright, 'italic' for an oblique face. */
  fontStyle: string;
  /** Which slot of a multi-slot look this letter belongs to (blockbuster: 0 heading / 1 script). */
  slot: number;
  /** Point a block-scale entry animates about (normalised). Defaults to the letter's own origin. */
  pivotX: number;
  pivotY: number;
  /** Persistent glow strength for looks whose glow is a user knob (blockbuster heading). */
  glow: number;
  /** Persistent hard-shadow colour for looks that derive it from the accent. */
  shadowColor: string;
  /** Stable index for noise — assigned after build. */
  _i: number;
  _x: number;
  _y: number;
  _scale: number;
  _color: string;
  _alpha: number;
  _glow: number;
  _chromaR: number;
  _chromaB: number;
}

interface MakeLetterInput {
  ch: string;
  nx: number;
  ny: number;
  nSize: number;
  /** Required so no look can forget it — see KineticLetter.adv. */
  adv: number;
  ascent?: number;
  descent?: number;
  face?: KineticFace;
  rotation?: number;
  color: string;
  wordIndex: number;
  letterIndex: number;
  delay?: number;
  phase?: number;
  flyFromX?: number;
  flyFromY?: number;
  slamFrom?: number;
  slot?: number;
  pivotX?: number;
  pivotY?: number;
  glow?: number;
  shadowColor?: string;
}

function makeLetter(o: MakeLetterInput): KineticLetter {
  return {
    ch: o.ch,
    nx: o.nx,
    ny: o.ny,
    nSize: o.nSize,
    rotation: o.rotation || 0,
    color: o.color,
    wordIndex: o.wordIndex,
    letterIndex: o.letterIndex,
    delay: o.delay || 0,
    phase: o.phase || 0,
    flyFromX: o.flyFromX ?? 0,
    flyFromY: o.flyFromY ?? 0,
    slamFrom: o.slamFrom ?? 0,
    adv: o.adv,
    ascent: o.ascent,
    descent: o.descent,
    face: o.face,
    fontFamily: '',
    fontWeight: 400,
    fontStyle: '',
    slot: o.slot ?? 0,
    pivotX: o.pivotX ?? o.nx,
    pivotY: o.pivotY ?? o.ny,
    glow: o.glow ?? 0,
    shadowColor: o.shadowColor ?? '#000000',
    _i: 0,
    _x: o.nx,
    _y: o.ny,
    _scale: 0,
    _color: o.color,
    _alpha: 1,
    _glow: 0,
    _chromaR: 0,
    _chromaB: 0,
  };
}

/* ------------------------------------------------------------------------ *
 * 5. Layout helpers
 * ------------------------------------------------------------------------ */

/** Greedy wrap, so a long phrase becomes lines instead of unreadable 6px type. */
function wrapWords(
  words: string[],
  metrics: Metrics,
  tracking: number,
  targetWidth: number,
  nSizeGuess: number,
): string[][] {
  const lines: string[][] = [];
  let line: string[] = [];
  let w = 0;
  const spaceW = metrics.advance(' ') * tracking * nSizeGuess;
  for (const word of words) {
    const ww = metrics.runWidth(word, tracking) * nSizeGuess;
    if (line.length && w + spaceW + ww > targetWidth) {
      lines.push(line);
      line = [word];
      w = ww;
    } else {
      w += (line.length ? spaceW : 0) + ww;
      line.push(word);
    }
  }
  if (line.length) lines.push(line);
  return lines;
}

interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  w: number;
  h: number;
}

/**
 * Axis-aligned bounds of a letter set, in normalised frame units. `metrics` is
 * the look's primary face — only its vertical extents are used, and only for
 * letters that did not record their own (a look mixing faces records them).
 */
function boundsOf(letters: KineticLetter[], metrics: Metrics, aspect: number): Bounds {
  if (!letters.length) return { x0: 0, y0: 0, x1: 0, y1: 0, w: 0, h: 0 };
  const v = metrics.vertical();
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const L of letters) {
    const w = L.adv * L.nSize;
    const up = ((L.ascent ?? v.ascent) * L.nSize) / aspect;
    const down = ((L.descent ?? v.descent) * L.nSize) / aspect;
    // Pad for rotation without doing full corner maths.
    const pad = Math.abs(Math.sin(L.rotation * DEG)) * up * 0.6;
    x0 = Math.min(x0, L.nx - pad);
    x1 = Math.max(x1, L.nx + w + pad);
    y0 = Math.min(y0, L.ny - up - pad);
    y1 = Math.max(y1, L.ny + down + pad);
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

/**
 * Shrink and recentre a composition so it always sits inside the safe area.
 * Without this, long transcribed words run off frame — which reads as "broken"
 * to a user far more often than any animation bug does.
 */
/**
 * Scale a whole composition about its own centre.
 *
 * Sizing this way — rather than passing a multiplier into each look's build() —
 * keeps every look's internal geometry exactly as authored: letter advances,
 * line wraps and the scatter all scale together, so bigger text never overlaps
 * itself. It is also what fitToSafeArea does, so the two compose cleanly.
 */
function scaleAbout(
  letters: KineticLetter[],
  metrics: Metrics,
  aspect: number,
  k: number,
): void {
  if (!letters.length || k === 1) return;
  const b = boundsOf(letters, metrics, aspect);
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  for (const L of letters) {
    L.nx = cx + (L.nx - cx) * k;
    L.ny = cy + (L.ny - cy) * k;
    L.pivotX = cx + (L.pivotX - cx) * k;
    L.pivotY = cy + (L.pivotY - cy) * k;
    L.nSize *= k;
  }
}

function fitToSafeArea(
  letters: KineticLetter[],
  metrics: Metrics,
  aspect: number,
  safe: { x: number; y: number },
  /**
   * How far the user asked to scale up. The available box grows with it (never
   * past the full frame), because otherwise a size increase would be undone
   * immediately: default compositions already fill the safe area, so the fit
   * would shrink them straight back and the size control would do nothing.
   */
  requestedScale = 1,
): KineticLetter[] {
  if (!letters.length) return letters;
  const b = boundsOf(letters, metrics, aspect);
  const grow = Math.max(1, requestedScale);
  // Never let a grown composition reach the very frame edge. boundsOf measures
  // the GLYPH box, but every look's paint() draws past it — impactSlam's drop
  // shadow and outline stroke, neonDisappear's halo, glitchSplit's chroma
  // split. Filling the frame exactly therefore clips that ink (it cut the
  // bottom off the last row at max size). This margin is the bleed allowance.
  const edge = 1 - KINETIC_PAINT_BLEED * 2;
  const availW = Math.min(edge, (1 - safe.x * 2) * grow);
  const availH = Math.min(edge, (1 - safe.y * 2) * grow);
  const k = Math.min(1, availW / Math.max(b.w, 1e-6), availH / Math.max(b.h, 1e-6));

  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  for (const L of letters) {
    L.nx = cx + (L.nx - cx) * k;
    L.ny = cy + (L.ny - cy) * k;
    L.pivotX = cx + (L.pivotX - cx) * k;
    L.pivotY = cy + (L.pivotY - cy) * k;
    L.nSize *= k;
  }

  // Re-measure and nudge fully inside the margins. A composition the user grew
  // past the safe area gets a correspondingly smaller margin, so it centres
  // instead of being shoved against one edge with the other side off-frame.
  const b2 = boundsOf(letters, metrics, aspect);
  const mx = Math.max(0, Math.min(safe.x, (1 - b2.w) / 2));
  const my = Math.max(0, Math.min(safe.y, (1 - b2.h) / 2));
  let dx = 0;
  let dy = 0;
  if (b2.x0 < mx) dx = mx - b2.x0;
  else if (b2.x1 > 1 - mx) dx = 1 - mx - b2.x1;
  if (b2.y0 < my) dy = my - b2.y0;
  else if (b2.y1 > 1 - my) dy = 1 - my - b2.y1;
  if (dx || dy) for (const L of letters) { L.nx += dx; L.ny += dy; L.pivotX += dx; L.pivotY += dy; }

  return letters;
}

/* ------------------------------------------------------------------------ *
 * 6. Templates
 *
 * build()   -> normalised letters, deterministic given the seed
 * animate() -> pure function of time, writes only _-prefixed fields
 * paint()   -> draws one letter; all offsets in em so they scale correctly
 * ------------------------------------------------------------------------ */

export interface BuildArgs {
  /** The caption's words — uppercased unless the look sets `uppercase: false`. */
  words: string[];
  rng: Rng;
  /** Metrics for the look's PRIMARY face (KINETIC_LOOK_FACES). */
  metrics: Metrics;
  /** Metrics for any face — a look that mixes faces (blockbuster) uses this. */
  metricsFor: (face: KineticFace) => Metrics;
  /** style.highlightColor — the accent. */
  accentColor: string;
  /** style.color — the base/plain letter colour. */
  baseColor: string;
  /** Indices of words the emphasis agent marked 'hero'. */
  heroWords: Set<number>;
  /** frameHeight / frameWidth. */
  aspect: number;
  /** User knobs (style.kinetic) with defaults filled in. */
  params: Required<KineticParams>;
}

interface KineticTemplateDef {
  label: string;
  tracking: number;
  entryMs: number;
  shakeMs?: number;
  /** Uppercase the caption before build(). Default true — the Anime Edit looks. */
  uppercase?: boolean;
  /** Scene lifetime overrides; defaults are KINETIC_HOLD_MS / KINETIC_EXIT_MS. */
  holdMs?: number;
  exitMs?: number;
  /** When true the exit fade is the LAST exitMs of the caption's own window
   *  instead of running after it — so two consecutive captions never overlap. */
  exitInside?: boolean;
  /** Replaces the composition's safe area for this look (its own layout sets the margins). */
  safeArea?: { x: number; y: number };
  build(args: BuildArgs): KineticLetter[];
  animate(L: KineticLetter, t: number): void;
  /** Per-look exit effect; omitted = the generic fade + shrink + drift. */
  exit?(L: KineticLetter, e: number): void;
  paint(ctx: TextCtx, L: KineticLetter, size: number): void;
}

/**
 * A hero word is scaled up and forced to the accent colour. This is how the
 * project's existing AI emphasis (one 'hero' per caption, emphasis.service.ts)
 * drives these templates — there is no separate trigger-word system.
 */
const HERO_SCALE = 1.25;

/**
 * A glyph's advance in em including its kerning with the next glyph, the way
 * CSS text sets it: the pair measured together, less the two measured apart.
 * (Letters are drawn one by one, so the kerning has to go into the advance.)
 */
function livingAdvance(m: Metrics, ch: string, next: string | undefined): number {
  const own = m.advance(ch);
  return next === undefined ? own : own + (m.advance(ch + next) - own - m.advance(next));
}

/** "#RRGGBB" / "#RGB" → [r, g, b], or null for anything else. */
function parseHexColor(color: string): [number, number, number] | null {
  const h = String(color).trim().replace(/^#/, '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** A colour at an opacity; non-hex colours pass through unchanged. */
function colorWithAlpha(color: string, alpha: number): string {
  const rgb = parseHexColor(color);
  if (!rgb || alpha >= 1) return rgb ? `rgb(${rgb.join(',')})` : color;
  return `rgba(${rgb.join(',')},${alpha})`;
}

/**
 * The lead-in's colour. While its source colour is still the preset one it is
 * the design's own tint; after the user picks another colour it follows that
 * colour — half-way to white for an accent tint, as-is for the base — at the
 * design's opacity, so a re-coloured card never keeps a lead-in of the old hue.
 */
function livingLeadColor(v: LivingVariant, accentColor: string, baseColor: string): string {
  const fromAccent = v.lead.tint === 'accent';
  const source = fromAccent ? accentColor : baseColor;
  const preset = parseHexColor(fromAccent ? v.accent : v.base);
  const rgb = parseHexColor(source);
  if (!rgb || !preset || rgb.every((c, i) => c === preset[i])) return v.lead.color;
  const k = fromAccent ? 0.5 : 0;
  return `rgba(${rgb.map((c) => Math.round(c + (255 - c) * k)).join(',')},${v.lead.alpha})`;
}

/**
 * One "Living Inside It" variant, laid out the way the design's HTML preview
 * lays it out: a flex column of up to three rows (lead-in, line 1, line 2) in
 * a padded text layer. Each row is one CSS line box — lineHeight × size tall,
 * the face's ascent + descent centred in it — stacked with the row margins;
 * the block is anchored top, centre or bottom, and each row aligned left,
 * right or centre inside the padding. Sizes are fractions of frame width
 * (px / LI_CARD_W), so the caption scales with the video exactly as the card
 * scales with its width. The entry animations are this engine's own.
 *
 * Colours come from the caption style (highlightColor paints line 1, color
 * line 2); each preset seeds the design's values, so the card matches the
 * design out of the box and both colour pickers keep working.
 */
function livingInsideLook(label: string, v: LivingVariant): KineticTemplateDef {
  const rowSpec = (slot: number): LivingRow =>
    slot === LI_SLOT_LEAD ? v.lead : slot === LI_SLOT_LINE1 ? v.line1 : v.line2;
  /** Design px → fraction of frame width. */
  const design = (px: number) => px / LI_CARD_W;

  return {
    label,
    tracking: 1,
    entryMs: LI_ENTRY_MS[v.entry],
    // Each row does its own casing (the lead-in may be lowercase).
    uppercase: false,
    holdMs: 0,
    exitMs: LI_FADE_MS,
    exitInside: true,
    safeArea: LI_SAFE_AREA,

    build({ words, metricsFor, accentColor, baseColor, aspect }) {
      const split = splitLivingWords(words);

      interface Row {
        slot: number;
        spec: LivingRow;
        words: string[];
        m: Metrics;
        /** Font size, fraction of frame width. */
        size: number;
        fill: string;
        /** Glow colour (opaque; the rings set the opacity) or stroke colour. */
        second: string;
        /** CSS width of the text: letter-spacing follows every character, the last included. */
        width: number;
        /** Justified rows: extra width per word gap. */
        extraSpace: number;
        x0: number;
        /** Baseline, in frame-WIDTH units from the top (frame height = aspect). */
        baseline: number;
      }

      const secondColor = (spec: LivingRow, color: string) =>
        spec.glow ? colorWithAlpha(color, 1) : spec.strokePx ? colorWithAlpha(color, spec.strokeAlpha ?? 1) : '#000000';

      const rows: Row[] = [];
      const addRow = (slot: number, rowWords: string[], fill: string, source: string) => {
        if (!rowWords.length) return;
        const spec = rowSpec(slot);
        rows.push({
          slot,
          spec,
          words: rowWords.map((w) => (spec.textCase === 'upper' ? w.toUpperCase() : w.toLowerCase())),
          m: metricsFor(spec.face),
          size: design(spec.px),
          fill,
          second: secondColor(spec, source),
          width: 0,
          extraSpace: 0,
          x0: 0,
          baseline: 0,
        });
      };
      addRow(LI_SLOT_LEAD, split.lead, livingLeadColor(v, accentColor, baseColor), baseColor);
      addRow(LI_SLOT_LINE1, split.line1, v.line1.fill ? colorWithAlpha(accentColor, 1) : 'transparent', accentColor);
      addRow(LI_SLOT_LINE2, split.line2, colorWithAlpha(baseColor, v.line2.alpha), baseColor);

      // Horizontal: widths, justification, alignment inside the padding.
      const padL = design(v.pad.left);
      const padR = design(v.pad.right);
      const inner = 1 - padL - padR;
      for (const r of rows) {
        let w = 0;
        r.words.forEach((word, wi) => {
          if (wi) w += r.m.advance(' ') + r.spec.trackEm;
          const chars = [...word];
          chars.forEach((ch, ci) => {
            w += livingAdvance(r.m, ch, chars[ci + 1]) + r.spec.trackEm;
          });
        });
        r.width = w * r.size;
        // text-align: justify spreads the words, never the letters; a single
        // word has no gap to spread and stays at the start.
        if (r.spec.justify && r.words.length > 1 && r.width < inner) {
          r.extraSpace = (inner - r.width) / (r.words.length - 1);
        }
        switch (v.hAlign) {
          case 'right':
            r.x0 = 1 - padR - r.width;
            break;
          case 'center':
            r.x0 = padL + (inner - r.width) / 2;
            break;
          default:
            r.x0 = padL + design(r.spec.insetPx ?? 0);
        }
      }

      // Vertical: CSS line boxes, worked out in design px the way Chrome does
      // it — the font's ascent and descent each rounded to a whole px,
      // 'normal' their sum, the half-leading floored onto the ascent — then
      // converted to frame-width units (the frame is `aspect` tall).
      const fontPx = (r: Row) => {
        const lm = LI_LINE_METRICS[r.spec.face] ?? r.m.vertical();
        return { ascent: Math.round(lm.ascent * r.spec.px), descent: Math.round(lm.descent * r.spec.px) };
      };
      const lineBoxPx = (r: Row) => {
        const f = fontPx(r);
        return r.spec.lineHeight === 'normal' ? f.ascent + f.descent : r.spec.lineHeight * r.spec.px;
      };
      const lineBox = (r: Row) => design(lineBoxPx(r));
      const outer = (r: Row) =>
        design(r.spec.marginTopPx ?? 0) + lineBox(r) + design(r.spec.marginBottomPx ?? 0);
      const total = rows.reduce((h, r) => h + outer(r), 0);
      const padT = design(v.pad.top);
      const padB = design(v.pad.bottom);
      let y =
        v.vAlign === 'top'
          ? padT
          : v.vAlign === 'bottom'
            ? aspect - padB - total
            : padT + (aspect - padT - padB - total) / 2;
      for (const r of rows) {
        const f = fontPx(r);
        y += design(r.spec.marginTopPx ?? 0);
        // Half-leading centres the ascent + descent in the line box; it is
        // negative when a design sets lines tighter than the font.
        const halfLeading = Math.floor((lineBoxPx(r) - (f.ascent + f.descent)) / 2);
        r.baseline = y + design(halfLeading + f.ascent);
        y += lineBox(r) + design(r.spec.marginBottomPx ?? 0);
      }

      // Entry bookkeeping per letter. Travel is stored PER EM, not as a
      // finished offset: scaleAbout and fitToSafeArea rescale nSize afterwards,
      // and a baked offset would then be the wrong fraction of the rendered
      // size. animate() multiplies by the letter's final nSize.
      const entryFor = (slot: number, glyph: number) => {
        switch (v.entry) {
          case 'rise':
            return { delay: slot * LI_STAGGER_MS, slamFrom: LI_RISE_EM / aspect };
          case 'pop':
            return { delay: slot === LI_SLOT_LEAD ? LI_POP_LEAD_DELAY_MS : 0 };
          case 'slideLeft':
            return {
              delay: slot * LI_SLIDE_STAGGER_MS,
              flyFromX: slot === LI_SLOT_LEAD ? LI_SLIDE_LEAD_EM : LI_SLIDE_EM,
            };
          case 'sweep':
            return {
              delay: slot * LI_SWEEP_ROW_MS + glyph * LI_SWEEP_LETTER_MS,
              slamFrom: LI_SWEEP_RISE_EM / aspect,
            };
          case 'converge':
            return {
              delay: slot * LI_CONVERGE_ROW_MS,
              flyFromX:
                slot === LI_SLOT_LINE1
                  ? -LI_CONVERGE_EM
                  : slot === LI_SLOT_LINE2
                    ? LI_CONVERGE_EM
                    : 0,
            };
        }
      };

      const out: KineticLetter[] = [];
      for (const r of rows) {
        const glyphV = r.m.vertical();
        const ny = r.baseline / aspect;
        let nx = r.x0;
        let glyph = 0;
        r.words.forEach((word, wi) => {
          if (wi) nx += (r.m.advance(' ') + r.spec.trackEm) * r.size + r.extraSpace;
          const chars = [...word];
          chars.forEach((ch, ci) => {
            // Additive tracking, exactly like CSS letter-spacing — a multiplier
            // would scale wide glyphs more than narrow ones — plus the pair's kerning.
            const adv = livingAdvance(r.m, ch, chars[ci + 1]) + r.spec.trackEm;
            out.push(
              makeLetter({
                ch,
                nx,
                ny,
                nSize: r.size,
                adv,
                ascent: glyphV.ascent,
                descent: glyphV.descent,
                face: r.spec.face,
                color: r.fill,
                wordIndex: wi,
                letterIndex: glyph,
                slot: r.slot,
                shadowColor: r.second,
                ...entryFor(r.slot, glyph),
              }),
            );
            nx += adv * r.size;
            glyph += 1;
          });
        });
      }

      // 'pop' scales the whole block about its centre, so every letter shares
      // one pivot (the default is the letter's own origin).
      if (v.entry === 'pop' && out.length) {
        const b = boundsOf(out, metricsFor(v.line1.face), aspect);
        const cx = (b.x0 + b.x1) / 2;
        const cy = (b.y0 + b.y1) / 2;
        for (const L of out) {
          L.pivotX = cx;
          L.pivotY = cy;
        }
      }

      return out;
    },

    animate(L, t) {
      L._scale = 1;
      L._x = L.nx;
      L._y = L.ny;
      switch (v.entry) {
        case 'rise': {
          // Lead-in first, then each big line rises into place behind it.
          const dur = L.slot === LI_SLOT_LEAD ? LI_LEAD_MS : LI_RISE_MS;
          const p = clamp((t - L.delay) / dur, 0, 1);
          L._alpha = p;
          L._y = L.ny + (1 - EASE.cubicOut(p)) * L.slamFrom * L.nSize;
          return;
        }
        case 'pop': {
          // The block scales up about its centre while fading in. Scaling
          // about the shared pivot (not each letter's own origin) is what
          // keeps the letter spacing growing with the glyphs.
          const p = clamp((t - L.delay) / LI_POP_MS, 0, 1);
          const s = LI_POP_FROM + (1 - LI_POP_FROM) * EASE.cubicOut(p);
          L._scale = s;
          L._alpha = p;
          L._x = L.pivotX + (L.nx - L.pivotX) * s;
          L._y = L.pivotY + (L.ny - L.pivotY) * s;
          return;
        }
        case 'slideLeft': {
          const dur = L.slot === LI_SLOT_LEAD ? LI_LEAD_MS : LI_SLIDE_MS;
          const p = clamp((t - L.delay) / dur, 0, 1);
          L._alpha = p;
          L._x = L.nx + (1 - EASE.cubicOut(p)) * L.flyFromX * L.nSize;
          return;
        }
        case 'sweep': {
          const p = clamp((t - L.delay) / LI_SWEEP_MS, 0, 1);
          L._alpha = p;
          L._y = L.ny + (1 - EASE.cubicOut(p)) * L.slamFrom * L.nSize;
          return;
        }
        case 'converge': {
          const p = clamp((t - L.delay) / LI_CONVERGE_MS, 0, 1);
          L._alpha = p;
          L._x = L.nx + (1 - EASE.cubicOut(p)) * L.flyFromX * L.nSize;
          return;
        }
      }
    },

    exit(L, e) {
      L._alpha *= 1 - EASE.cubicOut(e);
    },

    paint(ctx, L, size) {
      const spec = rowSpec(L.slot);
      // `size` is this letter's font size in frame px, so design px scale by size / spec.px.
      const px = size / spec.px;
      if (spec.fakeItalic) ctx.transform(1, 0, -LI_FAKE_ITALIC_SKEW, 1, 0, 0);

      // 1. text-shadow glow, beneath the letter.
      if (spec.glow) {
        const a = ctx.globalAlpha;
        const sigma = (spec.glow.blurPx / 2) * px;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = L.shadowColor;
        for (const ring of LI_GLOW_RINGS) {
          ctx.globalAlpha = a * spec.glow.alpha * spec.glow.match * LI_GLOW_GAIN * ring.a;
          ctx.lineWidth = 2 * ring.r * sigma;
          ctx.strokeText(L.ch, 0, 0);
        }
        ctx.globalAlpha = a;
      }
      // 2. the fill (hollow rows have none).
      if (spec.fill) {
        ctx.fillStyle = L._color;
        ctx.fillText(L.ch, 0, 0);
      }
      // 3. -webkit-text-stroke: centred on the outline, painted over the fill,
      //    mitred like Skia's text stroke.
      if (spec.strokePx) {
        ctx.lineJoin = 'miter';
        ctx.miterLimit = 4;
        ctx.strokeStyle = L.shadowColor;
        ctx.lineWidth = spec.strokePx * px;
        ctx.strokeText(L.ch, 0, 0);
      }
    },
  };
}

export const KINETIC_TEMPLATES: Record<KineticLook, KineticTemplateDef> = {
  /* -- Words stacked at mixed sizes and angles, vowels auto-accented ------ */
  scatteredStack: {
    label: 'Scattered Stack',
    tracking: 0.94,
    entryMs: 260,

    build({ words, rng, metrics, accentColor, baseColor, heroWords, aspect }) {
      const out: KineticLetter[] = [];
      const tracking = this.tracking;
      let ny = 0.24;

      words.forEach((word, wi) => {
        const isHero = heroWords.has(wi);
        const big = wi === 0;
        const base = big ? rng.range(0.075, 0.095) : rng.range(0.048, 0.066);
        const nSize = isHero ? base * HERO_SCALE : base;
        const rotation = rng.range(-9, 9);

        // Keep the run inside the frame before the safe-area pass touches it.
        const runW = metrics.runWidth(word, tracking) * nSize;
        let nx = rng.range(0.05, Math.max(0.06, 0.95 - runW));

        for (let ci = 0; ci < word.length; ci++) {
          const ch = word[ci];
          const accented = ACCENT_LETTERS.has(ch.toLowerCase()) && rng.chance(0.45);
          out.push(
            makeLetter({
              ch,
              nx,
              ny,
              nSize,
              adv: metrics.advance(ch) * tracking,
              rotation,
              color: isHero || accented ? accentColor : baseColor,
              wordIndex: wi,
              letterIndex: ci,
              delay: wi * 130 + ci * 28,
              phase: rng.range(0, Math.PI * 2),
            }),
          );
          nx += metrics.advance(ch) * nSize * tracking;
        }
        ny += (nSize * 1.12) / aspect + rng.range(0.008, 0.03);
      });

      return out;
    },

    animate(L, t) {
      const p = clamp((t - L.delay) / this.entryMs, 0, 1);
      L._scale = EASE.overshoot(p);
      L._x = L.nx;
      L._y = L.ny;
      if (p >= 1) {
        // Idle drift, in em so it reads the same at any resolution.
        L._x += Math.sin(t * 0.0018 + L.phase) * L.nSize * 0.012;
        L._y += Math.cos(t * 0.0014 + L.phase) * L.nSize * 0.01;
      }
    },

    paint(ctx, L, size) {
      ctx.fillStyle = 'rgba(0,0,0,0.82)';
      ctx.fillText(L.ch, size * 0.045, size * 0.045);
      ctx.fillStyle = L._color;
      ctx.fillText(L.ch, 0, 0);
    },
  },

  /* -- Centred phrase, letters reveal one by one with a neon bloom -------- */
  neonDisappear: {
    label: 'Neon Disappear',
    tracking: 0.98,
    entryMs: 220,

    build({ words, rng, metrics, accentColor, heroWords, aspect }) {
      const out: KineticLetter[] = [];
      const tracking = this.tracking;

      // Size from measured width, not from a character-count guess.
      const joined = words.join(' ');
      const unit = metrics.runWidth(joined, tracking);
      const nSize = clamp(0.86 / Math.max(unit, 1e-6), 0.04, 0.115);

      const lines = wrapWords(words, metrics, tracking, 0.86, nSize);
      const lineH = (nSize * 1.18) / aspect;
      const startY = 0.62 - ((lines.length - 1) * lineH) / 2;

      let gi = 0;
      let wi = -1;
      lines.forEach((line, li) => {
        // A hero word is drawn larger, so the cursor has to advance at ITS size
        // and the line has to be centred on the resulting wider run. Measuring
        // the line at the base size instead would overlap the scaled letters
        // and push the line off-centre.
        const sizeAt = (globalWordIndex: number) =>
          heroWords.has(globalWordIndex) ? nSize * HERO_SCALE : nSize;
        const firstWi = wi + 1;
        const spaceW = metrics.advance(' ') * nSize * tracking;
        let lineW = spaceW * (line.length - 1);
        line.forEach((word, k) => {
          lineW += metrics.runWidth(word, tracking) * sizeAt(firstWi + k);
        });

        let nx = 0.5 - lineW / 2;
        const ny = startY + li * lineH;

        line.forEach((word) => {
          wi++;
          const size = sizeAt(wi);
          for (let ci = 0; ci < word.length; ci++) {
            const ch = word[ci];
            out.push(
              makeLetter({
                ch,
                nx,
                ny,
                // Every letter is the accent colour in this template; the hero
                // word is distinguished by size alone.
                nSize: size,
                adv: metrics.advance(ch) * tracking,
                color: accentColor,
                wordIndex: wi,
                letterIndex: ci,
                delay: gi * 24,
                phase: rng.range(0, Math.PI * 2),
              }),
            );
            nx += metrics.advance(ch) * size * tracking;
            gi++;
          }
          nx += spaceW;
        });
      });

      return out;
    },

    animate(L, t) {
      const p = clamp((t - L.delay) / this.entryMs, 0, 1);
      L._scale = EASE.cubicOut(p);
      L._x = L.nx;
      L._y = L.ny;
      L._glow = 0.09;
      if (p >= 1) {
        L._glow = 0.11 + Math.sin(t * 0.005 + L.phase) * 0.05;
        L._y += Math.sin(t * 0.003 + L.phase) * L.nSize * 0.018;
      }
    },

    paint(ctx, L, size) {
      // The bloom is four concentric strokes, widest and faintest first, then a
      // bright core. A real gaussian (shadowBlur) looks slightly softer, but
      // canvas charges a FIXED ~20ms per glyph for any shadowBlur at all —
      // measured flat from radius 8 to radius 105 — which is ~400ms a frame for
      // one caption. That is 60x over budget for the export and would drop the
      // live preview to about 1.6fps. Strokes cost ~0.2ms per glyph and, being
      // deterministic geometry rather than a filter, are also guaranteed to
      // rasterise identically in the browser and in skia.
      //
      // Widths are fractions of the letter's own size (R5), so the bloom scales
      // with resolution instead of vanishing at 1080.
      const g = L._glow || 0.1;
      const a = L._alpha;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = L._color;

      // Six steps rather than four: each stroke is a hard-edged ring, so too
      // few of them read as visible banding around the glyph instead of a glow.
      for (let i = 0; i < NEON_HALO.length; i++) {
        const layer = NEON_HALO[i];
        ctx.globalAlpha = a * layer.alpha;
        ctx.lineWidth = size * g * layer.width;
        ctx.strokeText(L.ch, 0, 0);
      }

      // Core: the accent, then a hot near-white centre so the glyph stays
      // legible inside its own bloom.
      ctx.globalAlpha = a;
      ctx.fillStyle = L._color;
      ctx.fillText(L.ch, 0, 0);
      ctx.fillStyle = mixToWhite(L._color, 0.55);
      ctx.fillText(L.ch, 0, 0);
    },
  },

  /* -- Every letter placed independently, flying in from off-frame -------- */
  letterChaos: {
    label: 'Letter Chaos',
    tracking: 1,
    entryMs: 300,

    build({ words, rng, metrics, accentColor, baseColor, heroWords }) {
      const out: KineticLetter[] = [];
      const tracking = this.tracking;
      words.forEach((word, wi) => {
        const isHero = heroWords.has(wi);
        for (let ci = 0; ci < word.length; ci++) {
          const ch = word[ci];
          const base = rng.range(0.055, 0.115);
          const accented = rng.chance(0.28);
          const dim = rng.chance(0.12);
          out.push(
            makeLetter({
              ch,
              nx: 0.5 + rng.range(-0.36, 0.36),
              ny: 0.5 + rng.range(-0.28, 0.3),
              nSize: isHero ? base * HERO_SCALE : base,
              adv: metrics.advance(ch) * tracking,
              rotation: rng.range(-28, 28),
              color: isHero || accented ? accentColor : dim ? DIM_COLOR : baseColor,
              wordIndex: wi,
              letterIndex: ci,
              delay: wi * 90 + ci * 45 + rng.range(0, 70),
              phase: rng.range(0, Math.PI * 2),
              flyFromX: rng.range(-0.25, 1.25),
              flyFromY: rng.range(-0.25, 1.25),
            }),
          );
        }
      });
      return out;
    },

    animate(L, t) {
      const p = clamp((t - L.delay) / this.entryMs, 0, 1);
      const e = EASE.quartOut(p);
      L._scale = clamp(e * 1.08 - (e > 0.85 ? (e - 0.85) * 0.5 : 0), 0, 1.08);
      if (p < 1) {
        L._x = L.flyFromX + (L.nx - L.flyFromX) * e;
        L._y = L.flyFromY + (L.ny - L.flyFromY) * e;
      } else {
        L._x = L.nx + Math.sin(t * 0.0025 + L.phase) * L.nSize * 0.01;
        L._y = L.ny + Math.cos(t * 0.002 + L.phase) * L.nSize * 0.01;
      }
    },

    paint(ctx, L, size) {
      ctx.fillStyle = 'rgba(0,0,0,0.9)';
      ctx.fillText(L.ch, size * 0.06, size * 0.06);
      ctx.fillStyle = L._color;
      ctx.fillText(L.ch, 0, 0);
    },
  },

  /* -- Words slam down with spring overshoot and a decaying shake --------- */
  impactSlam: {
    label: 'Impact Slam',
    tracking: 0.95,
    entryMs: 170,
    shakeMs: 400,

    build({ words, rng, metrics, accentColor, baseColor, heroWords, aspect }) {
      const out: KineticLetter[] = [];
      const tracking = this.tracking;
      let ny = 0.28;

      words.forEach((word, wi) => {
        const isHero = heroWords.has(wi);
        const big = wi === 0;
        let nSize = big ? rng.range(0.082, 0.1) : rng.range(0.054, 0.072);
        if (isHero) nSize *= HERO_SCALE;

        // Shrink long words rather than letting them leave the frame.
        const unit = metrics.runWidth(word, tracking);
        nSize = Math.min(nSize, 0.9 / Math.max(unit, 1e-6));

        const runW = unit * nSize;
        let nx = 0.5 - runW / 2 + rng.range(-0.03, 0.03);

        for (let ci = 0; ci < word.length; ci++) {
          const ch = word[ci];
          const last = ci === word.length - 1;
          const accented = last && rng.chance(0.55);
          out.push(
            makeLetter({
              ch,
              nx,
              ny,
              nSize,
              adv: metrics.advance(ch) * tracking,
              rotation: rng.range(-3, 3),
              color: isHero ? accentColor : accented ? SLAM_ACCENT : baseColor,
              wordIndex: wi,
              letterIndex: ci,
              delay: wi * 210 + ci * 14,
              phase: rng.range(0, Math.PI * 2),
              slamFrom: rng.range(-0.14, -0.06),
            }),
          );
          nx += metrics.advance(ch) * nSize * tracking;
        }
        ny += (nSize * 1.2) / aspect;
      });

      return out;
    },

    animate(L, t) {
      const el = t - L.delay;
      const p = clamp(el / this.entryMs, 0, 1);
      L._scale = EASE.spring(p);
      L._x = L.nx;
      if (p < 1) {
        L._y = L.ny + L.slamFrom * (1 - EASE.cubicOut(p));
      } else {
        const decay = clamp(1 - (el - this.entryMs) / (this.shakeMs ?? 400), 0, 1);
        L._y = L.ny + steppedNoise(L._i, t, SHAKE_HZ) * decay * L.nSize * 0.06;
        L._x = L.nx + steppedNoise(L._i + 613, t, SHAKE_HZ) * decay * L.nSize * 0.04;
      }
    },

    paint(ctx, L, size) {
      // Heavy black outline — critical for readability on busy video frames.
      ctx.fillStyle = 'rgba(0,0,0,1)';
      ctx.fillText(L.ch, size * 0.05, size * 0.05);
      ctx.lineWidth = size * 0.035;
      ctx.strokeStyle = 'rgba(0,0,0,0.95)';
      ctx.strokeText(L.ch, 0, 0);
      ctx.fillStyle = L._color;
      ctx.fillText(L.ch, 0, 0);
    },
  },

  /* -- Centred phrase with a scheduled RGB split ------------------------- */
  glitchSplit: {
    label: 'Glitch Split',
    tracking: 1.0,
    entryMs: 320,

    build({ words, rng, metrics, accentColor, baseColor, heroWords, aspect }) {
      const out: KineticLetter[] = [];
      const tracking = this.tracking;
      const joined = words.join(' ');
      const unit = metrics.runWidth(joined, tracking);
      const nSize = clamp(0.84 / Math.max(unit, 1e-6), 0.04, 0.105);

      const lines = wrapWords(words, metrics, tracking, 0.84, nSize);
      const lineH = (nSize * 1.16) / aspect;
      const startY = 0.5 + nSize / (2 * aspect) - ((lines.length - 1) * lineH) / 2;

      let wi = -1;
      lines.forEach((line, li) => {
        // Same rule as neonDisappear: advance at each word's OWN size and
        // centre on the real run width, or a scaled hero word overlaps its
        // neighbours and drags the line off-centre.
        const sizeAt = (globalWordIndex: number) =>
          heroWords.has(globalWordIndex) ? nSize * HERO_SCALE : nSize;
        const firstWi = wi + 1;
        const spaceW = metrics.advance(' ') * nSize * tracking;
        let lineW = spaceW * (line.length - 1);
        line.forEach((word, k) => {
          lineW += metrics.runWidth(word, tracking) * sizeAt(firstWi + k);
        });

        let nx = 0.5 - lineW / 2;
        const ny = startY + li * lineH;

        line.forEach((word) => {
          wi++;
          const size = sizeAt(wi);
          const isHero = heroWords.has(wi);
          for (let ci = 0; ci < word.length; ci++) {
            const ch = word[ci];
            out.push(
              makeLetter({
                ch,
                nx,
                ny,
                nSize: size,
                adv: metrics.advance(ch) * tracking,
                color: isHero ? accentColor : baseColor,
                wordIndex: wi,
                letterIndex: ci,
                delay: 0,
                phase: rng.range(0, Math.PI * 2),
              }),
            );
            nx += metrics.advance(ch) * size * tracking;
          }
          nx += spaceW;
        });
      });

      return out;
    },

    animate(L, t) {
      L._scale = EASE.cubicOut(clamp(t / this.entryMs, 0, 1));
      L._x = L.nx;
      L._y = L.ny;

      // Scheduled, not random: identical every time this frame is drawn. The
      // spec's `if (Math.random() < 0.035)` per RAF tick could not survive a
      // frame-stepped export.
      const step = Math.floor((t * GLITCH_HZ) / 1000);
      const firing = noise(L._i * 7 + 13, step) > 0.62;

      if (firing) {
        L._color = noise(L._i, step) > 0 ? GLITCH_CYAN : GLITCH_RED;
        L._x += noise(L._i + 91, step) * L.nSize * 0.12;
        L._chromaR = 0.02 + Math.abs(noise(L._i + 5, step)) * 0.04;
        L._chromaB = 0.02 + Math.abs(noise(L._i + 6, step)) * 0.04;
      } else {
        const idle = Math.sin(t * 0.007 + L.phase);
        L._chromaR = Math.max(0, idle) * 0.012;
        L._chromaB = Math.max(0, -idle) * 0.012;
      }
    },

    paint(ctx, L, size) {
      const r = (L._chromaR || 0) * size;
      const b = (L._chromaB || 0) * size;
      if (r > 0.4 || b > 0.4) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = '#ff0044';
        ctx.fillText(L.ch, -r, 0);
        ctx.fillStyle = GLITCH_CYAN;
        ctx.fillText(L.ch, b, 0);
        ctx.globalCompositeOperation = 'source-over';
      } else {
        ctx.fillStyle = 'rgba(0,0,0,0.9)';
        ctx.fillText(L.ch, size * 0.03, size * 0.03);
      }
      ctx.fillStyle = L._color;
      ctx.fillText(L.ch, 0, 0);
    },
  },

  /* -- Blockbuster: red condensed heading over a white script line ---------
   * The one fixed look of the 'blockbuster' template. Two slots per caption
   * (splitBlockbusterWords): the heading is Anton, uppercase, accent-coloured,
   * with a glow, a hard darkened-accent shadow and a slight tilt; the script
   * line is Caveat, as written, base-coloured, larger, and sits just under the
   * heading so it overlaps its bottom edge. Ignores heroWords — colour is by
   * slot, not by word. */
  blockbuster: {
    label: 'Blockbuster',
    tracking: 1,
    entryMs: BB_SLIDE_MS,
    uppercase: false,
    holdMs: 0,
    exitMs: BB_FADE_MS,
    exitInside: true,

    build({ words, metrics, metricsFor, accentColor, baseColor, aspect, params }) {
      const out: KineticLetter[] = [];
      const { heading, script } = splitBlockbusterWords(words);
      let lastBaseline = BB_HEADING_Y;

      if (heading.length) {
        const headWords = heading.map((w) => w.toUpperCase());
        // The spec's letter spacing is additive (a fraction of the font size
        // per glyph); the engine's tracking is a multiplier on each advance.
        const tracking = 1 + params.letterSpacing / BB_ANTON_MEAN_ADVANCE;
        const nSize = BB_HEADING_SIZE * BB_REF_ASPECT;
        const v = metrics.vertical();
        const lines = wrapWords(headWords, metrics, tracking, BB_MAX_WIDTH, nSize);
        const lineH = (nSize * BB_LINE_HEIGHT) / aspect;
        const spaceW = metrics.advance(' ') * nSize * tracking;
        const shadowColor = mixToBlack(accentColor, BB_SHADOW_DARKEN);
        const headingLetters: KineticLetter[] = [];
        let wi = -1;

        lines.forEach((line, li) => {
          let lineW = spaceW * (line.length - 1);
          for (const word of line) lineW += metrics.runWidth(word, tracking) * nSize;
          let nx = 0.5 - lineW / 2;
          const ny = BB_HEADING_Y + li * lineH;
          line.forEach((word) => {
            wi++;
            for (let ci = 0; ci < word.length; ci++) {
              const ch = word[ci];
              headingLetters.push(
                makeLetter({
                  ch,
                  nx,
                  ny,
                  nSize,
                  adv: metrics.advance(ch) * tracking,
                  ascent: v.ascent,
                  descent: v.descent,
                  color: accentColor,
                  wordIndex: wi,
                  letterIndex: ci,
                  slot: BB_SLOT_HEADING,
                  glow: params.glow,
                  shadowColor,
                }),
              );
              nx += metrics.advance(ch) * nSize * tracking;
            }
            nx += spaceW;
          });
        });
        lastBaseline = BB_HEADING_Y + (lines.length - 1) * lineH;

        // Whole-line tilt: rotate every letter's origin about the block centre
        // and give each letter the same rotation. That is a rigid transform, so
        // the result is identical to rotating the line as one piece — and the
        // renderer only ever rotates letters individually.
        const b = boundsOf(headingLetters, metrics, aspect);
        const cx = (b.x0 + b.x1) / 2;
        const cy = (b.y0 + b.y1) / 2;
        const rad = params.tilt * DEG;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        for (const L of headingLetters) {
          // Rotate in frame-WIDTH units so both axes share one scale.
          const dx = L.nx - cx;
          const dy = (L.ny - cy) * aspect;
          L.nx = cx + dx * cos - dy * sin;
          L.ny = cy + (dx * sin + dy * cos) / aspect;
          L.rotation = params.tilt;
          L.pivotX = cx;
          L.pivotY = cy;
        }
        out.push(...headingLetters);
      }

      if (script.length) {
        const face: KineticFace = 'caveatBold';
        const sm = metricsFor(face);
        const sv = sm.vertical();
        const tracking = 1;
        const nSize = BB_SCRIPT_SIZE * BB_REF_ASPECT * params.scriptScale;
        const spaceW = sm.advance(' ') * nSize * tracking;
        // The script is one or two words by construction — a single centred run.
        let lineW = spaceW * (script.length - 1);
        for (const word of script) lineW += sm.runWidth(word, tracking) * nSize;
        let nx = 0.5 - lineW / 2;
        const ny = lastBaseline + (BB_SCRIPT_GAP_EM * nSize) / aspect;
        // Stored as travel PER EM, not as a finished offset: scaleAbout and
        // fitToSafeArea rescale nSize afterwards, and a baked offset would then
        // be the wrong fraction of the rendered size (too short when the user
        // grows the caption, longer than a whole line when the safe-area fit
        // shrinks it). animate() multiplies by the letter's final nSize.
        const slidePerEm = BB_SLIDE_EM / aspect;
        let wi = heading.length - 1;
        script.forEach((word) => {
          wi++;
          for (let ci = 0; ci < word.length; ci++) {
            const ch = word[ci];
            out.push(
              makeLetter({
                ch,
                nx,
                ny,
                nSize,
                adv: sm.advance(ch) * tracking,
                ascent: sv.ascent,
                descent: sv.descent,
                face,
                color: baseColor,
                wordIndex: wi,
                letterIndex: ci,
                slot: BB_SLOT_SCRIPT,
                slamFrom: slidePerEm,
              }),
            );
            nx += sm.advance(ch) * nSize * tracking;
          }
          nx += spaceW;
        });
      }

      return out;
    },

    animate(L, t) {
      if (L.slot === BB_SLOT_SCRIPT) {
        // slideUp: rises into place while fading in.
        const p = clamp(t / BB_SLIDE_MS, 0, 1);
        L._scale = 1;
        L._alpha = p;
        L._x = L.nx;
        // slamFrom is travel PER EM here (see build) — times the letter's final
        // size, so the slide stays 0.5 em however the caption was scaled.
        L._y = L.ny + (1 - EASE.cubicOut(p)) * L.slamFrom * L.nSize;
        return;
      }
      // popIn: the whole heading block scales 0.85 -> 1 about its centre while
      // fading in. Scaling about the pivot (not each letter's own origin) is
      // what keeps the letter spacing growing with the glyphs.
      const p = clamp(t / BB_POP_MS, 0, 1);
      const s = 0.85 + 0.15 * EASE.cubicOut(p);
      L._scale = s;
      L._alpha = p;
      L._glow = L.glow;
      L._x = L.pivotX + (L.nx - L.pivotX) * s;
      L._y = L.pivotY + (L.ny - L.pivotY) * s;
    },

    // Pure fade-out (spec). Multiplied, not assigned, so a caption too short
    // to finish its entry still fades from wherever it got to.
    exit(L, e) {
      L._alpha *= 1 - EASE.cubicOut(e);
    },

    paint(ctx, L, size) {
      const a = L._alpha;
      if (L.slot === BB_SLOT_SCRIPT) {
        // Soft dark shadow (spec: blur 0.2em, dy 0.03em), approximated with
        // three low-alpha offset fills. Never shadowBlur — see the
        // neonDisappear note for why that costs ~20ms per glyph.
        const dy = BB_SCRIPT_SHADOW_DY * size;
        const spread = size * 0.014;
        ctx.fillStyle = 'rgba(0,0,0,0.38)';
        ctx.fillText(L.ch, -spread, dy);
        ctx.fillText(L.ch, spread, dy);
        ctx.fillText(L.ch, 0, dy + spread);
        ctx.fillStyle = L._color;
        ctx.fillText(L.ch, 0, 0);
        return;
      }

      // 1. glow — concentric rings, widest and faintest first (same technique
      //    and same reasoning as neonDisappear). Width and alpha both scale
      //    with the user's glow knob, so 0 removes it entirely.
      const g = L._glow;
      if (g > 0) {
        // The knob is INTENSITY, not size: the ring radii are fixed and only
        // their opacity follows `g`.
        //
        // Scaling the radius too is what made 200% unusable. The halo is six
        // concentric strokes; widen them all and they stop being a gradient
        // and become one opaque slab with the letterforms swallowed inside it.
        // Worse, it hid in the editor — the preview canvas is a few hundred px
        // wide, where those rings are thin enough to blend into a believable
        // glow, while the same proportions at 1080p are ~120px of solid red.
        // "Looks right in the preview, painted-on in the export" is exactly the
        // failure this engine exists to prevent.
        //
        // Radius is independent of g, so glow 1 is byte-identical to the
        // authored look and every other value just changes brightness.
        ctx.lineJoin = 'round';
        ctx.strokeStyle = L._color;
        for (let i = 0; i < NEON_HALO.length; i++) {
          const layer = NEON_HALO[i];
          // Capped: past ~1.6x the rings saturate into each other again.
          ctx.globalAlpha = a * layer.alpha * Math.min(1.6, g);
          ctx.lineWidth = size * BB_GLOW_EM * layer.width * 0.55;
          ctx.strokeText(L.ch, 0, 0);
        }
        ctx.globalAlpha = a;
      }
      // 2. hard shadow — darkened accent, offset down-right, no blur.
      ctx.fillStyle = L.shadowColor;
      ctx.fillText(L.ch, BB_SHADOW_DX * size, BB_SHADOW_DY * size);
      // 3. the letter itself.
      ctx.fillStyle = L._color;
      ctx.fillText(L.ch, 0, 0);
    },
  },

  /* -- Living Inside It: five variants of one three-row idea ------------- */
  livingBlue: livingInsideLook('Living — Blue', LIVING_VARIANTS.livingBlue),
  livingTeal: livingInsideLook('Living — Teal', LIVING_VARIANTS.livingTeal),
  livingOrange: livingInsideLook('Living — Orange', LIVING_VARIANTS.livingOrange),
  livingRed: livingInsideLook('Living — Red', LIVING_VARIANTS.livingRed),
  livingPurple: livingInsideLook('Living — Purple', LIVING_VARIANTS.livingPurple),
};

/**
 * Blockbuster's default distribution of one caption across its two slots
 * (spec: the last two words go to the script line, or the last ONE when the
 * caption has three words or fewer; a single word is script only).
 */
export function splitBlockbusterWords(words: string[]): { heading: string[]; script: string[] } {
  if (!words.length) return { heading: [], script: [] };
  const tail = words.length <= 3 ? 1 : 2;
  return { heading: words.slice(0, -tail), script: words.slice(-tail) };
}

function mixToWhite(hex: string, amount: number): string {
  const h = String(hex).replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return '#ffffff';
  const r = Math.round(((n >> 16) & 255) + (255 - ((n >> 16) & 255)) * amount);
  const g = Math.round(((n >> 8) & 255) + (255 - ((n >> 8) & 255)) * amount);
  const b = Math.round((n & 255) + (255 - (n & 255)) * amount);
  return `rgb(${r},${g},${b})`;
}

function mixToBlack(hex: string, amount: number): string {
  const h = String(hex).replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return '#000000';
  const k = 1 - amount;
  const r = Math.round(((n >> 16) & 255) * k);
  const g = Math.round(((n >> 8) & 255) * k);
  const b = Math.round((n & 255) * k);
  return `rgb(${r},${g},${b})`;
}

/* ------------------------------------------------------------------------ *
 * 7. Scenes
 *
 * One scene == one caption. This project already groups words into captions
 * (displayCaptions.ts on the client, regroupForDisplay() on the server), so the
 * engine deliberately does NOT do its own grouping — that would double-group.
 * ------------------------------------------------------------------------ */

export const KINETIC_SAFE_AREA = { x: 0.05, y: 0.07 };

/** How long a scene lingers after its caption's end time, in ms. */
export const KINETIC_HOLD_MS = 220;
/** Exit fade length, in ms. */
export const KINETIC_EXIT_MS = 200;

export interface KineticScene {
  index: number;
  /** Seconds, absolute video time. */
  start: number;
  end: number;
  /** Total ms of entry animation (max delay + entryMs). */
  animMs: number;
  /** Which sub-look this caption drew — chosen by pickKineticLook. */
  look: KineticLook;
  /** Resolved from the look: glitchSplit is Orbitron, the rest Bebas Neue. */
  fontFamily: string;
  fontWeight: number;
  /** Normalised bounding-box centre of the laid-out letters. */
  centerX: number;
  centerY: number;
  /** Half extents of that box, for clamping a manual anchor inside the frame. */
  halfW: number;
  halfH: number;
  /**
   * Manual whole-chunk position (normalised 0-1, centre anchor), or null for
   * the look's own natural placement. Mutable: the editor writes straight to
   * this while dragging, and the next frame picks it up — no rebuild, so the
   * seeded layout is untouched.
   */
  anchorX: number | null;
  anchorY: number | null;
  letters: KineticLetter[];
}

export interface KineticComposition {
  version: number;
  template: KineticTemplateId;
  frame: { W: number; H: number };
  /** Per-face font fingerprint — compare with the other renderer's to prove
   *  both sides measured the same faces. */
  fingerprints: Partial<Record<KineticFace, number>>;
  scenes: KineticScene[];
}

/** One caption, as both renderers see it. */
export interface KineticCaptionInput {
  sequence: number;
  start: number;
  end: number;
  text: string;
  /** Per-word roles aligned with text.split(/\s+/); 'hero' drives the accent. */
  emphasis?: Array<string | undefined>;
  /**
   * Whole-chunk position override (% of canvas, centre anchor) — the same
   * Caption.offsetX/offsetY the DOM templates use, so dragging a kinetic
   * caption persists through exactly the same path.
   */
  offsetX?: number | null;
  offsetY?: number | null;
  /** Whole-chunk font-size multiplier (100 = normal), on top of fontScale. */
  sizeScale?: number | null;
}

/**
 * Manual 'hero' role(s) win; otherwise the single longest word. Mirrors
 * emphasisSet() in CaptionOverlay.tsx and kineticHeroIndices() in
 * captionPng.service.ts — the project's one rule for picking the accent word.
 */
export function kineticHeroWordIndices(words: string[], roles: Array<string | undefined>): Set<number> {
  const manual: number[] = [];
  roles.forEach((r, i) => {
    if (r === 'hero') manual.push(i);
  });
  if (manual.length) return new Set(manual);
  if (words.length < 2) return new Set<number>();
  const coreLen = (w: string) => w.replace(/[^\p{L}\p{N}]/gu, '').length;
  let bigIdx = 0;
  words.forEach((w, i) => {
    if (coreLen(w) > coreLen(words[bigIdx])) bigIdx = i;
  });
  return new Set([bigIdx]);
}

export interface BuildCompositionArgs {
  captions: KineticCaptionInput[];
  /** Which template to lay out. Default 'animeEdit' (the original). */
  template?: KineticTemplateId;
  /** style.highlightColor */
  accentColor: string;
  /** style.color */
  baseColor: string;
  frame: { W: number; H: number };
  /**
   * Metrics for one FACE. Looks use different faces (glitchSplit is Orbitron,
   * blockbuster mixes Anton and Caveat, the rest are Bebas Neue), and a caption
   * laid out with the wrong face's advances overlaps its own letters — so
   * metrics are per face, not per composition. Callers should cache: this is
   * called at least once per caption.
   */
  metricsFor: (face: KineticFace) => Metrics;
  /** The renderer's name for a face (a CSS stack in the browser, a registered
   *  alias on the server). */
  fontFor: (face: KineticFace) => { family: string; weight: number; style?: string };
  /**
   * Global size multiplier from style.fontSize / KINETIC_BASE_FONT_SIZE.
   * 1 = as designed. Composes with each caption's own sizeScale.
   */
  fontScale?: number;
  safeArea?: { x: number; y: number };
  /** style.kinetic — user knobs; missing fields fall back to the authored values. */
  params?: KineticParams;
}

/**
 * Build every scene for a project. The ONLY function that creates a layout —
 * the preview and the export worker both call it, with the same inputs, and
 * therefore get the same pixels.
 *
 * Each caption picks its own look (see pickKineticLook), so one project shows
 * all five treatments intercut the way a hand-made edit would.
 */
export function buildKineticComposition({
  captions,
  template = KINETIC_TEMPLATE_ID,
  accentColor,
  baseColor,
  frame,
  metricsFor,
  fontFor,
  fontScale = 1,
  safeArea = KINETIC_SAFE_AREA,
  params,
}: BuildCompositionArgs): KineticComposition {
  const aspect = frame.H / frame.W;
  const fingerprints: Partial<Record<KineticFace, number>> = {};
  const recentLooks: KineticLook[] = [];
  const looks = KINETIC_TEMPLATE_LOOKS[template];
  const resolvedParams = resolveParams(params);

  const scenes: KineticScene[] = captions.map((c, gi) => {
    const rawWords = c.text.trim().split(/\s+/).filter(Boolean);

    // Each caption gets its own deterministic stream, seeded from its own
    // content — so editing caption 3 never reshuffles caption 1.
    const rng = makeRng(seedForCaption(template, c.text, c.sequence ?? gi));

    // A single-look template always draws that look; only the multi-look one
    // spends an rng draw on picking (keeps every Anime Edit layout identical).
    const look =
      looks.length === 1 ? looks[0] : pickKineticLook(rawWords.length, rng, recentLooks);
    recentLooks.push(look);

    const tmpl = KINETIC_TEMPLATES[look];
    const words = tmpl.uppercase === false ? rawWords : rawWords.map((w) => w.toUpperCase());
    const primaryFace = KINETIC_LOOK_FACES[look];
    const metrics = metricsFor(primaryFace);
    const font = fontFor(primaryFace);
    for (const face of [primaryFace, ...(KINETIC_LOOK_EXTRA_FACES[look] ?? [])]) {
      if (fingerprints[face] === undefined) fingerprints[face] = metricsFor(face).fingerprint();
    }

    const heroWords = kineticHeroWordIndices(words, c.emphasis ?? []);

    let letters = words.length
      ? tmpl.build({
          words,
          rng,
          metrics,
          metricsFor,
          accentColor,
          baseColor,
          heroWords,
          aspect,
          params: resolvedParams,
        })
      : [];

    // Every letter carries the renderer's name for its own face, so the draw
    // loop never has to look it up (and a mixed-face look just works).
    for (const L of letters) {
      const f = L.face ? fontFor(L.face) : font;
      L.fontStyle = f.style ?? '';
      L.fontFamily = f.family;
      L.fontWeight = f.weight;
    }

    // Global slider x this chunk's own override, applied about the
    // composition's centre so the look's geometry scales as one piece.
    const chunkScale =
      typeof c.sizeScale === 'number' && Number.isFinite(c.sizeScale) ? c.sizeScale / 100 : 1;
    const scale = Math.max(0.1, fontScale * chunkScale);
    scaleAbout(letters, metrics, aspect, scale);

    letters = fitToSafeArea(letters, metrics, aspect, tmpl.safeArea ?? safeArea, scale);
    letters.forEach((L, i) => {
      L._i = i;
    });

    const maxDelay = letters.reduce((m, L) => Math.max(m, L.delay), 0);
    const b = boundsOf(letters, metrics, aspect);
    const pct = (v: number | null | undefined) =>
      typeof v === 'number' && Number.isFinite(v) ? v / 100 : null;

    return {
      index: gi,
      start: c.start,
      end: c.end,
      animMs: maxDelay + tmpl.entryMs,
      look,
      fontFamily: font.family,
      fontWeight: font.weight,
      centerX: (b.x0 + b.x1) / 2,
      centerY: (b.y0 + b.y1) / 2,
      halfW: b.w / 2,
      halfH: b.h / 2,
      anchorX: pct(c.offsetX),
      anchorY: pct(c.offsetY),
      letters,
    };
  });

  return {
    version: KINETIC_ENGINE_VERSION,
    template,
    frame: { ...frame },
    fingerprints,
    scenes,
  };
}

/* ------------------------------------------------------------------------ *
 * 8. Rendering
 *
 * renderKineticFrame is pure with respect to time: calling it twice with the
 * same timeSec produces identical pixels. That is what lets the export worker
 * step frame by frame and trust the result.
 * ------------------------------------------------------------------------ */

/**
 * How far to shift a scene from its natural placement, given its manual anchor.
 *
 * Applied at DRAW time rather than baked into the letters, so dragging is a
 * single number change per frame and never re-runs the seeded layout (which
 * would reshuffle the scatter under the user's cursor).
 *
 * The anchor is clamped so the caption's bounding box stays ON CANVAS, and
 * deliberately NOT to the safe area: the safe margin governs automatic
 * placement (fitToSafeArea already applied it), but a manual drag is the user
 * overriding that on purpose, and clamping to it would leave a tall look like
 * impactSlam only ~40-59% of vertical travel. A box too big to fit simply
 * centres on that axis.
 */
export function kineticSceneShift(
  scene: KineticScene,
  margin: { x: number; y: number } = { x: KINETIC_PAINT_BLEED, y: KINETIC_PAINT_BLEED },
): { dx: number; dy: number } {
  if (scene.anchorX == null && scene.anchorY == null) return { dx: 0, dy: 0 };

  const axis = (anchor: number | null, center: number, half: number, margin: number) => {
    if (anchor == null) return center;
    const lo = margin + half;
    const hi = 1 - margin - half;
    return lo > hi ? 0.5 : clamp(anchor, lo, hi);
  };

  return {
    dx: axis(scene.anchorX, scene.centerX, scene.halfW, margin.x) - scene.centerX,
    dy: axis(scene.anchorY, scene.centerY, scene.halfH, margin.y) - scene.centerY,
  };
}

function resetLetterState(L: KineticLetter): void {
  L._scale = 0;
  L._x = L.nx;
  L._y = L.ny;
  L._color = L.color;
  L._alpha = 1;
  L._glow = 0;
  L._chromaR = 0;
  L._chromaB = 0;
}

/** Which scenes are on screen at this moment, and each one's local clock. */
export function activeKineticScenes(
  comp: KineticComposition,
  timeSec: number,
): Array<{ scene: KineticScene; tMs: number; exit: number }> {
  const out: Array<{ scene: KineticScene; tMs: number; exit: number }> = [];
  for (const scene of comp.scenes) {
    const tmpl = KINETIC_TEMPLATES[scene.look];
    const holdMs = tmpl.holdMs ?? KINETIC_HOLD_MS;
    const exitMs = tmpl.exitMs ?? KINETIC_EXIT_MS;
    const tMs = (timeSec - scene.start) * 1000;
    if (tMs < 0) continue;
    // A caption always lives long enough to finish its own entry animation,
    // otherwise a short caption would cut off mid-slam.
    const lifeMs = Math.max((scene.end - scene.start) * 1000, scene.animMs) + holdMs;
    if (tmpl.exitInside) {
      // The fade is the LAST exitMs of the caption's own life, ending exactly
      // at its end — so the next caption never overlaps this one.
      if (tMs > lifeMs) continue;
      const fadeStart = Math.max(0, lifeMs - exitMs);
      const exit = tMs > fadeStart ? clamp((tMs - fadeStart) / Math.max(1, lifeMs - fadeStart), 0, 1) : 0;
      out.push({ scene, tMs, exit });
      continue;
    }
    if (tMs > lifeMs + exitMs) continue;
    const exit = tMs > lifeMs ? clamp((tMs - lifeMs) / exitMs, 0, 1) : 0;
    out.push({ scene, tMs, exit });
  }
  return out;
}

/** True if anything at all would be painted at this instant. */
export function hasKineticContentAt(comp: KineticComposition, timeSec: number): boolean {
  return activeKineticScenes(comp, timeSec).length > 0;
}

export interface RenderFrameOptions {
  timeSec: number;
  clear?: boolean;
}

/**
 * Draw one instant onto a context whose transform is already set so that
 * drawing coordinates are frame units (see setupKineticCanvas).
 */
export function renderKineticFrame(
  ctx: TextCtx,
  comp: KineticComposition,
  options: RenderFrameOptions,
): void {
  const { timeSec, clear = true } = options;
  const { W, H } = comp.frame;

  if (clear) ctx.clearRect(0, 0, W, H);

  for (const { scene, tMs, exit } of activeKineticScenes(comp, timeSec)) {
    // Look, and therefore face, is per scene — two captions on screen during a
    // crossfade can legitimately be different treatments.
    const tmpl = KINETIC_TEMPLATES[scene.look];
    const shift = kineticSceneShift(scene);

    for (const L of scene.letters) {
      resetLetterState(L);
      tmpl.animate(L, tMs);

      if (exit > 0) {
        if (tmpl.exit) {
          tmpl.exit(L, exit);
        } else {
          const e = EASE.cubicOut(exit);
          L._alpha = 1 - e;
          L._scale *= 1 - e * 0.25;
          L._y -= e * L.nSize * 0.06;
        }
      }

      const size = L.nSize * W * L._scale;
      if (size < 0.6 || L._alpha <= 0.005) continue;

      ctx.save();
      ctx.globalAlpha = L._alpha;
      ctx.translate((L._x + shift.dx) * W, (L._y + shift.dy) * H);
      if (L.rotation) ctx.rotate(L.rotation * DEG);

      // Scale is baked into the font size rather than applied as a transform,
      // so glyphs rasterise at their true size (sharper) and every em-based
      // offset inside paint() stays in real pixels. The face is per LETTER —
      // a look may mix faces (blockbuster) — resolved once at build time.
      applyTextContext(
        ctx,
        `${L.fontStyle ? `${L.fontStyle} ` : ''}${L.fontWeight} ${size}px ${L.fontFamily}`,
      );
      tmpl.paint(ctx, L, size);

      ctx.restore();
    }
  }
}
