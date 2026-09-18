import { useEffect, useState } from 'react';
import { useFlagsStore } from '../stores/flagsStore';
import { discountedPrice, type ApiPlan } from './PricingCards';

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
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 10 12 4l9 6M4 10v9M20 10v9M8 10v9M16 10v9M2 22h20" />
        </svg>
      </div>
      <h3 className="lp-payment-title">Manual Payment (Bank Transfer)</h3>
      <p className="lp-payment-sub">
        Prefer bank transfer over card? Pay the amount for your chosen plan below.
      </p>
      {(plans?.length ?? 0) > 1 && (
        <label className="lp-payment-select">
          Plan
          <select value={selectedPlan?.slug || ''} onChange={(e) => onSelectSlug(e.target.value)}>
            {(plans ?? []).map((p) => {
              const discounted = discountedPrice(p.priceMonthlyPkr, p);
              return (
                <option key={p.slug} value={p.slug}>
                  {p.name} - PKR {(discounted ?? p.priceMonthlyPkr).toLocaleString()}
                  {p.isOneTime ? '' : '/mo'}
                </option>
              );
            })}
          </select>
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
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 8.5l3 3 7-7" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="8" y="8" width="12" height="12" rx="2" />
                  <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
                </svg>
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
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M17.5 14.4c-.3-.1-1.6-.8-1.9-.9-.3-.1-.4-.1-.6.1-.2.3-.7.9-.8 1-.2.2-.3.2-.5.1-.3-.1-1.2-.4-2.2-1.3-.8-.7-1.4-1.6-1.5-1.9-.2-.3 0-.4.1-.6.1-.1.3-.3.4-.5.1-.1.2-.3.2-.4.1-.2 0-.3 0-.5-.1-.1-.6-1.5-.8-2-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.3-.2.3-.9.9-.9 2.1s.9 2.5 1.1 2.7c.1.2 1.9 2.9 4.6 4 .6.3 1.1.4 1.5.6.6.2 1.2.2 1.6.1.5-.1 1.6-.6 1.8-1.3.2-.6.2-1.2.2-1.3-.1-.1-.3-.2-.5-.3z" />
          <path d="M12 2a10 10 0 0 0-8.6 15L2 22l5.2-1.4A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.1l-.3-.2-3.1.8.8-3-.2-.3A8.2 8.2 0 1 1 20.2 12 8.2 8.2 0 0 1 12 20.2z" />
        </svg>
        Send proof on WhatsApp
      </a>
    </div>
  );
}
