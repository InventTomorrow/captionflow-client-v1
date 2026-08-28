import { useEffect, useState } from 'react';
import { ManualPaymentPanel } from './ManualPaymentPanel';
import type { ApiPlan } from './PricingCards';

/**
 * Standalone bank-transfer popup used by the landing page's "Get Started" /
 * "Get {plan}" CTAs — opens over the page instead of an inline panel.
 */
export function ManualPaymentModal({
  open,
  onClose,
  plans,
  initialSlug,
}: {
  open: boolean;
  onClose: () => void;
  plans: ApiPlan[] | null;
  initialSlug?: string;
}) {
  const [slug, setSlug] = useState(initialSlug || '');

  useEffect(() => {
    if (open) setSlug(initialSlug || '');
  }, [open, initialSlug]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card payment-modal-card" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-close payment-modal-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
        <ManualPaymentPanel plans={plans} selectedSlug={slug} onSelectSlug={setSlug} />
      </div>
    </div>
  );
}
