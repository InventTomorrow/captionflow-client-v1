/**
 * TrimNudger — move a clip's in/out point by whole sentences, so a clip always
 * starts and ends on a clean sentence boundary. The server recomputes the
 * exact padded times from the transcript; this only picks sentence indices.
 */
import { formatClipLength } from '../../lib/clips/clipMath';

const PAD = 0.25 + 0.35;
const MIN_SEC = 5;
const MAX_SEC = 180;

export function TrimNudger({
  startIdx,
  endIdx,
  sentences,
  busy,
  onChange,
}: {
  startIdx: number;
  endIdx: number;
  sentences: Array<[number, number]>;
  busy?: boolean;
  onChange(startIdx: number, endIdx: number): void;
}) {
  const last = sentences.length - 1;
  const len = (a: number, b: number) => (sentences[b]?.[1] ?? 0) - (sentences[a]?.[0] ?? 0) + PAD;
  const ok = (a: number, b: number) =>
    a >= 0 && b <= last && a <= b && len(a, b) >= MIN_SEC && len(a, b) <= MAX_SEC;
  const nudge = (label: string, glyph: string, a: number, b: number) => (
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
  return (
    <div className="clip-trim" role="group" aria-label="Trim by sentence">
      <div className="clip-trim-row">
        <span className="clip-trim-name">Start</span>
        {nudge('Start earlier (add the previous sentence)', '◀', startIdx - 1, endIdx)}
        {nudge('Start later (drop the first sentence)', '▶', startIdx + 1, endIdx)}
      </div>
      <div className="clip-trim-row">
        <span className="clip-trim-name">End</span>
        {nudge('End earlier (drop the last sentence)', '◀', startIdx, endIdx - 1)}
        {nudge('End later (add the next sentence)', '▶', startIdx, endIdx + 1)}
      </div>
      <p className="clip-trim-len">Length {formatClipLength(len(startIdx, endIdx))}</p>
    </div>
  );
}
