import {
  Fragment,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react';
import { AnimatePresence, motion, type Variants } from 'framer-motion';
import type { Caption, WordStyle } from '../stores/captionStore';
import type { DisplayCaption, DisplayMode } from '../lib/displayCaptions';
import { resolveCaptionAnchor } from '../lib/captionPosition';

export type CaptionTemplate =
  | 'classic'
  | 'hero'
  | 'stack'
  | 'bigpop'
  | 'highlight'
  | 'heroWord'
  | 'mixed'
  | 'mixed2'
  // Ported from CaptionTemplates.jsx — preview-only kinetic looks (see
  // CAPTION_TEMPLATE.md: no ASS/export counterpart yet, so these do not
  // appear in the burned-in export, only the live preview).
  | 'editorMasala'
  | 'aura'
  | 'swiss'
  | 'theBigRed'
  | 'scribble'
  | 'archives'
  // Per-letter kinetic typography. 'animeEdit' is ONE template with five
  // internal looks intercut per caption (see lib/kinetic/engine.ts →
  // pickKineticLook), the same one-id/many-sub-looks shape as mixed/mixed2;
  // 'blockbuster' is the same engine drawing one fixed two-line look.
  //
  // Neither renders through this component at all — EditorPage swaps in
  // <KineticCaptionLayer>, a full-frame canvas, because they position every
  // letter independently across the whole frame rather than inside the caption
  // box. Layout + animation live in lib/kinetic/engine.ts, which the burn-in
  // export runs unchanged. See client/src/components/KINETIC_TEMPLATES.md.
  | 'animeEdit'
  | 'blockbuster'
  | 'livingBlue'
  | 'livingTeal'
  | 'livingOrange'
  | 'livingRed'
  | 'livingPurple';

/**
 * Both Mixed Styles sets rotate through this many curated sub-styles, keyed
 * by `caption.sequence % MIXED_STYLE_COUNT` — same rule server-side in
 * export.service.ts (MIXED_STYLE_SPECS / MIXED_STYLE_SPECS_2), so preview and
 * burned-in export always pick the same look for the same caption.
 */
export const MIXED_STYLE_COUNT = 8;

export interface OverlayStyle {
  template: CaptionTemplate;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  color: string;
  backgroundColor: string;
  /** Accent color for hero words, karaoke highlight, marks. */
  highlightColor: string;
  /** Karaoke active-word pill (transparent = none). */
  activeFill?: string;
  textTransform?: 'none' | 'uppercase' | 'lowercase';
  position: 'top' | 'center' | 'bottom';
  /** Custom vertical position (% from top, caption center). null = use `position` preset. */
  offsetY: number | null;
  /** Custom horizontal position (% from left, caption center). null = centered. */
  offsetX: number | null;
  animation: string;
}

/**
 * Seconds of lead time when comparing the playhead to caption/word start
 * times, so words land on the beat instead of feeling slightly late.
 */
export const LEAD = 0.09;

/** Binary search for the caption active at time `t` (captions sorted by start). */
export function findActiveCaption(captions: Caption[], t: number): number {
  let lo = 0;
  let hi = captions.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = captions[mid];
    if (t < c.start) hi = mid - 1;
    else if (t >= c.end) lo = mid + 1;
    else return mid;
  }
  return -1;
}

/** Length of a word ignoring punctuation, used to pick the emphasis word. */
function coreLen(word: string) {
  return word.replace(/[^\p{L}\p{N}]/gu, '').length;
}

/**
 * Pick the single HERO word for the hero template (longest core length).
 * One word only — never share a line with neighbours (CapCut / Poetic Stack).
 */
function emphasisHeroIndex(words: string[]): number {
  if (words.length < 2) return -1;
  let bigIdx = 0;
  words.forEach((w, i) => {
    if (coreLen(w) > coreLen(words[bigIdx])) bigIdx = i;
  });
  return bigIdx;
}

