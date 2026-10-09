/**
 * ClipOptionsForm — what to look for: clip length and how many. Shared by
 * New Clips and the "Find clips / Re-run" panel.
 */
import { LENGTH_PRESETS, type LengthPresetId } from '../../lib/clips/clipOptions';

export function ClipOptionsForm({
  preset,
  maxClips,
  disabled,
  onPreset,
  onMaxClips,
}: {
  preset: LengthPresetId;
  maxClips: number;
  disabled?: boolean;
  onPreset(p: LengthPresetId): void;
  onMaxClips(n: number): void;
}) {
  return (
    <div className="clip-options">
      <fieldset className="clip-field" disabled={disabled}>
        <legend>Clip length</legend>
        <div className="clip-seg" role="radiogroup" aria-label="Clip length">
          {LENGTH_PRESETS.map((p) => (
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
