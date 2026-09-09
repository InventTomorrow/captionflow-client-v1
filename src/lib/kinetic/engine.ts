/**
 * kinetic/engine.ts — THE single source of truth for the Anime Edit template.
 *
 * ONE template ('animeEdit') with five internal looks — scatteredStack,
 * neonDisappear, letterChaos, impactSlam, glitchSplit — intercut per caption by
 * pickKineticLook, so a sequence varies the way a hand-made AMV edit does
 * instead of repeating one effect.
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
export const KINETIC_ENGINE_VERSION = 1;

/**
 * ONE template id. The five looks below are its internal sub-styles, not
 * separate templates the user picks between — same shape as `mixed`/`mixed2`,
 * which cycle 8 curated sub-looks under a single id.
 *
 * The point is to replace what an AMV editor does by hand: vary the treatment
 * line by line so a sequence never feels like one repeated effect. The editor
 * chooses "Anime Edit" once; `pickKineticLook` decides per caption.
 */
export const KINETIC_TEMPLATE_ID = 'animeEdit';

export const KINETIC_LOOK_NAMES = [
  'scatteredStack',
  'neonDisappear',
  'letterChaos',
  'impactSlam',
  'glitchSplit',
] as const;

export type KineticLook = (typeof KINETIC_LOOK_NAMES)[number];

export function isKineticTemplate(t: string | undefined): t is typeof KINETIC_TEMPLATE_ID {
  return t === KINETIC_TEMPLATE_ID;
}

/**
 * The face each LOOK is drawn in. Pinned per look, exactly like
 * KINETIC_FONT_FILES in captionPng.service.ts — these looks depend on a
 * condensed display face, and letting the Text panel swap in Caveat or Noto
 * Nastaliq would break the scatter layouts.
 *
 * `file` must exist in server/fonts (download-fonts.mjs TARGETS) and `family`
 * must be imported in client/src/index.css. Both are already true today.
 */
export const KINETIC_FONTS: Record<KineticLook, { family: string; file: string; weight: number }> = {
  // Bebas Neue ships ONE weight. Asking for 900 makes the browser synthesise a
  // fake bold by smearing outlines, which is why display type looked mushy.
  scatteredStack: { family: 'Bebas Neue', file: 'BebasNeue-Regular.ttf', weight: 400 },
  neonDisappear: { family: 'Bebas Neue', file: 'BebasNeue-Regular.ttf', weight: 400 },
  letterChaos: { family: 'Bebas Neue', file: 'BebasNeue-Regular.ttf', weight: 400 },
  impactSlam: { family: 'Bebas Neue', file: 'BebasNeue-Regular.ttf', weight: 400 },
  glitchSplit: { family: 'Orbitron', file: 'Orbitron-Bold.ttf', weight: 700 },
};

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
export function createMetrics(ctx: TextCtx, fontFamily: string, fontWeight: number): Metrics {
  const spec = `${fontWeight} ${REF}px ${fontFamily}`;
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
  rotation?: number;
  color: string;
  wordIndex: number;
  letterIndex: number;
  delay?: number;
  phase?: number;
  flyFromX?: number;
  flyFromY?: number;
  slamFrom?: number;
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

/** Axis-aligned bounds of a letter set, in normalised frame units. */
function boundsOf(letters: KineticLetter[], metrics: Metrics, aspect: number, tracking: number): Bounds {
  if (!letters.length) return { x0: 0, y0: 0, x1: 0, y1: 0, w: 0, h: 0 };
  const v = metrics.vertical();
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const L of letters) {
    const w = metrics.advance(L.ch) * L.nSize * tracking;
    const up = (v.ascent * L.nSize) / aspect;
    const down = (v.descent * L.nSize) / aspect;
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
  tracking: number,
  k: number,
): void {
  if (!letters.length || k === 1) return;
  const b = boundsOf(letters, metrics, aspect, tracking);
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  for (const L of letters) {
    L.nx = cx + (L.nx - cx) * k;
    L.ny = cy + (L.ny - cy) * k;
    L.nSize *= k;
  }
}

function fitToSafeArea(
  letters: KineticLetter[],
  metrics: Metrics,
  aspect: number,
  tracking: number,
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
  const b = boundsOf(letters, metrics, aspect, tracking);
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
    L.nSize *= k;
  }

  // Re-measure and nudge fully inside the margins. A composition the user grew
  // past the safe area gets a correspondingly smaller margin, so it centres
  // instead of being shoved against one edge with the other side off-frame.
  const b2 = boundsOf(letters, metrics, aspect, tracking);
  const mx = Math.max(0, Math.min(safe.x, (1 - b2.w) / 2));
  const my = Math.max(0, Math.min(safe.y, (1 - b2.h) / 2));
  let dx = 0;
  let dy = 0;
  if (b2.x0 < mx) dx = mx - b2.x0;
  else if (b2.x1 > 1 - mx) dx = 1 - mx - b2.x1;
  if (b2.y0 < my) dy = my - b2.y0;
  else if (b2.y1 > 1 - my) dy = 1 - my - b2.y1;
  if (dx || dy) for (const L of letters) { L.nx += dx; L.ny += dy; }

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
  /** Already uppercased words for this one caption. */
  words: string[];
  rng: Rng;
  metrics: Metrics;
  /** style.highlightColor — the accent. */
  accentColor: string;
  /** style.color — the base/plain letter colour. */
  baseColor: string;
  /** Indices of words the emphasis agent marked 'hero'. */
  heroWords: Set<number>;
  /** frameHeight / frameWidth. */
  aspect: number;
}

