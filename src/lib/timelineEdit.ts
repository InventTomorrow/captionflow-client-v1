/**
 * Editing the timeline by hand: adding a chunk, and dragging one to another
 * time. Pure functions — the editor owns the pointer handling and the saving.
 *
 * Two layers are involved, and keeping them apart is the whole job here:
 *
 *   BLOCKS     what the timeline draws — display captions regrouped from the
 *              word stream on every render (displayCaptions.ts). They are
 *              derived, never stored, and one block can be made of words from
 *              several stored captions, or of only part of one.
 *   CAPTIONS   what is stored (IndexedDB) and sent to the export.
 *
 * So "move this block" cannot be a field update. It is: work out where every
 * block ends up (resolveMove), then rewrite the stored captions so the regroup
 * produces exactly that (applyBlockMoves) — each block whose time changed is
 * lifted out of the captions its words came from into a caption of its own,
 * marked `ownBlock` so the regroup can never fold it into a neighbour.
 *
 * Stored captions stay sorted by start and non-overlapping throughout: the
 * active-caption lookup is a binary search that depends on it.
 */

import type { Caption, WordRole, WordStyle } from '../stores/captionStore';
import { deriveDisplayCaptions, wordTimes, type DisplayCaption } from './displayCaptions';

/** A block's place on the timeline, in seconds. */
export interface BlockSpan {
  id: string;
  start: number;
  end: number;
}

/** A new chunk is this long when there is room for it. */
export const NEW_BLOCK_SECONDS = 1.5;
/** …and is not offered a gap shorter than this. */
export const MIN_NEW_BLOCK_SECONDS = 0.4;
export const NEW_BLOCK_TEXT = 'New caption';

/** Time differences below this are "did not move". */
const EPS = 1e-3;

const center = (b: BlockSpan) => (b.start + b.end) / 2;
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));
const tokens = (text: string) => text.split(/\s+/).filter(Boolean);

/**
 * Where everything lands when `movedId` is dropped with its left edge at
 * `desiredStart`. Returns the new start of every block that has to change —
 * the dragged one, plus any it displaces; empty when the drop changes nothing.
 *
 * The rules, which are also what the live preview shows while dragging:
 *
 *  - Order is decided by centres: the dragged block goes after every block
 *    whose centre it has passed. Until it passes a neighbour's centre, that
 *    neighbour holds its ground and the block snaps back against it.
 *  - Dropped on free space, it simply sits there; nothing else moves.
 *  - Dropped onto other blocks, it is inserted at that point, and the blocks
 *    BETWEEN its old place and its new one slide toward the hole it left —
 *    each only as far as it must. Blocks outside that stretch never move, so
 *    nothing is pushed past the end of the video and the rest of the captions
 *    keep their timing.
 */
export function resolveMove(
  blocks: BlockSpan[],
  movedId: string,
  desiredStart: number,
  maxEnd: number,
): Map<string, number> {
  const out = new Map<string, number>();
  const moved = blocks.find((b) => b.id === movedId);
  if (!moved) return out;

  const d = moved.end - moved.start;
  const others = blocks.filter((b) => b.id !== movedId).sort((a, b) => a.start - b.start);
  // A block already hanging past the end may stay there; it is never pushed further.
  const limitEnd = Math.max(maxEnd, moved.end);
  let s = clamp(desiredStart, 0, limitEnd - d);
  const m = s + d / 2;
  const before = others.filter((b) => center(b) < m);
  const after = others.filter((b) => center(b) >= m);
  const setIfMoved = (b: BlockSpan, start: number) => {
    if (Math.abs(start - b.start) > EPS) out.set(b.id, start);
  };

  if (s >= moved.start) {
    // Moving right. Blocks it has passed (between the hole and here) slide left.
    const passed = before.filter((b) => b.start >= moved.start - EPS);
    const room = passed.reduce((sum, b) => sum + (b.end - b.start), 0);
    const ceiling = after.length ? after[0].start - d : limitEnd - d;
    // Far enough right that everything it passed fits in behind it; never into
    // what follows. (The first bound cannot exceed the second: the passed blocks
    // all sat between the hole and `after[0]` to begin with.)
    s = Math.min(Math.max(s, moved.start + room), Math.max(ceiling, moved.start));
    let limit = s;
    for (let i = passed.length - 1; i >= 0; i--) {
      const b = passed[i];
      const end = Math.min(b.end, limit);
      const start = Math.max(0, end - (b.end - b.start));
      setIfMoved(b, start);
      limit = start;
    }
  } else {
    // Moving left. Blocks it has passed slide right, into the hole.
    const passed = after.filter((b) => b.end <= moved.end + EPS);
    const room = passed.reduce((sum, b) => sum + (b.end - b.start), 0);
    const floor = before.length ? before[before.length - 1].end : 0;
    s = Math.max(Math.min(s, moved.end - room - d), Math.min(floor, moved.start));
    let limit = s + d;
    for (const b of passed) {
      const start = Math.max(b.start, limit);
      setIfMoved(b, start);
      limit = start + (b.end - b.start);
    }
  }

  setIfMoved(moved, s);
  return out;
}