/** Exactly one hero + one support index — same rule as export resolveHeroSupportIdx. */
function resolveHeroSupportIdx(
  words: string[],
  roles: Array<string | undefined> = [],
): { heroIdx: number; supportIdx: number } {
  const n = words.length;
  if (n === 0) return { heroIdx: -1, supportIdx: -1 };
  if (n === 1) return { heroIdx: 0, supportIdx: -1 };

  let heroIdx = roles.findIndex((r) => r === 'hero');
  let supportIdx = roles.findIndex((r) => r === 'small');
  const scored = words
    .map((w, i) => ({ i, n: coreLen(w) }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n || a.i - b.i);

  if (heroIdx < 0) heroIdx = scored[0]?.i ?? 0;
  if (supportIdx < 0 || supportIdx === heroIdx) {
    supportIdx = scored.find((x) => x.i !== heroIdx)?.i ?? (heroIdx === 0 ? 1 : 0);
  }
  if (supportIdx === heroIdx) supportIdx = heroIdx === 0 ? 1 : 0;
  return { heroIdx, supportIdx };
}

/**
 * Word indices to emphasize for the imported kinetic templates (Editor
 * Masala / Aura / Swiss / The Big Red / Scribble / Archives) — manual
 * 'hero' roles win, otherwise fall back to the single longest word, same
 * rule as `emphasisHeroIndex`.
 */
function emphasisSet(words: string[], roles: Array<string | undefined> = []): Set<number> {
  const manual: number[] = [];
  roles.forEach((r, i) => {
    if (r === 'hero') manual.push(i);
  });
  if (manual.length) return new Set(manual);
  const idx = emphasisHeroIndex(words);
  return idx >= 0 ? new Set([idx]) : new Set();
}

/**
 * Shrink factor for a hero/keyword string so long words (or a manual
 * multi-word hero selection) don't overflow a narrow 9:16 frame the way a
 * short single demo word never would in the template picker's preview card.
 */
function heroFitScale(text: string): number {
  const len = coreLen(text.replace(/\s+/g, ''));
  if (len <= 5) return 1;
  if (len <= 7) return 0.72;
  if (len <= 9) return 0.55;
  if (len <= 11) return 0.42;
  if (len <= 15) return 0.32;
  return 0.24;
}

/** Inline CSS for one word's manual overrides (size scale % and color). */
function wordInlineStyle(ws?: WordStyle): CSSProperties | undefined {
  if (!ws) return undefined;
  const css: CSSProperties = {};
  if (ws.scale != null && ws.scale !== 100) css.fontSize = `${ws.scale / 100}em`;
  if (ws.color) css.color = ws.color;
  return css.fontSize || css.color ? css : undefined;
}

/**
 * Reveal time for each display word. Uses the whisper word timings when they
 * align with the display text (same word count), otherwise spreads the words
 * evenly across the caption block.
 */
export function wordTimings(caption: Caption): number[] {
  const words = caption.text.split(/\s+/).filter(Boolean);
  const timed = caption.words;
  if (timed && timed.length === words.length) return timed.map((w) => w.start);
  const span = Math.max(0, caption.end - caption.start);
  return words.map((_, i) => caption.start + (span * i) / Math.max(1, words.length));
}

export function countShown(timings: number[], t: number) {
  let n = 0;
  while (n < timings.length && timings[n] <= t) n++;
  return n;
}

/**
 * Typewriter: number of characters (spaces excluded) revealed at time `t`.
 * Each word's characters are spread across that word's time slot.
 */
export function charsShownAt(texts: string[], starts: number[], capEnd: number, t: number): number {
  let n = 0;
  for (let i = 0; i < texts.length; i++) {
    const s = starts[i];
    const e = i + 1 < starts.length ? Math.max(starts[i + 1], s + 0.05) : Math.max(capEnd, s + 0.05);
    const len = texts[i].length;
    if (t >= e) {
      n += len;
      continue;
    }
    if (t <= s) break;
    n += Math.min(len, Math.floor(((t - s) / (e - s)) * (len + 1)));
    break;
  }
  return n;
}

/** Per-word reveal animation, mapped from the Text panel's Animation setting. */
export function makeWordVariants(anim: string): Variants {
  switch (anim) {
    case 'none':
      return { hidden: { opacity: 0 }, shown: { opacity: 1, transition: { duration: 0 } } };
    case 'typewriter':
      return { hidden: { opacity: 0 }, shown: { opacity: 1, transition: { duration: 0.03 } } };
    case 'pop':
      return {
        hidden: { opacity: 0, scale: 0.6 },
        shown: { opacity: 1, scale: 1, transition: { duration: 0.18, ease: 'backOut' } },
      };
    case 'slideUp':
      return {
        hidden: { opacity: 0, y: 12 },
        shown: { opacity: 1, y: 0, transition: { duration: 0.18, ease: 'easeOut' } },
      };
    case 'bounce':
      return {
        hidden: { opacity: 0, scale: 0.6 },
        shown: {
          opacity: 1,
          scale: [0.6, 1.12, 1],
          transition: { duration: 0.3, ease: 'easeOut', times: [0, 0.6, 1] },
        },
      };
    default: // fade
      return {
        hidden: { opacity: 0, y: 4 },
        shown: { opacity: 1, y: 0, transition: { duration: 0.15, ease: 'easeOut' } },
      };
  }
}

/** Enter/exit animation for a whole caption block. */
export function makeBlockVariants(anim: string): Variants {
  const hidden =
    anim === 'pop' || anim === 'bounce'
      ? { opacity: 0, scale: 0.94 }
      : anim === 'slideUp'
        ? { opacity: 0, y: 10 }
        : { opacity: 0 };
  return {
    hidden,
    enter: {
      opacity: 1,
      y: 0,
      scale: 1,
      transition: { duration: anim === 'none' ? 0 : 0.14, ease: 'easeOut' },
    },
    exit: { opacity: 0, transition: { duration: anim === 'none' ? 0 : 0.1, ease: 'easeIn' } },
  };
}

/** How words inside the active caption behave for each display template. */
export function wordBehavior(mode: DisplayMode): 'block' | 'paint' | 'karaoke' {
  if (mode === 'paintOn') return 'paint';
  if (mode === 'karaoke') return 'karaoke';
  return 'block';
}

/**
 * The words of one caption, laid out for its template. Exported so the
 * on-device export (lib/export/layout/compile.tsx) measures the exact markup
 * the preview renders instead of a hand-kept copy of it.
 */
export function CaptionWords({
  caption,
  template,
  behavior,
  visibleCount,
  charsShown,
  variants,
  selectedWord,
  onWordClick,
  onWordDelete,
}: {
  caption: Caption;
  template: CaptionTemplate;
  /** block = all words at once · paint = reveal word-by-word · karaoke = highlight current. */
  behavior: 'block' | 'paint' | 'karaoke';
  visibleCount: number;
  /** Characters revealed so far (typewriter), or null when not typing. */
  charsShown: number | null;
  variants: Variants;
  /** Highlighted word index (being edited), or null. */
  selectedWord: number | null;
  onWordClick: (index: number) => void;
  /** Delete a single word directly from the video (× badge on the selected word). */
  onWordDelete: (index: number) => void;
}) {
  const words = useMemo(() => caption.text.split(/\s+/).filter(Boolean), [caption.text]);
  // Cumulative char offsets (spaces excluded) for the typewriter reveal.
  const charStarts = useMemo(() => {
    let acc = 0;
    return words.map((w) => {
      const s = acc;
      acc += w.length;
      return s;
    });
  }, [words]);

  // Every rendered word goes through this helper so per-word size/color
  // overrides, click-to-edit, and the selection ring work in every template.
  // Words are motion.spans with stable keys: a word that is already visible
  // never re-animates when the next one appears.
  const renderWord = (w: string, i: number, className?: string) => {
    let karaokeCls = '';
    if (behavior === 'karaoke') {
      karaokeCls =
        i === visibleCount - 1 ? 'capw-current' : i < visibleCount ? 'capw-past' : 'capw-future';
    }
    let content: React.ReactNode = w;
    if (charsShown != null) {
      const shown = Math.min(w.length, Math.max(0, charsShown - charStarts[i]));
      content = (
        <>
          {w.slice(0, shown)}
          {/* Hidden remainder keeps the block size stable while typing. */}
          <span className="capw-ghost">{w.slice(shown)}</span>
        </>
      );
    }
    const isSelected = selectedWord === i;
    return (
      <motion.span
        key={i}
        className={`capw ${className || ''} ${karaokeCls} ${
          isSelected ? 'capw-selected' : ''
        }`.trim()}
        style={wordInlineStyle(caption.wordStyles?.[i])}
        data-wi={i}
        variants={variants}
        initial={false}
        animate={behavior === 'paint' && i >= visibleCount ? 'hidden' : 'shown'}
        onClick={(e) => {
          e.stopPropagation();
          onWordClick(i);
        }}
      >
        {content}
        {/* Delete this exact word straight off the video — no trip to the
            Phrases panel needed. Only shown on the word currently selected
            (clicked) so it never crowds the rest of the caption. */}
        {isSelected && (
          <span
            className="capw-delete"
            role="button"
            title="Delete this word"
            onClick={(e) => {
              e.stopPropagation();
              onWordDelete(i);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </span>
        )}
      </motion.span>
    );
  };

  const emphasis = caption.emphasis;

  // Stacked templates own their look — never flatten to plain karaoke words
  // (export burns these as phrase with hero/support sizing).
  const stackedTemplate =
    template === 'heroWord' ||
    template === 'hero' ||
    template === 'stack' ||
    template === 'mixed' ||
    template === 'mixed2' ||
    template === 'editorMasala' ||
    template === 'aura' ||
    template === 'swiss' ||
    template === 'theBigRed' ||
    template === 'scribble' ||
    template === 'archives';

  // Karaoke already highlights the spoken word — skip template emphasis
  // only for non-stacked templates.
  if (behavior === 'karaoke' && !stackedTemplate) {
    return (
      <>
        {words.map((w, i) => (
          <span key={i}>
            {renderWord(w, i)}
            {i < words.length - 1 ? ' ' : ''}
          </span>
        ))}
      </>
    );
  }

  // Hero Word — one hero + one support word at the same large size, the rest
  // small, every word on the same baseline. Reveal is driven by
  // `behavior === 'paint'`: all words are mounted from the first frame at
  // opacity 0, so the block never reflows as they land
  // ("Hi" → "Hi how" → "Hi how are" → "Hi how are you?").
  //
  // Deliberately plain inline layout, NOT flex: libass lays captions out as
  // centered inline text with real spaces between words and a trailing space
  // that hangs at a wrap. Flex + `gap` drifts from that on every wrapped line.
  // The separator is an explicit base-size space in the normal face, matching
  // the `{\fnMontserrat\fs<base>} ` the export writes.
  if (template === 'heroWord') {
    const { heroIdx, supportIdx } = resolveHeroSupportIdx(words, emphasis);
    const isIsolated = (i: number) => i === heroIdx || i === supportIdx;
    return (
      <span className="cap-hw">
        {words.map((w, i) => {
          const kind = i === heroIdx ? 'hero' : i === supportIdx ? 'support' : 'normal';
          const iso = isIsolated(i);
          return (
            <Fragment key={i}>
              {/* Hero AND support each land on their own centered line: a
                  break before and after every isolated word, everything else
                  wraps and centers normally on the lines around them. A break
                  is only skipped when the neighbour is itself isolated and
                  already supplied that same break, so adjacent hero/support
                  words never get a blank line between them. */}
              {iso && i > 0 && !isIsolated(i - 1) && <br />}
              {renderWord(w, i, `cap-hw-word cap-hw-${kind}`)}
              {iso && i < words.length - 1 && <br />}
              {!iso && !isIsolated(i + 1) && i < words.length - 1 && (
                <span className="cap-hw-gap"> </span>
              )}
            </Fragment>
          );
        })}
      </span>
    );
  }

  // Neon Glow / Hero Punch — always one word per line (matches ASS export).
  // Prefer the Phrases-panel hero role when set; else longest core word.
  if (template === 'hero') {
    const roles = emphasis || [];
    let heroIdx = roles.findIndex((r) => r === 'hero');
    if (heroIdx < 0) heroIdx = emphasisHeroIndex(words);
    if (heroIdx < 0) {
      return (
        <>
          {words.map((w, i) => (
            <span key={i}>
              {renderWord(w, i)}
              {i < words.length - 1 ? ' ' : ''}
            </span>
          ))}
        </>
      );
    }
    return (
      <>
        {words.map((w, i) => (
          <div key={i} className={i === heroIdx ? 'cap-big' : 'cap-small'}>
            {renderWord(w, i)}
          </div>
        ))}
      </>
    );
  }

  // Mixed Styles — a different curated look per caption, cycling through
  // MIXED_STYLE_COUNT sub-styles keyed by sequence so two consecutive
  // captions are never the same (fonts/colors/animation live in index.css
  // as `.cap-mixed-0` … `.cap-mixed-7`). Checked before the generic emphasis
  // branch below: hero/support roles are computed for every project
  // regardless of template, and would otherwise hijack Mixed Styles into the
  // Poetic-Stack layout. The longest word gets the keyword accent instead.
  if (template === 'mixed' || template === 'mixed2') {
    const styleIdx =
      ((((caption.sequence ?? 1) - 1) % MIXED_STYLE_COUNT) + MIXED_STYLE_COUNT) %
      MIXED_STYLE_COUNT;
    let keyIdx = -1;
    if (words.length >= 2) {
      keyIdx = 0;
      words.forEach((w, i) => {
        if (coreLen(w) > coreLen(words[keyIdx])) keyIdx = i;
      });
    }
    const prefix = template === 'mixed2' ? 'cap-mixed2' : 'cap-mixed';
    return (
      <span className={`${prefix} ${prefix}-${styleIdx}`}>
        {words.map((w, i) => (
          <span key={i}>
            {renderWord(w, i, i === keyIdx ? `${prefix}-key` : undefined)}
            {i < words.length - 1 ? ' ' : ''}
          </span>
        ))}
      </span>
    );
  }

  // Editor Masala / Aura / Swiss — ported from CaptionTemplates.jsx. Exactly
  // two stacked lines (the rest of the phrase + the single hero/keyword),
  // matching the picker preview's "tiny lead-in + giant shout word" layout
  // regardless of how many words a real transcribed phrase actually has —
  // stacking one line per word (the old behaviour) turned any phrase longer
  // than the preview's two-word demo into a tower of lines that overflowed
  // the frame. Preview-only: no ASS/export counterpart, see CAPTION_TEMPLATE.md.
  if (template === 'editorMasala' || template === 'aura' || template === 'swiss') {
    const emSet = emphasisSet(words, emphasis || []);
    const gap = template === 'swiss' ? 0.1 : template === 'aura' ? 0.14 : 0.13;
    // Base em size of the `-em` (hero/keyword) line, mirrored from the CSS
    // rule of the same name — heroFitScale multiplies it down for long words.
    const heroBaseEm = template === 'editorMasala' ? 1.55 : template === 'aura' ? 1.3 : 1.3;
    const heroLine = words.filter((_, i) => emSet.has(i)).join(' ');
    const restLine = words.filter((_, i) => !emSet.has(i)).join(' ');
    type LineSpec = { key: string; cls: 'em' | 'normal'; text: string; fontSize?: string };
    const heroSpec: LineSpec | null = heroLine
      ? { key: 'hero', cls: 'em', text: heroLine, fontSize: `${heroBaseEm * heroFitScale(heroLine)}em` }
      : null;
    const restSpec: LineSpec | null = restLine ? { key: 'rest', cls: 'normal', text: restLine } : null;
    // Aura's demo leads with the coloured keyword; Editor Masala / Swiss lead
    // with the small line — same order the imported design uses for each.
    const lines = (template === 'aura' ? [heroSpec, restSpec] : [restSpec, heroSpec]).filter(
      (l): l is LineSpec => l != null,
    );
    return (
      <span className={`cap-tpl cap-tpl-${template}`}>
        {lines.map((l, i) => (
          <div
            key={l.key}
            className={`cap-tpl-line cap-tpl-${template}-${l.cls}`}
            style={{ animationDelay: `${i * gap}s`, ...(l.fontSize ? { fontSize: l.fontSize } : null) }}
          >
            {l.text}
          </div>
        ))}
      </span>
    );
  }

  // The Big Red — one monumental hero word with the rest of the phrase as a
  // small caption pill stacked (horizontally centered) below it, with a
  // gap so the pill never crosses into the word. Ported from
  // CaptionTemplates.jsx. The picker preview only ever demos a short single
  // word, so the base 1.9em size overflowed a narrow 9:16 frame for real
  // (longer) transcribed words — heroFitScale shrinks it to fit instead.
  if (template === 'theBigRed') {
    const emSet = emphasisSet(words, emphasis || []);
    const bigIdx = emSet.size ? Math.min(...emSet) : emphasisHeroIndex(words);
    const big = bigIdx >= 0 ? words[bigIdx] : words[0];
    const line = words.filter((_, i) => i !== bigIdx).join(' ');
    return (
      <span className="cap-tpl cap-tpl-theBigRed">
        <span className="cap-tpl-bigred-word" style={{ fontSize: `${1.9 * heroFitScale(big)}em` }}>
          {big}
        </span>
        {line && <span className="cap-tpl-bigred-line">{line}</span>}
      </span>
    );
  }

  // Scribble / Archives — inline flowing words with a highlighter mark
  // (Scribble) or hand underline (Archives) behind the emphasized word(s).
  // Ported from CaptionTemplates.jsx.
  if (template === 'scribble' || template === 'archives') {
    const emSet = emphasisSet(words, emphasis || []);
    const gap = template === 'scribble' ? 0.12 : 0.13;
    return (
      <span className={`cap-tpl cap-tpl-${template}`}>
        {words.map((w, i) => {
          const em = emSet.has(i);
          return (
            <span
              key={i}
              className={`cap-tpl-${template}-word ${em ? `cap-tpl-${template}-em` : ''}`.trim()}
              style={{ animationDelay: `${i * gap}s` }}
            >
              {em && (
                <span
                  className={`cap-tpl-${template}-mark`}
                  style={{ animationDelay: `${i * gap + 0.15}s` }}
                />
              )}
              {w}
            </span>
          );
        })}
      </span>
    );
  }

  // Hero/Support roles are auto-picked for every caption regardless of
  // template (see captionStore.ts), and merging several short transcribed
  // captions into one display block (sentence/phrase mode) can carry more
  // than one leftover hero marker from their separate sources. Only the
  // template branches above/below that are actually DESIGNED around a
  // hero/support look consume `emphasis` at all — every other (plain,
  // single-style) template ignores it entirely and renders flat text, so
  // stray hero markers never surface as unexpected giant/bold words.
  if (template === 'stack') {
    // Poetic Stack beat: small → large serif → tiny → accent caps → …
    return (
      <>
        {words.map((w, i) => (
          <div key={i} className={`cap-stack cap-stack-${i % 4}`}>
            {renderWord(w, i)}
          </div>
        ))}
      </>
    );
  }
  if (template === 'highlight' && words.length >= 2) {
    let bigIdx = 0;
    words.forEach((w, i) => {
      if (coreLen(w) > coreLen(words[bigIdx])) bigIdx = i;
    });
    return (
      <>
        {words.map((w, i) => (
          <span key={i}>
            {renderWord(w, i, i === bigIdx ? 'cap-mark' : undefined)}
            {i < words.length - 1 ? ' ' : ''}
          </span>
        ))}
      </>
    );
  }
  return (
    <>
      {words.map((w, i) => (
        <span key={i}>
          {renderWord(w, i)}
          {i < words.length - 1 ? ' ' : ''}
        </span>
      ))}
    </>
  );
}

interface CaptionOverlayProps {
  captions: DisplayCaption[];
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Video wrapper element, used to convert drag positions into % offsets. */
  wrapRef: RefObject<HTMLDivElement | null>;
  style: OverlayStyle;
  displayMode: DisplayMode;
  /** Canonical caption id whose word is selected in the Phrases panel. */
  selectedCaptionId: string | null;
  /** Word index within the canonical caption. */
  selectedWordIdx: number | null;
  /** Click a word on the video to select it in the Phrases panel. */
  onWordSelect: (caption: DisplayCaption, index: number) => void;
  /** Delete a single word straight off the video preview. */
  onWordDelete: (caption: DisplayCaption, index: number) => void;
  /** Save edited caption text (double-click inline editing). */
  onSaveText: (caption: DisplayCaption, text: string) => void;
  /** Commit a whole-chunk resize and/or reposition: just this caption, or every caption. */
  onChunkStyleCommit: (
    caption: DisplayCaption,
    patch: { sizeScale?: number; offsetX?: number; offsetY?: number },
    scope: 'chunk' | 'all',
  ) => void;
  /** Delete the entire caption chunk currently on screen. */
  onChunkDelete: (caption: DisplayCaption) => void;
}

/**
 * Caption overlay for the video preview.
 *
 * Runs its own requestAnimationFrame loop reading `video.currentTime`
 * directly, so the (large) EditorPage never re-renders at frame rate. React
 * state here only changes when the active caption block changes or a word's
 * visibility flips — everything else is handled by Framer Motion animating
 * opacity/transform on the GPU.
 */
export const CaptionOverlay = memo(function CaptionOverlay({
  captions,
  videoRef,
  wrapRef,
  style,
  displayMode,
  selectedCaptionId,
  selectedWordIdx,
  onWordSelect,
  onWordDelete,
  onSaveText,
  onChunkStyleCommit,
  onChunkDelete,
}: CaptionOverlayProps) {
  const [activeIdx, setActiveIdx] = useState(-1);
  const [visibleCount, setVisibleCount] = useState(0);
  const [charsShown, setCharsShown] = useState(0);
  /**
   * Preview canvas height, tracked so caption size is computed exactly like
   * the export: style.fontSize is authored against a 1080-tall frame, and the
   * burned-in render scales it by frameHeight/1080 — the preview does the
   * same with its own canvas height, so preview and download always match.
   */
  const [wrapH, setWrapH] = useState(0);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setWrapH(el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [wrapRef]);
  /** True while the caption text is being edited directly on the video. */
  const [editing, setEditing] = useState(false);
  /** Grab offset from the caption center, so dragging never snaps/jumps. */
  const dragging = useRef<{ dx: number; dy: number } | null>(null);
  /** Active caption resize gesture: start pointer, starting chunk scale and corner. */
  const resizing = useRef<{ x: number; y: number; startScale: number; sx: number; sy: number } | null>(
    null,
  );
  /**
   * Whole-chunk resize in progress/just-finished: the candidate `sizeScale`
   * for the active caption, applied optimistically to the live preview only.
   * Non-null after a drag ends is what shows the Current Preset / Apply To
   * All toolbar; it is cleared on commit or on any other interaction.
   */
  const [pendingScale, setPendingScale] = useState<number | null>(null);
  /**
   * Whole-chunk reposition in progress/just-finished — same pending/confirm
   * pattern as pendingScale, just for offsetX/offsetY instead of sizeScale.
   */
  const [pendingPosition, setPendingPosition] = useState<{ offsetX: number; offsetY: number } | null>(
    null,
  );
  /** Removes the in-flight resize's/drag's window listeners; cleared once run. */
  const resizeCleanup = useRef<(() => void) | null>(null);
  const dragCleanup = useRef<(() => void) | null>(null);
  useEffect(() => {
    return () => {
      resizeCleanup.current?.();
      dragCleanup.current?.();
    };
  }, []);

  // Live mirrors for the rAF loop (avoids re-subscribing every render).
  const styleLatest = useRef(style);
  styleLatest.current = style;
  const captionsLive = useRef(captions);
  captionsLive.current = captions;
  const modeLive = useRef(displayMode);
  modeLive.current = displayMode;
  /** Per-frame scratch state; React state is only touched when these change. */
  const frame = useRef({
    idx: -1,
    cap: undefined as Caption | undefined,
    timings: [] as number[],
    texts: [] as string[],
    count: 0,
    chars: 0,
  });

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      // Schedule the next frame FIRST: if anything below ever throws, the
      // loop survives instead of silently dying and freezing the captions.
      raf = requestAnimationFrame(tick);
      try {
        const video = videoRef.current;
        const t = (video ? video.currentTime : 0) + LEAD;
        const caps = captionsLive.current;
        const f = frame.current;
        const mode = modeLive.current;
        const idx = findActiveCaption(caps, t);
        const cap = idx >= 0 ? caps[idx] : undefined;
        if (idx !== f.idx || cap !== f.cap) {
          f.idx = idx;
          f.cap = cap;
          f.timings = cap ? wordTimings(cap) : [];
          f.texts = cap ? cap.text.split(/\s+/).filter(Boolean) : [];
          f.count = countShown(f.timings, t);
          f.chars = cap ? charsShownAt(f.texts, f.timings, cap.end, t) : 0;
          setActiveIdx(idx);
          setVisibleCount(f.count);
          setCharsShown(f.chars);
        } else if (cap && (mode === 'paintOn' || mode === 'karaoke')) {
          const count = countShown(f.timings, t);
          if (count !== f.count) {
            f.count = count;
            setVisibleCount(count);
          }
        } else if (cap && mode === 'typewriter') {
          const chars = charsShownAt(f.texts, f.timings, cap.end, t);
          if (chars !== f.chars) {
            f.chars = chars;
            setCharsShown(chars);
          }
        }
      } catch {
        // Skip the bad frame; the next one recovers.
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [videoRef]);

  const active = activeIdx >= 0 && activeIdx < captions.length ? captions[activeIdx] : undefined;
  // A pending (unconfirmed) resize only ever applies to the caption it was
  // started on — discard it the moment a different caption becomes active.
  const activeIdForPending = active?._id;
  useEffect(() => {
    setPendingScale(null);
    setPendingPosition(null);
  }, [activeIdForPending]);
  /** Previous caption, shown dimmed above the current one in Rolling mode. */
  const rollingPrev =
    displayMode === 'rolling' && activeIdx > 0 ? captions[activeIdx - 1] : undefined;
  const wordVariants = useMemo(() => makeWordVariants(style.animation), [style.animation]);
  const blockVariants = useMemo(() => makeBlockVariants(style.animation), [style.animation]);
  // Single coordinate system for preview + export: caption CENTER as % of
  // canvas. A pending drag wins over this chunk's saved override, which
  // wins over the project's shared style position — same fallback chain as
  // sizeScale/pendingScale above.
  const anchor = resolveCaptionAnchor({
    position: style.position,
    offsetX: pendingPosition?.offsetX ?? active?.offsetX ?? style.offsetX,
    offsetY: pendingPosition?.offsetY ?? active?.offsetY ?? style.offsetY,
  });
  const behavior = wordBehavior(displayMode);

  // Templates with a solid background (TikTok Pill, Creator Yellow Box,
  // Cinematic Subtitle, Bubble Candy) paint a pill/box behind the text. That
  // box has to live on its own inner element (.cap-box below), not on the
  // outer .caption-overlay — the outer's `width: max-content` is load-bearing
  // for safe dragging (see its CSS comment) and, once a caption's text is
  // long enough to wrap, max-content clamped by max-width locks the outer to
  // a fixed 90%-of-frame width regardless of how short the wrapped lines
  // actually are. Painting the box directly on that outer stretched it into
  // a full-width rectangle for any multi-line caption — a "justified
  // paragraph" look that only ever matched the picker preview's short,
  // single-line demo text. .cap-box is a normal-flow (non-positioned) child
  // instead, so its own auto width can do a real shrink-to-fit around the
  // actual wrapped lines.
  const hasBox =
    !!style.backgroundColor &&
    style.backgroundColor !== 'transparent' &&
    !/rgba?\([^)]*,\s*0\s*\)/i.test(style.backgroundColor);

  // Selection arrives as (canonical caption id, canonical word index) — match
  // it against this block's own per-word wordSources rather than assuming a
  // single sourceId/wordOffset for the whole block, since a display caption
  // routinely merges words from more than one canonical caption.
  const selectedWordFound =
    active && selectedCaptionId && selectedWordIdx != null
      ? (active.wordSources?.findIndex(
          (w) => w.sourceId === selectedCaptionId && w.sourceIndex === selectedWordIdx,
        ) ?? -1)
      : -1;
  const selectedWord = selectedWordFound >= 0 ? selectedWordFound : null;

  return (
    <AnimatePresence>
      {active && (
        // Outer div owns CapCut-style absolute placement (never animated), so
        // Framer Motion cannot wipe translate(-50%, -50%) and shift the block.
        <div
          key="caption-overlay"
          className={`caption-overlay draggable tpl-${style.template} mode-${displayMode}`}
          title="Drag to move · double-click to edit the text"
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => {
            e.stopPropagation();
            videoRef.current?.pause();
            setEditing(true);
          }}
          onPointerDown={(e) => {
            if (editing) return;
            e.stopPropagation();
            e.preventDefault();
            // Remember where inside the caption the user grabbed, so the box
            // follows the cursor from that point instead of snapping its
            // center under the pointer.
            const box = e.currentTarget.getBoundingClientRect();
            const dx = box.left + box.width / 2 - e.clientX;
            const dy = box.top + box.height / 2 - e.clientY;
            dragging.current = { dx, dy };
            // Window-level listeners (same reasoning as the resize handles
            // above) — setPointerCapture on this element was unreliable in
            // this tree, silently dropping move/up.
            const onMove = (ev: PointerEvent) => {
              if (!dragging.current) return;
              const wrap = wrapRef.current;
              if (!wrap) return;
              const rect = wrap.getBoundingClientRect();
              const clamp = (pct: number) => Math.min(95, Math.max(5, Math.round(pct * 10) / 10));
              const offsetY = clamp(((ev.clientY + dy - rect.top) / rect.height) * 100);
              const offsetX = clamp(((ev.clientX + dx - rect.left) / rect.width) * 100);
              setPendingPosition({ offsetX, offsetY });
            };
            const onUp = () => {
              dragging.current = null;
              window.removeEventListener('pointermove', onMove);
              window.removeEventListener('pointerup', onUp);
              dragCleanup.current = null;
              // Leave pendingPosition set — its presence (along with
              // pendingScale) is what shows the Current Preset / Apply To
              // All toolbar below. Nothing is persisted until the user
              // picks a scope.
            };
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
            dragCleanup.current = onUp;
          }}
          style={{
            fontFamily: style.fontFamily,
            // Same rule as the export: fontSize is 1080-reference, scaled to
            // the actual frame height (here, the preview canvas height), then
            // multiplied by this chunk's own size override (100 = normal) —
            // a pending drag-resize wins over the saved value until committed.
            fontSize: `${Math.max(
              9,
              (style.fontSize *
                ((pendingScale ?? active.sizeScale ?? 100) / 100) *
                (wrapH || 480)) /
                1080,
            )}px`,
            fontWeight: style.fontWeight,
            color: style.color,
            textTransform: style.textTransform && style.textTransform !== 'none'
              ? style.textTransform
              : undefined,
            // Accent used by hero words, karaoke highlight and marks.
            ['--cap-hl' as string]: style.highlightColor || '#FFC43D',
            ['--cap-active-fill' as string]:
              style.activeFill && style.activeFill !== 'transparent'
                ? style.activeFill
                : 'transparent',
            // The .caption-overlay CSS rule's own default padding/radius are
            // for the non-boxed case (drag hover outline hugs plain text).
            // When .cap-box paints a real pill/box below, its own padding IS
            // the box's padding — cancel the outer's here so the drag hover
            // outline still hugs that box exactly, not a padded shell around it.
            padding: hasBox ? 0 : undefined,
            borderRadius: hasBox ? 16 : undefined,
            top: `${anchor.offsetY}%`,
            left: `${anchor.offsetX}%`,
            bottom: 'auto',
            right: 'auto',
            transform: 'translate(-50%, -50%)',
          }}
        >
          {/* The visible box (when this template paints one) plus the resize
              handles/confirm toolbar that anchor to it. display: contents
              when there's no background so it never affects layout — the
              resize handles then anchor to .caption-overlay exactly as
              before, unaffected by this wrapper's presence. */}
          <div
            className="cap-box"
            style={
              hasBox
                ? {
                    display: 'inline-table',
                    position: 'relative',
                    background: style.backgroundColor,
                    borderRadius: 16,
                    padding: '0.45em 0.85em',
                  }
                : { display: 'contents' }
            }
          >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12, ease: 'easeOut' }}
          >
          {editing ? (
            <textarea
              className="caption-edit"
              autoFocus
              defaultValue={active.text}
              rows={2}
              onFocus={(e) => e.currentTarget.select()}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
                if (e.key === 'Escape') {
                  e.currentTarget.value = active.text;
                  e.currentTarget.blur();
                }
              }}
              onBlur={(e) => {
                const text = e.target.value.trim();
                setEditing(false);
                if (text && text !== active.text) onSaveText(active, text);
              }}
            />
          ) : (
            <>
              {rollingPrev && (
                <motion.div
                  key={`roll-${rollingPrev._id}`}
                  className="cap-roll-prev"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 0.45, y: 0 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                >
                  {rollingPrev.text}
                </motion.div>
              )}
              {/* Hard cut between blocks (like CapCut): the new block plays
                  its enter animation, the old one is simply replaced. An
                  AnimatePresence/popLayout crossfade here churned exit
                  animations several times per second in word/karaoke modes
                  and could pile up until the page froze. */}
              <motion.div
                key={active._id ?? `seq-${active.sequence}`}
                className="cap-block"
                variants={blockVariants}
                initial="hidden"
                animate="enter"
              >
                <CaptionWords
                  caption={active}
                  template={style.template}
                  behavior={behavior}
                  visibleCount={visibleCount}
                  charsShown={displayMode === 'typewriter' ? charsShown : null}
                  variants={wordVariants}
                  selectedWord={selectedWord ?? null}
                  onWordClick={(i) => onWordSelect(active, i)}
                  onWordDelete={(i) => onWordDelete(active, i)}
                />
              </motion.div>
            </>
          )}
          </motion.div>
          {!editing &&
            // CapCut-style handles on all four corners: dragging any corner
            // outward scales the text up, inward scales it down.
            (
              [
                { corner: 'nw', sx: -1, sy: -1 },
                { corner: 'ne', sx: 1, sy: -1 },
                { corner: 'sw', sx: -1, sy: 1 },
                { corner: 'se', sx: 1, sy: 1 },
              ] as const
            ).map(({ corner, sx, sy }) => (
              <span
                key={corner}
                className={`caption-resize caption-resize-${corner}`}
                title="Drag to resize the captions"
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  const startX = e.clientX;
                  const startY = e.clientY;
                  const startScale = pendingScale ?? active.sizeScale ?? 100;
                  resizing.current = { x: startX, y: startY, startScale, sx, sy };
                  // Window-level listeners instead of setPointerCapture on this
                  // 14px span — capture-based dragging was silently failing to
                  // fire move/up (likely Framer Motion's own pointer handling
                  // on the ancestor motion.div intercepting it), so the drag
                  // would end with nothing recorded and no toolbar. Global
                  // listeners fire regardless of what element the pointer is
                  // over, which is the standard robust pattern for this.
                  const onMove = (ev: PointerEvent) => {
                    const r = resizing.current;
                    if (!r) return;
                    // Same delta→px projection as before, but applied against
                    // this chunk's own effective size, then converted back to
                    // a sizeScale percentage relative to the base
                    // style.fontSize — this chunk resizes, not the whole
                    // project.
                    const delta = ((ev.clientX - r.x) * r.sx + (ev.clientY - r.y) * r.sy) / 2;
                    const scaled = (delta * 1080) / Math.max(240, wrapH || 480);
                    const startPx = (styleLatest.current.fontSize * r.startScale) / 100;
                    const newPx = Math.min(160, Math.max(16, startPx + scaled));
                    const scale = Math.min(
                      400,
                      Math.max(25, Math.round((newPx / styleLatest.current.fontSize) * 100)),
                    );
                    setPendingScale(scale);
                  };
                  const onUp = () => {
                    resizing.current = null;
                    window.removeEventListener('pointermove', onMove);
                    window.removeEventListener('pointerup', onUp);
                    resizeCleanup.current = null;
                    // Leave pendingScale set — its presence is what shows the
                    // Current Preset / Apply To All toolbar below. Nothing is
                    // persisted until the user picks a scope.
                  };
                  window.addEventListener('pointermove', onMove);
                  window.addEventListener('pointerup', onUp);
                  resizeCleanup.current = onUp;
                }}
              />
            ))}
          {(pendingScale != null || pendingPosition != null) && (
            <div className="caption-resize-confirm" onPointerDown={(e) => e.stopPropagation()}>
              <button
                type="button"
                className="caption-resize-confirm-btn active"
                onClick={(e) => {
                  e.stopPropagation();
                  onChunkStyleCommit(
                    active,
                    {
                      ...(pendingScale != null ? { sizeScale: pendingScale } : {}),
                      ...(pendingPosition ?? {}),
                    },
                    'chunk',
                  );
                  setPendingScale(null);
                  setPendingPosition(null);
                }}
              >
                <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                  <path
                    d="M3 8.5l3 3 7-7"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                Current Preset
              </button>
              <button
                type="button"
                className="caption-resize-confirm-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onChunkStyleCommit(
                    active,
                    {
                      ...(pendingScale != null ? { sizeScale: pendingScale } : {}),
                      ...(pendingPosition ?? {}),
                    },
                    'all',
                  );
                  setPendingScale(null);
                  setPendingPosition(null);
                }}
              >
                Apply To All
              </button>
              <button
                type="button"
                className="caption-resize-confirm-btn danger"
                title="Delete this whole caption chunk"
                onClick={(e) => {
                  e.stopPropagation();
                  onChunkDelete(active);
                  setPendingScale(null);
                  setPendingPosition(null);
                }}
              >
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 7h16M9 7V4h6v3m-8 0 1 13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-13" />
                </svg>
                Delete
              </button>
            </div>
          )}
          </div>
        </div>
      )}
    </AnimatePresence>
  );
});