interface KineticTemplateDef {
  label: string;
  tracking: number;
  entryMs: number;
  shakeMs?: number;
  build(args: BuildArgs): KineticLetter[];
  animate(L: KineticLetter, t: number): void;
  paint(ctx: TextCtx, L: KineticLetter, size: number): void;
}

/**
 * A hero word is scaled up and forced to the accent colour. This is how the
 * project's existing AI emphasis (one 'hero' per caption, emphasis.service.ts)
 * drives these templates — there is no separate trigger-word system.
 */
const HERO_SCALE = 1.25;

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

    build({ words, rng, accentColor, baseColor, heroWords }) {
      const out: KineticLetter[] = [];
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
};

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
  template: typeof KINETIC_TEMPLATE_ID;
  frame: { W: number; H: number };
  /** Per-look font fingerprint — compare with the other renderer's to prove
   *  both sides measured the same faces. */
  fingerprints: Partial<Record<KineticLook, number>>;
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
  /** style.highlightColor */
  accentColor: string;
  /** style.color */
  baseColor: string;
  frame: { W: number; H: number };
  /**
   * Metrics for one look's face. Looks use different faces (glitchSplit is
   * Orbitron, the rest Bebas Neue), and a caption laid out with the wrong
   * face's advances overlaps its own letters — so metrics are per look, not
   * per composition. Callers should cache: this is called once per caption.
   */
  metricsFor: (look: KineticLook) => Metrics;
  /** The renderer's name for a look's face (a CSS stack in the browser, a
   *  registered alias on the server). */
  fontFor: (look: KineticLook) => { family: string; weight: number };
  /**
   * Global size multiplier from style.fontSize / KINETIC_BASE_FONT_SIZE.
   * 1 = as designed. Composes with each caption's own sizeScale.
   */
  fontScale?: number;
  safeArea?: { x: number; y: number };
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
  accentColor,
  baseColor,
  frame,
  metricsFor,
  fontFor,
  fontScale = 1,
  safeArea = KINETIC_SAFE_AREA,
}: BuildCompositionArgs): KineticComposition {
  const aspect = frame.H / frame.W;
  const fingerprints: Partial<Record<KineticLook, number>> = {};
  const recentLooks: KineticLook[] = [];

  const scenes: KineticScene[] = captions.map((c, gi) => {
    const words = c.text.trim().split(/\s+/).filter(Boolean).map((w) => w.toUpperCase());

    // Each caption gets its own deterministic stream, seeded from its own
    // content — so editing caption 3 never reshuffles caption 1.
    const rng = makeRng(seedForCaption(KINETIC_TEMPLATE_ID, c.text, c.sequence ?? gi));

    const look = pickKineticLook(words.length, rng, recentLooks);
    recentLooks.push(look);

    const tmpl = KINETIC_TEMPLATES[look];
    const metrics = metricsFor(look);
    const font = fontFor(look);
    if (fingerprints[look] === undefined) fingerprints[look] = metrics.fingerprint();

    const heroWords = kineticHeroWordIndices(words, c.emphasis ?? []);

    let letters = words.length
      ? tmpl.build({ words, rng, metrics, accentColor, baseColor, heroWords, aspect })
      : [];

    // Global slider x this chunk's own override, applied about the
    // composition's centre so the look's geometry scales as one piece.
    const chunkScale =
      typeof c.sizeScale === 'number' && Number.isFinite(c.sizeScale) ? c.sizeScale / 100 : 1;
    const scale = Math.max(0.1, fontScale * chunkScale);
    scaleAbout(letters, metrics, aspect, tmpl.tracking, scale);

    letters = fitToSafeArea(letters, metrics, aspect, tmpl.tracking, safeArea, scale);
    letters.forEach((L, i) => {
      L._i = i;
    });

    const maxDelay = letters.reduce((m, L) => Math.max(m, L.delay), 0);
    const b = boundsOf(letters, metrics, aspect, tmpl.tracking);
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
    template: KINETIC_TEMPLATE_ID,
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
    const tMs = (timeSec - scene.start) * 1000;
    if (tMs < 0) continue;
    // A caption always lives long enough to finish its own entry animation,
    // otherwise a short caption would cut off mid-slam.
    const lifeMs = Math.max((scene.end - scene.start) * 1000, scene.animMs) + KINETIC_HOLD_MS;
    if (tMs > lifeMs + KINETIC_EXIT_MS) continue;
    const exit = tMs > lifeMs ? clamp((tMs - lifeMs) / KINETIC_EXIT_MS, 0, 1) : 0;
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
        const e = EASE.cubicOut(exit);
        L._alpha = 1 - e;
        L._scale *= 1 - e * 0.25;
        L._y -= e * L.nSize * 0.06;
      }

      const size = L.nSize * W * L._scale;
      if (size < 0.6 || L._alpha <= 0.005) continue;

      ctx.save();
      ctx.globalAlpha = L._alpha;
      ctx.translate((L._x + shift.dx) * W, (L._y + shift.dy) * H);
      if (L.rotation) ctx.rotate(L.rotation * DEG);

      // Scale is baked into the font size rather than applied as a transform,
      // so glyphs rasterise at their true size (sharper) and every em-based
      // offset inside paint() stays in real pixels.
      applyTextContext(ctx, `${scene.fontWeight} ${size}px ${scene.fontFamily}`);
      tmpl.paint(ctx, L, size);

      ctx.restore();
    }
  }
}
