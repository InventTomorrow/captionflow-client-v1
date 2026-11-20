/**
 * ChunkSizeToolbar — the small bar under a selected caption on the video
 * (CaptionOverlay and KineticCaptionLayer share it).
 *
 * Always: a Size slider with its % value, Reset, and Delete chunk. Once the
 * size or position has been changed (nothing is saved yet), exactly two
 * choices: Apply to all chunks / Apply to this chunk — plus Cancel, which
 * (like Escape or clicking away) drops the change.
 */
import type { CSSProperties, SyntheticEvent } from 'react';
import { ArrowCounterClockwise, Trash, X } from '@phosphor-icons/react';

export const CHUNK_SCALE_MIN = 25;
export const CHUNK_SCALE_MAX = 300;

export function clampChunkScale(v: number): number {
  return Math.min(CHUNK_SCALE_MAX, Math.max(CHUNK_SCALE_MIN, Math.round(v)));
}

export function ChunkSizeToolbar({
  scale,
  pending,
  onScale,
  onApply,
  onCancel,
  onDelete,
  className = '',
  style,
}: {
  /** The size shown now (the pending value while adjusting), in % of the template size. */
  scale: number;
  /** Something changed and is not saved yet. */
  pending: boolean;
  onScale: (scale: number) => void;
  onApply: (scope: 'all' | 'chunk') => void;
  onCancel: () => void;
  onDelete?: () => void;
  className?: string;
  style?: CSSProperties;
}) {
  const stop = (e: SyntheticEvent) => e.stopPropagation();
  return (
    <div
      className={`chunk-size-bar ${className}`}
      style={style}
      role="toolbar"
      aria-label="Caption size"
      onPointerDown={stop}
      onClick={stop}
      onDoubleClick={stop}
    >
      <div className="chunk-size-row">
        <label className="chunk-size-slider">
          <span className="chunk-size-label">Size</span>
          <input
            type="range"
            min={CHUNK_SCALE_MIN}
            max={CHUNK_SCALE_MAX}
            step={5}
            value={scale}
            aria-valuetext={`${scale}%`}
            onChange={(e) => onScale(clampChunkScale(Number(e.target.value)))}
          />
          <output className="chunk-size-value">{scale}%</output>
        </label>
        <button
          type="button"
          className="chunk-size-icon"
          title="Reset to the template size (100%)"
          aria-label="Reset size to 100%"
          disabled={scale === 100}
          onClick={() => onScale(100)}
        >
          <ArrowCounterClockwise size={14} weight="bold" aria-hidden="true" />
        </button>
        {onDelete && (
          <button type="button" className="chunk-size-icon danger" title="Delete this caption chunk" aria-label="Delete this caption chunk" onClick={onDelete}>
            <Trash size={14} weight="bold" aria-hidden="true" />
          </button>
        )}
      </div>
      {pending && (
        <div className="chunk-size-row chunk-size-scope">
          <button type="button" className="chunk-size-apply primary" onClick={() => onApply('all')}>
            Apply to all chunks
          </button>
          <button type="button" className="chunk-size-apply" onClick={() => onApply('chunk')}>
            Apply to this chunk
          </button>
          <button type="button" className="chunk-size-icon" title="Discard this change" aria-label="Discard this change" onClick={onCancel}>
            <X size={14} weight="bold" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
