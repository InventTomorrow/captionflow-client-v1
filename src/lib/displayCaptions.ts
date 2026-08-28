import type { Caption, WordRole, WordStyle } from '../stores/captionStore';

/**
 * Display templates — how captions appear on the video. All of them are
 * derived CLIENT-SIDE from the canonical captions (phrases with word
 * timings), so switching templates never re-generates captions or spends
 * API credits.
 */
export type DisplayMode =
  | 'word'
  | 'karaoke'
  | 'phrase'
  | 'sentence'
  | 'popOn'
  | 'rolling'
  | 'paintOn'
  | 'typewriter';

export const DISPLAY_MODES: DisplayMode[] = [
  'word',
  'karaoke',
  'phrase',
  'sentence',
  'popOn',
  'rolling',
  'paintOn',
  'typewriter',
];

/** Map legacy server captionMode settings to a display template. */
export function legacyModeToDisplay(mode?: string): DisplayMode {
  switch (mode) {
    case 'word':
      return 'word';
    case 'sentence':
      return 'sentence';
    case 'progressive':
      return 'paintOn';
    case 'batch':
      return 'phrase';
    default:
      return 'karaoke';
  }
}

/**
 * A caption derived for display. `sourceId`/`wordOffset` link every derived
 * caption back to the canonical caption it came from, so word clicks and
 * inline edits still target the real, saved caption.
 */
export interface DisplayCaption extends Caption {
  /** Canonical caption id, when this display caption comes from exactly one. */
  sourceId?: string;
  /** Index of this display caption's first word within the source caption. */
  wordOffset?: number;
  /** Every distinct canonical caption id contributing a word to this display
   *  caption — used by whole-chunk resize to write sizeScale to all of them,
   *  even when a display caption spans more than one canonical caption. */
  sourceIds?: string[];
  /**
   * Per-word (aligned with `text.split(whitespace)`) canonical caption id +
   * word index. `sourceId`/`wordOffset` above only cover the common single-
   * source case; grouping flattens words across canonical caption boundaries
   * (a pause/word-count break rarely lines up with where one canonical
   * caption ends), so most on-screen blocks actually span more than one —
   * this is what lets a click on ANY word (e.g. to delete it) resolve back
   * to its real source caption + index regardless of grouping.
   */
  wordSources?: Array<{ sourceId?: string; sourceIndex: number }>;
}

interface FlatWord {
  text: string;
  start: number;
  end: number;
  role: WordRole;
  style?: WordStyle;
  sizeScale?: number | null;
  offsetX?: number | null;
  offsetY?: number | null;
  sourceId?: string;
  sourceIndex: number;
}

const SENTENCE_END = /[.!?。！？۔]$/;

/**
 * Per-display-word timings. Uses whisper word timings when they align with
 * the (possibly translated) display text, otherwise spreads words evenly
 * across the caption block — the same fallback the overlay uses.
 */
function wordTimes(caption: Caption): Array<{ start: number; end: number }> {
  const words = caption.text.split(/\s+/).filter(Boolean);
  const timed = caption.words;
  if (timed && timed.length === words.length) {
    return timed.map((w) => ({ start: w.start, end: Math.max(w.end, w.start + 0.12) }));
  }
  const span = Math.max(0.2, caption.end - caption.start);
  const per = span / Math.max(1, words.length);
  return words.map((_, i) => ({
    start: caption.start + per * i,
    end: caption.start + per * (i + 1),
  }));
}

/**
 * Flatten canonical captions into one timed word stream carrying each word's
 * emphasis role and manual style.
 *
 * Legacy "progressive" projects stored cumulative steps ("Hi", "Hi how", …)
 * as separate captions; steps of one build-up share their first word's
 * timing, so only the last (complete) step of each run is kept.
 */
export function flattenToWords(captions: Caption[]): FlatWord[] {
  const canonical: Caption[] = [];
  for (let i = 0; i < captions.length; i++) {
    const cur = captions[i];
    const next = captions[i + 1];
    if (
      next?.words?.length &&
      cur.words?.length &&
      next.words.length > cur.words.length &&
      Math.abs(next.words[0].start - cur.words[0].start) < 0.001
    ) {
      continue; // cumulative build-up step, superseded by the longer one
    }
    canonical.push(cur);
  }

  const out: FlatWord[] = [];
  for (const c of canonical) {
    const words = c.text.split(/\s+/).filter(Boolean);
    const times = wordTimes(c);
    words.forEach((w, i) => {
      out.push({
        text: w,
        start: times[i].start,
        end: times[i].end,
        role: c.emphasis?.[i] ?? 'auto',
        style: c.wordStyles?.[i],
        sizeScale: c.sizeScale,
        offsetX: c.offsetX,
        offsetY: c.offsetY,
        sourceId: c._id,
        sourceIndex: i,
      });
    });
  }
  return out.sort((a, b) => a.start - b.start);
}

