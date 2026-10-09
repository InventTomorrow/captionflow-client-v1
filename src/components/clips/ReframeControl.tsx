/**
 * ReframeControl — how a 16:9 source fills the 9:16 clip: follow the face
 * (Auto, tracked on this device), a fixed position (Manual), or the whole
 * frame letterboxed (Fit).
 */
import { useEffect, useState } from 'react';
import type { ClipCropMode } from '../../lib/clips/api';

/**
 * The slider follows the hand locally and saves once, on release (pointer up,
 * key up or blur) — never one request per pixel, never snapping back while a
 * save is in flight.
 */
function PositionSlider({ x, onCommit }: { x: number; onCommit(x: number): void }) {
  const [value, setValue] = useState(x);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) setValue(x);
  }, [x, dirty]);
  const commit = () => {
    if (!dirty) return;
    setDirty(false);
    if (value !== x) onCommit(value);
  };
  return (
    <label className="clip-reframe-x">
      <span>Position</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => {
          setValue(Number(e.target.value));
          setDirty(true);
        }}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
        aria-label="Crop position, left to right"
      />
    </label>
  );
}

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
      {mode === 'manual' && <PositionSlider x={x} onCommit={onX} />}
      {status && (
        <p className="clip-reframe-status" role="status">
          {status}
        </p>
      )}
    </div>
  );
}
