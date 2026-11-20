/**
 * TrimNudger — move a clip's in/out point by whole sentences, so a clip always
 * starts and ends on a clean sentence boundary. The server recomputes the
 * exact padded times from the transcript; this only picks sentence indices.
 */
import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { formatClipLength } from '../../lib/clips/clipMath';

const PAD = 0.25 + 0.35;
const MIN_SEC = 5;
const MAX_SEC = 180;

export function TrimNudger({
  startIdx,
  endIdx,
  sentences,
  busy,
  startText,
  endText,
  onChange,
}: {
  startIdx: number;
  endIdx: number;
  sentences: Array<[number, number]>;
  busy?: boolean;
  /** The clip's first and last sentence, so each nudge says what it moves. */
  startText?: string;
  endText?: string;
  onChange(startIdx: number, endIdx: number): void;
}) {
  const last = sentences.length - 1;
  const len = (a: number, b: number) => (sentences[b]?.[1] ?? 0) - (sentences[a]?.[0] ?? 0) + PAD;
  const ok = (a: number, b: number) =>
    a >= 0 && b <= last && a <= b && len(a, b) >= MIN_SEC && len(a, b) <= MAX_SEC;
  const nudge = (label: string, glyph: ReactNode, a: number, b: number) => (
    <button
      type="button"
      className="btn ghost clip-nudge"
      disabled={busy || !ok(a, b)}
      onClick={() => onChange(a, b)}
      aria-label={label}
      title={label}
    >
      {glyph}
    </button>
  );
  const point = (name: string, at: number | undefined, text: string | undefined, earlier: ReactNode, later: ReactNode) => (
    <div className="clip-trim-point" role="group" aria-label={name}>
      <div className="clip-trim-point-head">
        <span className="clip-trim-name">{name}</span>
        {at !== undefined && <span className="clip-trim-at">{formatClipLength(at)}</span>}
        <span className="clip-trim-nudges">
          {earlier}
          {later}
        </span>
      </div>
      {text && (
        <q className="clip-trim-text" dir="auto" title={text}>
          {text}
        </q>
      )}
    </div>
  );
  return (
    <div className="clip-trim" role="group" aria-label="Trim by sentence">
      {point(
        'Start',
        sentences[startIdx]?.[0],
        startText,
        nudge('Start earlier (add the previous sentence)', <CaretLeft size={16} weight="bold" aria-hidden="true" />, startIdx - 1, endIdx),
        nudge('Start later (drop the first sentence)', <CaretRight size={16} weight="bold" aria-hidden="true" />, startIdx + 1, endIdx),
      )}
      {point(
        'End',
        sentences[endIdx]?.[1],
        endText,
        nudge('End earlier (drop the last sentence)', <CaretLeft size={16} weight="bold" aria-hidden="true" />, startIdx, endIdx - 1),
        nudge('End later (add the next sentence)', <CaretRight size={16} weight="bold" aria-hidden="true" />, startIdx, endIdx + 1),
      )}
      <p className="clip-trim-len" aria-live="polite">
        Length <strong>{formatClipLength(len(startIdx, endIdx))}</strong>
      </p>
    </div>
  );
}
