import { useEffect, useState } from 'react';
import { Bank, Check, Copy, WhatsappLogo } from '@phosphor-icons/react';
import { useFlagsStore } from '../stores/flagsStore';
import { discountedPrice, type ApiPlan } from './PricingCards';
import { PremiumSelect } from './PremiumSelect';

/**
 * Manual bank-transfer payment details — the content shown inside both
 * ManualPaymentModal (landing page CTAs) and PricingModal's payment step
 * (in-app "Upgrade plan" CTAs), kept as one component so they never drift.
 */
export function ManualPaymentPanel({
  plans,
  selectedSlug,
  onSelectSlug,
}: {
  plans: ApiPlan[] | null;
  selectedSlug: string;
  onSelectSlug: (slug: string) => void;
}) {
  const bankTransfer = useFlagsStore((s) => s.bankTransfer);
  const loadFlags = useFlagsStore((s) => s.load);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  useEffect(() => {
    void loadFlags();
  }, [loadFlags]);

  const selectedPlan = (plans ?? []).find((p) => p.slug === selectedSlug) ?? (plans ?? [])[0];
  const whatsappHref =
    bankTransfer.whatsappNumber && selectedPlan
      ? `https://wa.me/${bankTransfer.whatsappNumber.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(
          `Hi, I've paid for the ${selectedPlan.name} - here's my payment proof.`,
        )}`
      : undefined;

  async function copyToClipboard(value: string, field: string) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      setTimeout(() => setCopiedField((f) => (f === field ? null : f)), 1500);
    } catch {
      // Clipboard API unavailable/denied — user can still select+copy manually.
    }
  }

  return (
    <div className="lp-payment-panel">
      <div className="lp-payment-icon" aria-hidden="true">
        <Bank size={20} aria-hidden="true" />
      </div>
      <h3 className="lp-payment-title">Manual Payment (Bank Transfer)</h3>
      <p className="lp-payment-sub">
        Prefer bank transfer over card? Pay the amount for your chosen plan below.
      </p>
      {(plans?.length ?? 0) > 1 && (
        <label className="lp-payment-select">
          Plan
          <PremiumSelect ariaLabel="Payment plan" value={selectedPlan?.slug || ''} onChange={onSelectSlug}
            options={(plans ?? []).map((p) => {
              const discounted = discountedPrice(p.priceMonthlyPkr, p);
              return { value: p.slug, label: `${p.name} - PKR ${(discounted ?? p.priceMonthlyPkr).toLocaleString()}${p.isOneTime ? '' : '/mo'}` };
            })} />
        </label>
      )}
      <p className="lp-payment-fields-label">Bank details &amp; how it works</p>
      <div className="lp-payment-fields">
        {(
          [
            ['Account title', bankTransfer.accountTitle, 'accountTitle'],
            ['Bank', bankTransfer.bankName, 'bankName'],
            ['Account #', bankTransfer.accountNumber, 'accountNumber'],
          ] as const
        ).map(([label, value, key]) => (
          <div className="lp-payment-field" key={key}>
            <div className="lp-payment-field-text">
              <span className="lp-payment-field-label">{label}</span>
              <span className="lp-payment-field-value">{value || '-'}</span>
            </div>
            <button
              type="button"
              className="lp-payment-copy"
              aria-label={`Copy ${label}`}
              onClick={() => void copyToClipboard(value, key)}
            >
              {copiedField === key ? (
                <Check size={14} weight="bold" aria-hidden="true" />
              ) : (
                <Copy size={14} weight="bold" aria-hidden="true" />
              )}
            </button>
          </div>
        ))}
      </div>
      {bankTransfer.instructions.length > 0 && (
        <ol className="lp-payment-steps">
          {bankTransfer.instructions.map((step, i) => (
            <li key={i}>
              <span className="lp-payment-step-num">{i + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      )}
      <a
        className="lp-btn lp-whatsapp-btn"
        href={whatsappHref}
        target="_blank"
        rel="noopener noreferrer"
        aria-disabled={!whatsappHref}
        onClick={(e) => {
          if (!whatsappHref) e.preventDefault();
        }}
      >
        <WhatsappLogo size={16} weight="fill" aria-hidden="true" />
        Send proof on WhatsApp
      </a>
    </div>
  );
}
