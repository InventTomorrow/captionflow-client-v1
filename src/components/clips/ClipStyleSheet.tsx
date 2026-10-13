/**
 * ClipStyleSheet — one caption template and/or one format for many clips at
 * once ("Style all clips", or a selection). Each part can be left as it is:
 * nothing is chosen until the user picks it, and only Apply saves.
 */
import { useEffect, useState } from 'react';
import type { ClipLookPatch } from '../../lib/clips/api';
import type { ClipAspect } from '../../lib/clips/clipMath';
import { ClipFormatToggle } from './ClipFormatToggle';
import { ClipTemplatePicker } from './ClipTemplatePicker';

interface ClipStyleSheetProps {
  title: string;
  /** One line on what Apply changes. */
  note: string;
  /** How many clips Apply touches (for the button). */
  count: number;
  busy?: boolean;
  error?: string;
  onApply(look: ClipLookPatch): void;
  onClose(): void;
}

export function ClipStyleSheet({ title, note, count, busy, error, onApply, onClose }: ClipStyleSheetProps) {
  /** undefined = keep each clip's template. */
  const [key, setKey] = useState<string | null | undefined>(undefined);
  /** undefined = keep each clip's format. */
  const [aspect, setAspect] = useState<ClipAspect | undefined>(undefined);
  const nothing = key === undefined && aspect === undefined;

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
          <div className="clip-sheet-row">
            <span className="clip-sheet-label">Format</span>
            <ClipFormatToggle value={aspect} allowKeep disabled={busy} onChange={setAspect} />
          </div>
          <div className="clip-sheet-row">
            <span className="clip-sheet-label">Caption template</span>
            {key !== undefined && (
              <button type="button" className="clip-sheet-keep" onClick={() => setKey(undefined)} disabled={busy}>
                Keep each clip’s template
              </button>
            )}
          </div>
          <ClipTemplatePicker templateKey={key} disabled={busy} onPick={setKey} />
          {error && (
            <p className="clip-card-error" role="alert">
              {error}
            </p>
          )}
          <div className="clip-render-actions">
            <button
              type="button"
              className="btn primary"
              onClick={() => onApply({ ...(key !== undefined ? { templateKey: key } : {}), ...(aspect ? { aspect } : {}) })}
              disabled={busy || nothing}
            >
              {busy ? 'Applying…' : `Apply to ${count} clip${count === 1 ? '' : 's'}`}
            </button>
            <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            {nothing && <span className="muted tiny">Pick a format or a template.</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
