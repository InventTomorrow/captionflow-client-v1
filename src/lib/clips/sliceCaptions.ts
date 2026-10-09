/**
 * clips/sliceCaptions.ts — cut the project's canonical captions down to one
 * clip's time range and rebase them so the clip starts at 0.
 *
 * Works on canonical Caption[] (not display captions) so every downstream
 * consumer — the layout compiler, the kinetic composition, behindWindows —
 * sees clip-relative times that line up with Mediabunny's trimmed timestamps.
 * A caption straddling a boundary is cut at word level, so the first frame of
 * a clip never shows the tail of a sentence from before it.
 */

import type { Caption, WordRole, WordStyle } from '../../stores/captionStore';
import { wordTimes } from '../displayCaptions';

export function sliceCaptionsToRange(captions: Caption[], start: number, end: number): Caption[] {
  const out: Caption[] = [];
  const ordered = [...captions].sort((a, b) => a.start - b.start || a.sequence - b.sequence);

  for (const c of ordered) {
    if (c.end <= start || c.start >= end) continue;
    const tokens = c.text.split(/\s+/).filter(Boolean);
    const times = wordTimes(c);
    const kept = tokens.map((_, i) => i).filter((i) => times[i].end > start && times[i].start < end);
    if (!kept.length) continue;

    const rebase = (t: number) => Math.min(end, Math.max(start, t)) - start;
    const words = kept.map((i) => ({
      word: tokens[i],
      start: rebase(times[i].start),
      end: rebase(times[i].end),
    }));
    const whole = kept.length === tokens.length;

    out.push({
      ...c,
      sequence: out.length + 1,
      start: words[0].start,
      end: words[words.length - 1].end,
      text: words.map((w) => w.word).join(' '),
      // A cut caption no longer matches what it was before translation/edit.
      originalText: whole ? c.originalText : undefined,
      words,
      emphasis: c.emphasis ? kept.map((i): WordRole => c.emphasis?.[i] ?? 'auto') : c.emphasis,
      wordStyles: c.wordStyles ? kept.map((i): WordStyle => c.wordStyles?.[i] ?? {}) : c.wordStyles,
    });
  }
  return out;
}
