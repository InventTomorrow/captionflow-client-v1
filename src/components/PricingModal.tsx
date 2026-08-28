import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { PricingCards, type ApiPlan } from './PricingCards';
import { ManualPaymentPanel } from './ManualPaymentPanel';
import type { PlanErrorInfo } from '../lib/planErrors';

/**
 * In-context upgrade nudge — opens over whatever screen the user is on
 * (e.g. the editor) instead of sending them away to the landing page.
 * Opens straight to the manual bank-transfer payment step for the featured
 * plan (fewer clicks for the common case); "Change plan" reveals the
 * subscription comparison grid for anyone who wants a different tier.
 * There's no in-app checkout yet.
 */
export function PricingModal({
  open,
  onClose,
  reason,
}: {
  open: boolean;
  onClose: () => void;
  reason?: PlanErrorInfo | null;
}) {
  const [allPlans, setAllPlans] = useState<ApiPlan[] | null>(null);
  const [paymentSlug, setPaymentSlug] = useState<string | null>(null);
  // Guards the auto-select-on-load below from re-firing and clobbering an
  // explicit "Change plan" click (which clears paymentSlug back to null).
  const autoSelectedRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    void api
      .get('/billing/plans')
      .then((r) => setAllPlans(r.data.plans as ApiPlan[]))
      .catch(() => setAllPlans([]));
  }, [open]);

  // Reset back to the payment step's default plan once the modal fully
  // closes, so the next open starts fresh instead of resuming wherever the
  // last session left off.
  useEffect(() => {
    if (!open) {
      setPaymentSlug(null);
      autoSelectedRef.current = false;
    }
  }, [open]);

  // Free has nothing to pay for, so it's excluded everywhere in this modal.
  // The payment dropdown covers every payable option — subscriptions and
  // one-time day passes alike — while the comparison grid (PricingCards)
  // only ever shows subscriptions: it always appends "/mo", which would be
  // wrong for a one-time pass.
  const paymentPlans = allPlans ? allPlans.filter((p) => p.isOneTime || p.priceMonthlyPkr > 0) : allPlans;
  const subscriptionPlans = allPlans ? allPlans.filter((p) => !p.isOneTime && p.priceMonthlyPkr > 0) : allPlans;

  // Jump straight into payment for the featured subscription plan once
  // plans load — same plan the landing page's pricing section highlights
  // as "Popular".
  useEffect(() => {
    if (!open || !subscriptionPlans || autoSelectedRef.current) return;
    if (subscriptionPlans.length === 0) return;
    autoSelectedRef.current = true;
    const featured =
      subscriptionPlans.find((p) => p.slug === 'creator') ??
      subscriptionPlans[Math.floor((subscriptionPlans.length - 1) / 2)];
    setPaymentSlug(featured.slug);
  }, [open, subscriptionPlans]);

  if (!open) return null;

  if (paymentSlug) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal-card payment-modal-card" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="modal-close payment-modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
          {subscriptionPlans && subscriptionPlans.length > 1 && (
            <button type="button" className="payment-modal-back" onClick={() => setPaymentSlug(null)}>
              ‹ Change plan
            </button>
          )}
          {reason?.message && <p className="muted pricing-modal-reason payment-modal-reason">{reason.message}</p>}
          <ManualPaymentPanel plans={paymentPlans} selectedSlug={paymentSlug} onSelectSlug={setPaymentSlug} />
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card pricing-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{reason?.title || 'Upgrade your plan'}</h3>
          <button type="button" className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          {reason?.message && <p className="muted pricing-modal-reason">{reason.message}</p>}
          <PricingCards plans={subscriptionPlans} onSelectPlan={(p) => setPaymentSlug(p.slug)} ctaLabel="Upgrade" />
        </div>
      </div>
    </div>
  );
}
