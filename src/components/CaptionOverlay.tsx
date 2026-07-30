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
  | 'heroWord';

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
const LEAD = 0.09;

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
function wordTimings(caption: Caption): number[] {
  const words = caption.text.split(/\s+/).filter(Boolean);
  const timed = caption.words;
  if (timed && timed.length === words.length) return timed.map((w) => w.start);
  const span = Math.max(0, caption.end - caption.start);
  return words.map((_, i) => caption.start + (span * i) / Math.max(1, words.length));
}

function countShown(timings: number[], t: number) {
  let n = 0;
  while (n < timings.length && timings[n] <= t) n++;
  return n;
}

/**
 * Typewriter: number of characters (spaces excluded) revealed at time `t`.
 * Each word's characters are spread across that word's time slot.
 */
function charsShownAt(texts: string[], starts: number[], capEnd: number, t: number): number {
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
function makeWordVariants(anim: string): Variants {
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
function makeBlockVariants(anim: string): Variants {
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
function wordBehavior(mode: DisplayMode): 'block' | 'paint' | 'karaoke' {
  if (mode === 'paintOn') return 'paint';
  if (mode === 'karaoke') return 'karaoke';
  return 'block';
}

function CaptionWords({
  caption,
  template,
  behavior,
  visibleCount,
  charsShown,
  variants,
  selectedWord,
  onWordClick,
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
    return (
      <motion.span
        key={i}
        className={`capw ${className || ''} ${karaokeCls} ${
          selectedWord === i ? 'capw-selected' : ''
        }`.trim()}
        style={wordInlineStyle(caption.wordStyles?.[i])}
        variants={variants}
        initial={false}
        animate={behavior === 'paint' && i >= visibleCount ? 'hidden' : 'shown'}
        onClick={(e) => {
          e.stopPropagation();
          onWordClick(i);
        }}
      >
        {content}
      </motion.span>
    );
  };

  const emphasis = caption.emphasis;

  // Stacked templates own their look — never flatten to plain karaoke words
  // (export burns these as phrase with hero/support sizing).
  const stackedTemplate =
    template === 'heroWord' || template === 'hero' || template === 'stack';

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

  // Manual per-word roles override automatic template emphasis.
  // Each word is its own line so a Hero never shares a row with neighbours
  // (matches CapCut / Poetic Stack style from the reference editor).
  if (emphasis && emphasis.some((r) => r && r !== 'auto')) {
    return (
      <span className="cap-custom cap-custom-stack">
        {words.map((w, i) => {
          const role = emphasis[i] && emphasis[i] !== 'auto' ? emphasis[i] : 'normal';
          return (
            <div key={i} className={`cap-line cap-w-${role}`}>
              {renderWord(w, i, `cap-w cap-w-${role}`)}
            </div>
          );
        })}
      </span>
    );
  }
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
  /** Merge a partial style change (drag position / resize font size). */
  onStyleChange: (patch: Partial<OverlayStyle>) => void;
  /** Persist the current style after a drag/resize gesture ends. */
  onStylePersist: () => void;
  /** Save edited caption text (double-click inline editing). */
  onSaveText: (caption: DisplayCaption, text: string) => void;
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
  onStyleChange,
  onStylePersist,
  onSaveText,
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
  /** Active caption resize gesture: start pointer, font size and corner. */
  const resizing = useRef<{ x: number; y: number; size: number; sx: number; sy: number } | null>(
    null,
  );

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
  /** Previous caption, shown dimmed above the current one in Rolling mode. */
  const rollingPrev =
    displayMode === 'rolling' && activeIdx > 0 ? captions[activeIdx - 1] : undefined;
  const wordVariants = useMemo(() => makeWordVariants(style.animation), [style.animation]);
  const blockVariants = useMemo(() => makeBlockVariants(style.animation), [style.animation]);
  // Single coordinate system for preview + export: caption CENTER as % of canvas.
  const anchor = resolveCaptionAnchor(style);
  const behavior = wordBehavior(displayMode);

  // Selection arrives as (canonical caption id, canonical word index); derived
  // display captions map back through sourceId/wordOffset.
  const activeSourceId = active ? (active.sourceId ?? active._id) : null;
  const activeOffset = active?.wordOffset ?? 0;
  const selectedWord =
    active && selectedCaptionId && activeSourceId === selectedCaptionId && selectedWordIdx != null
      ? selectedWordIdx - activeOffset
      : null;

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
            dragging.current = {
              dx: box.left + box.width / 2 - e.clientX,
              dy: box.top + box.height / 2 - e.clientY,
            };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const d = dragging.current;
            if (!d) return;
            const wrap = wrapRef.current;
            if (!wrap) return;
            const rect = wrap.getBoundingClientRect();
            const clamp = (pct: number) => Math.min(95, Math.max(5, Math.round(pct * 10) / 10));
            const offsetY = clamp(((e.clientY + d.dy - rect.top) / rect.height) * 100);
            const offsetX = clamp(((e.clientX + d.dx - rect.left) / rect.width) * 100);
            onStyleChange({ offsetY, offsetX, position: 'center' });
          }}
          onPointerUp={(e) => {
            if (!dragging.current) return;
            dragging.current = null;
            e.currentTarget.releasePointerCapture(e.pointerId);
            onStylePersist();
          }}
          style={{
            fontFamily: style.fontFamily,
            // Same rule as the export: fontSize is 1080-reference, scaled to
            // the actual frame height (here, the preview canvas height).
            fontSize: `${Math.max(9, (style.fontSize * (wrapH || 480)) / 1080)}px`,
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
            // TikTok Pill / boxed captions — only paint when truly opaque.
            background:
              style.backgroundColor &&
              !/rgba?\([^)]*,\s*0\s*\)/i.test(style.backgroundColor) &&
              style.backgroundColor !== 'transparent'
                ? style.backgroundColor
                : undefined,
            borderRadius:
              style.backgroundColor &&
              !/rgba?\([^)]*,\s*0\s*\)/i.test(style.backgroundColor) &&
              style.backgroundColor !== 'transparent'
                ? 16
                : undefined,
            padding:
              style.backgroundColor &&
              !/rgba?\([^)]*,\s*0\s*\)/i.test(style.backgroundColor) &&
              style.backgroundColor !== 'transparent'
                ? '0.45em 0.85em'
                : undefined,
            top: `${anchor.offsetY}%`,
            left: `${anchor.offsetX}%`,
            bottom: 'auto',
            right: 'auto',
            transform: 'translate(-50%, -50%)',
          }}
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
                  resizing.current = {
                    x: e.clientX,
                    y: e.clientY,
                    size: styleLatest.current.fontSize,
                    sx,
                    sy,
                  };
                  e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                  const r = resizing.current;
                  if (!r) return;
                  // Project the drag onto the corner's outward direction, and
                  // convert screen px to 1080-reference units so the caption
                  // edge tracks the cursor 1:1 at any preview size.
                  const delta = ((e.clientX - r.x) * r.sx + (e.clientY - r.y) * r.sy) / 2;
                  const scaled = (delta * 1080) / Math.max(240, wrapH || 480);
                  const fontSize = Math.min(160, Math.max(16, Math.round(r.size + scaled)));
                  onStyleChange({ fontSize });
                }}
                onPointerUp={(e) => {
                  if (!resizing.current) return;
                  resizing.current = null;
                  e.currentTarget.releasePointerCapture(e.pointerId);
                  onStylePersist();
                }}
              />
            ))}
        </div>
      )}
    </AnimatePresence>
  );
});
