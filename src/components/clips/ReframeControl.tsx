/**
 * ReframeControl — how a 16:9 source fills the 9:16 clip: follow the face
 * (Auto, tracked on this device), a fixed position (Manual), or the whole
 * frame letterboxed (Fit).
 */
import type { ClipCropMode } from '../../lib/clips/api';

const MODES: Array<{ mode: ClipCropMode; label: string; hint: string }> = [
  { mode: 'auto', label: 'Auto', hint: 'Follow the speaker’s face' },
  { mode: 'manual', label: 'Manual', hint: 'Choose which part of the frame to keep' },
  { mode: 'none', label: 'Fit', hint: 'Show the whole frame with bars' },
];

export function ReframeControl({
  mode,
  x,
  busy,
  status,
  onMode,
  onX,
}: {
  mode: ClipCropMode;
  x: number;
  busy?: boolean;
  status?: string;
  onMode(mode: ClipCropMode): void;
  onX(x: number): void;
}) {
  return (
    <div className="clip-reframe">
      <div className="clip-seg" role="radiogroup" aria-label="Framing">
        {MODES.map((m) => (
          <button
            key={m.mode}
            type="button"
            role="radio"
            aria-checked={mode === m.mode}
            className={`clip-seg-btn${mode === m.mode ? ' is-on' : ''}`}
            title={m.hint}
            disabled={busy}
            onClick={() => onMode(m.mode)}
          >
            {m.label}
          </button>
        ))}
      </div>
      {mode === 'manual' && (
        <label className="clip-reframe-x">
          <span>Position</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={x}
            onChange={(e) => onX(Number(e.target.value))}
            aria-label="Crop position, left to right"
          />
        </label>
      )}
      {status && (
        <p className="clip-reframe-status" role="status">
          {status}
        </p>
      )}
    </div>
  );
}
