/**
 * "What kind of clips do you want?" — optional preferences for the clip finder,
 * shown under the upload / link inputs of Create Short Clips. The textarea grows
 * with its text up to a cap (then scrolls); a blank field changes nothing.
 */
import { useLayoutEffect, useRef } from 'react';
import { CLIP_INSTRUCTIONS_MAX } from '../../lib/clips/clipOptions';

interface Props {
  value: string;
  disabled?: boolean;
  onChange(value: string): void;
}

export function ClipInstructionsField({ value, disabled, onChange }: Props) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  // Grow to fit (CSS caps the height; past it the field scrolls inside).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + (el.offsetHeight - el.clientHeight)}px`;
  }, [value]);

  return (
    <div className="creation-instructions">
      <label htmlFor="clip-instructions">
        <span>What kind of clips do you want?</span>
        <small>Optional</small>
      </label>
      <textarea
        id="clip-instructions"
        ref={ref}
        rows={3}
        value={value}
        maxLength={CLIP_INSTRUCTIONS_MAX}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        placeholder="e.g. Find funny moments, useful tips, strong opinions, or surprising insights that would make engaging short reels."
        aria-describedby="clip-instructions-help"
      />
      <p id="clip-instructions-help">Leave blank and AI will find the best moments.</p>
    </div>
  );
}