/**
 * Room for a new chunk, as near to `at` (the playhead) as there is any: inside
 * the gap `at` falls in when that gap is big enough, otherwise the nearest gap
 * that is. Null when the captions leave no usable gap anywhere.
 */
export function findFreeSlot(
  blocks: BlockSpan[],
  at: number,
  maxEnd: number,
): { start: number; end: number } | null {
  const sorted = [...blocks].sort((a, b) => a.start - b.start);
  const gaps: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const b of sorted) {
    if (b.start - cursor >= MIN_NEW_BLOCK_SECONDS) gaps.push({ start: cursor, end: b.start });
    cursor = Math.max(cursor, b.end);
  }
  if (maxEnd - cursor >= MIN_NEW_BLOCK_SECONDS) gaps.push({ start: cursor, end: maxEnd });

  let best: { start: number; end: number; distance: number } | null = null;
  for (const gap of gaps) {
    let start: number;
    // The playhead is where it was asked for, so it starts there whenever the
    // gap leaves a usable length after it — shorter than the default is fine.
    if (at >= gap.start && at <= gap.end - MIN_NEW_BLOCK_SECONDS) start = at;
    else if (at < gap.start) start = gap.start;
    else start = Math.max(gap.start, gap.end - NEW_BLOCK_SECONDS);
    const end = Math.min(gap.end, start + NEW_BLOCK_SECONDS);
    const distance = Math.abs(start - at);
    if (!best || distance < best.distance - EPS) best = { start, end, distance };
  }
  return best && { start: best.start, end: best.end };
}

/** A hand-added chunk. No word timings: its words spread evenly over its span. */
export function newCaption(id: string, slot: { start: number; end: number }): Caption {
  return {
    _id: id,
    sequence: 0,
    start: slot.start,
    end: slot.end,
    text: NEW_BLOCK_TEXT,
    ownBlock: true,
  };
}

/** Sorted by start and renumbered — the shape every reader of the list expects. */
export function inTimelineOrder(captions: Caption[]): Caption[] {
  return [...captions]
    .sort((a, b) => a.start - b.start || a.sequence - b.sequence)
    .map((c, i) => ({ ...c, sequence: i + 1 }));
}

/**
 * Rewrite the stored captions so that each block in `moves` (block id → new
 * start) shows at its new time, keeping its words, per-word timing, emphasis,
 * styles and whole-chunk overrides — and every OTHER block shows exactly as it
 * did. `blocks` must be the timeline's blocks derived from these same
 * `captions` with the same `phraseWords`.
 *
 * The second half of that promise needs checking rather than assuming. Taking a
 * block away changes what its old neighbours sit next to, and the regroup's
 * "no lone words" pass can then glue a stray word onto a different neighbour
 * across the hole — a chunk nobody touched changes its text. So the result is
 * re-derived and compared, and any block that came out different is pinned
 * where it stands (lifted into its own `ownBlock` caption, time unchanged) and
 * the rewrite redone. Each pass pins at least one more block, so it ends.
 */
export function applyBlockMoves(
  captions: Caption[],
  blocks: DisplayCaption[],
  moves: Map<string, number>,
  newId: () => string,
  phraseWords: number,
): Caption[] {
  if (!moves.size) return captions;
  const placed = new Map(moves);
  const key = (text: string, start: number) => `${Math.round(start * 1000)}|${text}`;

  for (let pass = 0; ; pass++) {
    const next = rewrite(captions, blocks, placed, newId);
    const shown = new Set(
      deriveDisplayCaptions(next, 'phrase', phraseWords).map((b) => key(b.text, b.start)),
    );
    const drifted = blocks.filter(
      (b) => b._id && !placed.has(b._id) && !shown.has(key(b.text, b.start)),
    );
    if (!drifted.length || pass >= blocks.length) return next;
    for (const b of drifted) placed.set(b._id as string, b.start);
  }
}