function toCaption(words: FlatWord[], sequence: number): DisplayCaption {
  const first = words[0];
  const last = words[words.length - 1];
  const singleSource = first.sourceId != null && words.every((w) => w.sourceId === first.sourceId);
  return {
    _id: `d${sequence}-${first.sourceId ?? 'x'}-${first.sourceIndex}`,
    sequence,
    start: first.start,
    end: Math.max(last.end, first.start + 0.15),
    text: words.map((w) => w.text).join(' '),
    words: words.map((w) => ({ word: w.text, start: w.start, end: w.end })),
    emphasis: words.map((w) => w.role),
    wordStyles: words.map((w) => w.style ?? {}),
    sizeScale: first.sizeScale ?? null,
    offsetX: first.offsetX ?? null,
    offsetY: first.offsetY ?? null,
    sourceId: singleSource ? first.sourceId : undefined,
    wordOffset: singleSource ? first.sourceIndex : undefined,
    sourceIds: Array.from(new Set(words.map((w) => w.sourceId).filter((id): id is string => !!id))),
    wordSources: words.map((w) => ({ sourceId: w.sourceId, sourceIndex: w.sourceIndex })),
  };
}

/** Silence longer than this between two words starts a new caption. */
const MAX_WORD_GAP = 0.9;

/**
 * Group a flat word stream into caption-sized chunks. Groups break at the
 * word budget, sentence punctuation, and real silences — and a cleanup pass
 * glues stray single-word groups onto a neighbor so no caption ever flashes
 * a lone word unless it is truly isolated by silence.
 */
function groupFlatWords(words: FlatWord[], mode: DisplayMode, phraseWords: number): FlatWord[][] {
  if (mode === 'word') {
    // Single words fill the screen on their own — hero/support roles would
    // only fight the display, so they're stripped.
    return words.map((w) => [{ ...w, role: 'auto' as WordRole }]);
  }

  const size = mode === 'sentence' ? 12 : Math.min(12, Math.max(1, phraseWords));
  const groups: FlatWord[][] = [];
  let cur: FlatWord[] = [];
  for (const w of words) {
    if (cur.length && w.start - cur[cur.length - 1].end > MAX_WORD_GAP) {
      groups.push(cur);
      cur = [];
    }
    cur.push(w);
    if (cur.length >= size || SENTENCE_END.test(w.text.trim())) {
      groups.push(cur);
      cur = [];
    }
  }
  if (cur.length) groups.push(cur);

  if (size <= 1) return groups;

  // Orphan pass: merge 1-word groups into the closest neighbor when there is
  // no real silence between them.
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    if (g.length > 1) continue;
    const prev = groups[i - 1];
    const next = groups[i + 1];
    const prevGap = prev ? g[0].start - prev[prev.length - 1].end : Infinity;
    const nextGap = next ? next[0].start - g[g.length - 1].end : Infinity;
    const canPrev = prev != null && prevGap <= MAX_WORD_GAP && prev.length + g.length <= size + 1;
    const canNext = next != null && nextGap <= MAX_WORD_GAP && next.length + g.length <= size + 1;
    if (canPrev && (!canNext || prevGap <= nextGap)) {
      prev.push(...g);
      groups.splice(i, 1);
      i -= 1;
    } else if (canNext) {
      next.unshift(...g);
      groups.splice(i, 1);
      i -= 1;
    }
  }
  return groups;
}

/**
 * Build the captions actually shown on the video for the chosen display
 * template. Pure and instant — no server involved.
 */
export function deriveDisplayCaptions(
  captions: Caption[],
  mode: DisplayMode,
  phraseWords = 5,
): DisplayCaption[] {
  const words = flattenToWords(captions);
  if (!words.length) return [];

  const groups = groupFlatWords(words, mode, phraseWords);
  const result = groups.map((g, i) => toCaption(g, i + 1));

  // Hold each caption until the next one starts when the gap is short, so
  // captions don't blink off between words of continuous speech.
  for (let i = 0; i < result.length - 1; i++) {
    const gap = result[i + 1].start - result[i].end;
    if (gap > 0 && gap < 0.6) result[i].end = result[i + 1].start;
  }
  return result;
}
