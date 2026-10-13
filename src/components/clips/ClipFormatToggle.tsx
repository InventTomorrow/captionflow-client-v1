/**
 * ClipFormatToggle — a clip's output frame: 9:16 vertical (cropped around the
 * speaker, see ReframeControl) or 16:9 landscape (the whole frame). With
 * `allowKeep`, a third choice leaves each clip's format as it is (bulk edits).
 */
import { Minus, RectangleHorizontal, RectangleVertical } from 'lucide-react';
import type { ClipAspect } from '../../lib/clips/clipMath';

const OPTIONS: Array<{ value: ClipAspect; label: string; hint: string; Icon: typeof RectangleVertical }> = [
  { value: '9:16', label: '9:16 Vertical', hint: 'Shorts, Reels, TikTok — follows the speaker', Icon: RectangleVertical },
  { value: '16:9', label: '16:9 Landscape', hint: 'YouTube, X, LinkedIn — the whole frame', Icon: RectangleHorizontal },
];

interface ClipFormatToggleProps {
  /** undefined = "keep each clip's format" (only with allowKeep). */
  value: ClipAspect | undefined;
  allowKeep?: boolean;
  disabled?: boolean;
  onChange(value: ClipAspect | undefined): void;
}

export function ClipFormatToggle({ value, allowKeep, disabled, onChange }: ClipFormatToggleProps) {
  return (
    <div className="clip-seg clip-format" role="radiogroup" aria-label="Format">
      {allowKeep && (
        <button
          type="button"
          role="radio"
          aria-checked={value === undefined}
          className={`clip-seg-btn${value === undefined ? ' is-on' : ''}`}
          disabled={disabled}
          onClick={() => onChange(undefined)}
          title="Leave each clip's format as it is"
        >
          <Minus size={16} aria-hidden="true" />
          Keep
        </button>
      )}
      {OPTIONS.map(({ value: v, label, hint, Icon }) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          className={`clip-seg-btn${value === v ? ' is-on' : ''}`}
          disabled={disabled}
          onClick={() => onChange(v)}
          title={hint}
        >
          <Icon size={16} aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  );
}