function rewrite(
  captions: Caption[],
  blocks: DisplayCaption[],
  moves: Map<string, number>,
  newId: () => string,
): Caption[] {
  const byId = new Map<string, Caption>();
  for (const c of captions) if (c._id) byId.set(c._id, c);

  /** Stored captions shifted in place (the block was exactly that caption). */
  const shifted = new Map<string, Caption>();
  /** Word indexes lifted out of a stored caption, by caption id. */
  const lifted = new Map<string, Set<number>>();
  const created: Caption[] = [];

  for (const block of blocks) {
    const newStart = block._id ? moves.get(block._id) : undefined;
    if (newStart == null) continue;
    const sources = block.wordSources ?? [];
    if (!sources.length) continue;

    const delta = newStart - block.start;
    // The width that was dragged is the width that lands: a block's drawn end
    // can be later than its last word's (captions hold through short gaps), so
    // the last word is stretched to it rather than letting the block shrink.
    const newEnd = newStart + (block.end - block.start);
    const moveWords = (words: NonNullable<Caption['words']>) =>
      words.map((w, i) => ({
        word: w.word,
        start: w.start + delta,
        end: i === words.length - 1 ? newEnd : w.end + delta,
      }));

    const soleId = block.sourceIds?.length === 1 ? block.sourceIds[0] : undefined;
    const sole = soleId ? byId.get(soleId) : undefined;
    if (sole && soleId && tokens(sole.text).length === sources.length) {
      // The block IS one stored caption — move that, and keep its id so a
      // selection in the Phrases panel survives the drag.
      const aligned = sole.words && sole.words.length === sources.length;
      shifted.set(soleId, {
        ...sole,
        start: newStart,
        end: newEnd,
        words: aligned && sole.words ? moveWords(sole.words) : undefined,
        ownBlock: true,
      });
      continue;
    }

    for (const w of sources) {
      if (!w.sourceId) continue;
      const set = lifted.get(w.sourceId) ?? new Set<number>();
      set.add(w.sourceIndex);
      lifted.set(w.sourceId, set);
    }
    created.push({
      _id: newId(),
      sequence: 0,
      start: newStart,
      end: newEnd,
      text: block.text,
      words: block.words ? moveWords(block.words) : undefined,
      emphasis: block.emphasis,
      wordStyles: block.wordStyles,
      sizeScale: block.sizeScale ?? null,
      offsetX: block.offsetX ?? null,
      offsetY: block.offsetY ?? null,
      behindPerson: block.behindPerson ?? null,
      ownBlock: true,
    });
  }

  const next: Caption[] = [...created];
  for (const c of captions) {
    const moved = c._id ? shifted.get(c._id) : undefined;
    if (moved) {
      next.push(moved);
      continue;
    }
    const gone = c._id ? lifted.get(c._id) : undefined;
    if (!gone) {
      next.push(c);
      continue;
    }
    next.push(...remainders(c, gone, newId));
  }
  return inTimelineOrder(next);
}

/**
 * What is left of a stored caption once some of its words were lifted out: one
 * caption per unbroken run of remaining words (a block taken from the middle
 * leaves a head and a tail, which must not be one caption spanning the hole —
 * the moved block may be dropped right back into it). Each word keeps the exact
 * time it had, written out explicitly so nothing re-spreads.
 */
function remainders(c: Caption, gone: Set<number>, newId: () => string): Caption[] {
  const words = tokens(c.text);
  const times = wordTimes(c);
  const runs: number[][] = [];
  words.forEach((_, i) => {
    if (gone.has(i)) return;
    const run = runs[runs.length - 1];
    if (run && run[run.length - 1] === i - 1) run.push(i);
    else runs.push([i]);
  });

  return runs.map((run, r) => ({
    ...c,
    // The first run keeps the id; "Reset caption" would bring the lifted words
    // back, so what the text was before is dropped.
    _id: r === 0 ? c._id : newId(),
    originalText: undefined,
    start: times[run[0]].start,
    end: times[run[run.length - 1]].end,
    text: run.map((i) => words[i]).join(' '),
    words: run.map((i) => ({ word: words[i], start: times[i].start, end: times[i].end })),
    emphasis: c.emphasis ? run.map((i): WordRole => c.emphasis?.[i] ?? 'auto') : c.emphasis,
    wordStyles: c.wordStyles ? run.map((i): WordStyle => c.wordStyles?.[i] ?? {}) : c.wordStyles,
  }));
}
