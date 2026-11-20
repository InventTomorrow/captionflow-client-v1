/**
 * ClipStyleBrowser — every caption template for one clip, with its category,
 * description and tags (the full ClipTemplatePicker), in a modal <dialog>.
 * The browser's own modal handles the focus trap, Escape and returning focus
 * to the button that opened it. Picking a card applies it like the strip does.
 */
import { X } from '@phosphor-icons/react';
import { useEffect, useRef } from 'react';
import { ClipTemplatePicker } from './ClipTemplatePicker';
import { useClipTemplates } from './useClipTemplates';

interface ClipStyleBrowserProps {
  open: boolean;
  templateKey: string | null | undefined;
  custom?: boolean;
  disabled?: boolean;
  onPick(templateKey: string | null): void;
  onClose(): void;
}

export function ClipStyleBrowser({ open, templateKey, custom, disabled, onPick, onClose }: ClipStyleBrowserProps) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const count = useClipTemplates().length;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="clip-style-browser"
      aria-labelledby="clip-style-browser-title"
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // A click on the backdrop (the dialog box itself, outside its content) closes it.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {open && (
        <div className="clip-style-browser-inner">
          <div className="clip-style-browser-head">
            <div>
              <h2 id="clip-style-browser-title">Caption styles</h2>
              <p>{count} templates · picking one applies it to this clip</p>
            </div>
            <button type="button" className="clip-icon-btn" onClick={onClose} aria-label="Close" autoFocus>
              <X size={16} weight="bold" aria-hidden="true" />
            </button>
          </div>
          <div className="clip-style-browser-body">
            <ClipTemplatePicker templateKey={templateKey} custom={custom} disabled={disabled} onPick={onPick} />
          </div>
        </div>
      )}
    </dialog>
  );
}
