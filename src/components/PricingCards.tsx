import { ArrowClockwise, ArrowRight, Check, Crown, Leaf, Lightning, Star } from '@phosphor-icons/react';
import { useFlagsStore } from '../stores/flagsStore';

export interface ApiPlan {
  _id: string;
  slug: string;
  name: string;
  description?: string;
  priceMonthlyPkr: number;
  priceYearlyPkr: number;
  features: string[];
  sortOrder: number;
  isOneTime?: boolean;
  durationDays?: number;
  discountPercent?: number;
  discountActive?: boolean;
  /** Enforced allowances (public /billing/plans returns them). */
  limits?: { minutesPerMonth?: number; clipRunsPerMonth?: number };
}

/**
 * The plan's feature lines plus its Viral Clips allowance, taken from the
 * enforced limit (Admin → Plans "Clip runs / month") so the card can never
 * promise a different number than the app allows. Left out when Clips are
 * switched off, when the plan has no clip runs, or when the admin already
 * wrote a clips line into the features themselves.
 */
export function planFeatures(plan: ApiPlan, clipsEnabled: boolean): string[] {
  const runs = plan.limits?.clipRunsPerMonth ?? 0;
  if (!clipsEnabled || runs <= 0 || plan.features.some((f) => /clip/i.test(f))) return plan.features;
  const line = `Viral Clips from ${runs} video${runs === 1 ? '' : 's'}${plan.isOneTime ? '' : '/month'}`;
  const [first, ...rest] = plan.features;
  return first === undefined ? [line] : [first, line, ...rest];
}

/** Admin-set per-plan discount — returns the discounted price, or null when no discount applies. */
export function discountedPrice(base: number, plan: ApiPlan): number | null {
  if (!plan.discountActive || !plan.discountPercent) return null;
  return Math.round(base * (1 - plan.discountPercent / 100));
}

/** Small per-tier glyph for the pricing cards — leaf (try it), bolt (speed/creation), crown (top tier). */
function PlanIcon({ slug }: { slug: string }) {
  if (slug === 'studio') return <Crown size={18} aria-hidden="true" />;
  if (slug === 'creator') return <Lightning size={18} aria-hidden="true" />;
  return <Leaf size={18} aria-hidden="true" />;
}

/**
 * Shared pricing-tier grid used by both the landing page's #pricing section
 * and PricingModal — kept as one component so the two never drift visually.
 */
export function PricingCards({
  plans,
  failed = false,
  onRetry,
  yearly = false,
  onSelectPlan,
  ctaLabel = 'Get Started',
}: {
  plans: ApiPlan[] | null;
  /** The plan list could not be loaded (see usePlans) — not the same as none existing. */
  failed?: boolean;
  onRetry?: () => void;
  yearly?: boolean;
  onSelectPlan: (plan: ApiPlan) => void;
  ctaLabel?: string;
}) {
  const clipsEnabled = useFlagsStore((s) => s.flags.clipsEnabled);
  // The "Most Popular" badge lands on the creator plan when present, else the
  // middle-priced plan, so a newly added plan never breaks the layout.
  const featuredSlug =
    plans && plans.length > 0
      ? (plans.find((p) => p.slug === 'creator') ?? plans[Math.floor((plans.length - 1) / 2)])?.slug
      : undefined;

  if (failed) {
    return (
      <div className="lp-plans-failed" role="alert">
        <p className="muted">We couldn&apos;t load pricing just now.</p>
        {onRetry && (
          <button type="button" className="lp-btn lp-btn-ghost" onClick={onRetry}>
            <ArrowClockwise size={16} weight="bold" aria-hidden="true" />
            Try again
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="lp-grid-3 lp-pricing-grid">
      {plans === null && <p className="muted">Loading plans…</p>}
      {plans?.length === 0 && <p className="muted">Pricing isn&apos;t configured yet - check back soon.</p>}
      {plans?.map((p) => {
        const featured = p.slug === featuredSlug;
        const monthlyFree = p.priceMonthlyPkr <= 0;
        const shown = yearly ? p.priceYearlyPkr : p.priceMonthlyPkr;
        const discounted = discountedPrice(shown, p);
        // An admin discount takes priority over the yearly-savings
        // comparison — showing two different "was" prices at once
        // would be confusing, so pick one: the discount when active,
        // otherwise the existing monthly-vs-yearly comparison.
        const showWasPrice = discounted != null || (yearly && !monthlyFree && p.priceYearlyPkr < p.priceMonthlyPkr);
        const wasPriceValue = discounted != null ? shown : p.priceMonthlyPkr;
        const figureValue = discounted ?? shown;
        return (
          <article key={p._id} className={`lp-card lp-price-card ${featured ? 'lp-price-featured' : ''}`}>
            {discounted != null && <span className="lp-price-discount-ribbon">{p.discountPercent}% OFF</span>}
            {featured && <div className="lp-price-glow" aria-hidden="true" />}
            {featured && (
              <span className="lp-price-badge">
                <Star size={11} weight="fill" aria-hidden="true" />
                Popular
              </span>
            )}
            <div className="lp-price-icon" aria-hidden="true">
              <PlanIcon slug={p.slug} />
            </div>
            <h3 className="lp-price-name">{p.name}</h3>
            {p.description && <p className="lp-price-desc">{p.description}</p>}
            <div className="lp-price-amount">
              {!monthlyFree && (
                <div className="lp-price-figure-row">
                  {showWasPrice && <span className="lp-price-was">PKR {wasPriceValue.toLocaleString()}</span>}
                  <span className="lp-price-currency">PKR</span>
                  <span className="lp-price-figure">{figureValue.toLocaleString()}</span>
                  <span className="lp-price-suffix">/mo</span>
                </div>
              )}
              {monthlyFree && <span className="lp-price-figure lp-price-figure-free">Free</span>}
              {!monthlyFree && yearly && <span className="lp-price-period">billed yearly</span>}
            </div>
            <ul className="lp-price-features">
              {planFeatures(p, clipsEnabled).map((f) => (
                <li key={f}>
                  <span className="lp-price-check" aria-hidden="true">
                    <Check size={10} weight="bold" aria-hidden="true" />
                  </span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className={`lp-btn ${featured ? 'lp-btn-primary' : 'lp-btn-ghost'} lp-price-cta`}
              onClick={() => onSelectPlan(p)}
            >
              {ctaLabel}
              <ArrowRight size={13} weight="bold" aria-hidden="true" />
            </button>
          </article>
        );
      })}
    </div>
  );
}
