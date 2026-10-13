/**
 * ClipStyleSheet — pick one caption template for many clips at once ("Style
 * all clips", or a selection). The choice is applied only on Apply.
 */
import { useEffect, useState } from 'react';
import { ClipTemplatePicker } from './ClipTemplatePicker';

interface ClipStyleSheetProps {
  title: string;
  /** One line on what Apply changes. */
  note: string;
  initialKey: string | null;
  applyLabel: string;
  busy?: boolean;
  error?: string;
  onApply(templateKey: string | null): void;
  onClose(): void;
}

export function ClipStyleSheet({ title, note, initialKey, applyLabel, busy, error, onApply, onClose }: ClipStyleSheetProps) {
  const [key, setKey] = useState<string | null>(initialKey);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onClose}>
      <div
        className="modal-card clip-style-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="clip-style-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h3 id="clip-style-title">{title}</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close" disabled={busy}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          <p className="muted tiny">{note}</p>
          <ClipTemplatePicker templateKey={key} disabled={busy} onPick={setKey} />
          {error && (
            <p className="clip-card-error" role="alert">
              {error}
            </p>
          )}
          <div className="clip-render-actions">
            <button type="button" className="btn primary" onClick={() => onApply(key)} disabled={busy}>
              {busy ? 'Applying…' : applyLabel}
            </button>
            <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
