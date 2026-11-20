/**
 * ClipOptionsForm — what to look for: clip length and how many. Shared by
 * New Clips and the "Find clips / Re-run" panel.
 */
import { useId } from 'react';
import {
  LENGTH_PRESETS,
  formatLength,
  lengthRange,
  type CustomLength,
  type LengthChoice,
  type LengthUnit,
} from '../../lib/clips/clipOptions';

export function ClipOptionsForm({
  preset,
  custom,
  maxClips,
  disabled,
  onPreset,
  onCustom,
  onMaxClips,
}: {
  preset: LengthChoice;
  custom: CustomLength;
  maxClips: number;
  disabled?: boolean;
  onPreset(p: LengthChoice): void;
  onCustom(c: CustomLength): void;
  onMaxClips(n: number): void;
}) {
  const id = useId();
  const range = preset === 'custom' ? lengthRange('custom', custom) : null;
  const error = range && 'error' in range ? range.error : '';
  const field = (which: 'min' | 'max', label: string) => {
    const unitKey = which === 'min' ? 'minUnit' : 'maxUnit';
    return (
      <label className="clip-length-input">
        <span>{label}</span>
        <span className="clip-length-control">
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            value={custom[which]}
            aria-label={label}
            aria-invalid={!!error}
            aria-describedby={`${id}-length-note`}
            onChange={(e) => onCustom({ ...custom, [which]: e.target.value })}
          />
          <select
            value={custom[unitKey]}
            aria-label={`${label} unit`}
            onChange={(e) => onCustom({ ...custom, [unitKey]: e.target.value as LengthUnit })}
          >
            <option value="s">sec</option>
            <option value="min">min</option>
          </select>
        </span>
      </label>
    );
  };
  return (
    <div className="clip-options">
      <fieldset className="clip-field clip-length-field" disabled={disabled}>
        <legend>Clip length</legend>
        <div className="clip-seg clip-length-seg" role="radiogroup" aria-label="Clip length">
          {[...LENGTH_PRESETS, { id: 'custom' as const, label: 'Custom', hint: 'Your range' }].map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={preset === p.id}
              className={`clip-seg-btn${preset === p.id ? ' is-on' : ''}`}
              onClick={() => onPreset(p.id)}
            >
              {p.label} <span className="clip-seg-hint">{p.hint}</span>
            </button>
          ))}
        </div>
        {preset === 'custom' && (
          <div className="clip-length-custom">
            {field('min', 'Minimum')}
            {field('max', 'Maximum')}
            <p id={`${id}-length-note`} className={`clip-length-note${error ? ' is-error' : ''}`} role={error ? 'alert' : undefined}>
              {error ||
                (range && !('error' in range)
                  ? range.minSec === range.maxSec
                    ? `Clips aim for ${formatLength(range.maxSec)}, ending on a full sentence.`
                    : `Clips run ${formatLength(range.minSec)} to ${formatLength(range.maxSec)}.`
                  : '')}
            </p>
          </div>
        )}
      </fieldset>
      <label className="clip-field">
        <span>Number of clips</span>
        <span className="clip-range">
          <input
            type="range"
            min={3}
            max={15}
            step={1}
            value={maxClips}
            disabled={disabled}
            onChange={(e) => onMaxClips(Number(e.target.value))}
          />
          <output>{maxClips}</output>
        </span>
      </label>
    </div>
  );
}
