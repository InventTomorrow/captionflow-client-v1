/**
 * ClipBulkBar — the sticky action bar of a clip grid in selection mode:
 * select all / none, how many are picked, and what to do with them.
 */
import { Clapperboard, Palette, Trash2, X } from 'lucide-react';

interface ClipBulkBarProps {
  total: number;
  selectedCount: number;
  busy?: boolean;
  onToggleAll(): void;
  onStyle(): void;
  /** Render the selection on this device (clip set page only). */
  onRender?(): void;
  onDelete(): void;
  onDone(): void;
}

export function ClipBulkBar({ total, selectedCount, busy, onToggleAll, onStyle, onRender, onDelete, onDone }: ClipBulkBarProps) {
  const all = total > 0 && selectedCount === total;
  const none = selectedCount === 0;
  return (
    <div className="clip-bulk-bar" role="toolbar" aria-label="Selected clips">
      <label className="clip-bulk-all">
        <input
          type="checkbox"
          checked={all}
          ref={(el) => {
            if (el) el.indeterminate = !all && !none;
          }}
          onChange={onToggleAll}
        />
        Select all ({total})
      </label>
      <span className="clip-bulk-count" aria-live="polite">
        {selectedCount} selected
      </span>
      <div className="clip-bulk-actions">
        <button type="button" className="btn primary clip-bulk-btn" onClick={onStyle} disabled={busy || none}>
          <Palette size={16} aria-hidden="true" />
          Style &amp; format
        </button>
        {onRender && (
          <button type="button" className="btn ghost clip-bulk-btn" onClick={onRender} disabled={busy || none}>
            <Clapperboard size={16} aria-hidden="true" />
            Render
          </button>
        )}
        <button type="button" className="btn ghost clip-bulk-btn clip-btn-danger" onClick={onDelete} disabled={busy || none}>
          <Trash2 size={16} aria-hidden="true" />
          Delete
        </button>
        <button type="button" className="clip-icon-btn" onClick={onDone} aria-label="Stop selecting">
          <X size={18} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
