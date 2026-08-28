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
}

/** Admin-set per-plan discount — returns the discounted price, or null when no discount applies. */
export function discountedPrice(base: number, plan: ApiPlan): number | null {
  if (!plan.discountActive || !plan.discountPercent) return null;
  return Math.round(base * (1 - plan.discountPercent / 100));
}

/** Small per-tier glyph for the pricing cards — play (try it), bolt (speed/creation), star (top tier). */
function PlanIcon({ slug }: { slug: string }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  if (slug === 'studio') {
    return (
      <svg {...common}>
        <path d="M12 3.5l2.6 5.3 5.9.8-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.8z" />
      </svg>
    );
  }
  if (slug === 'creator') {
    return (
      <svg {...common}>
        <path d="M13 2 5 13h5.5L10 22l8-11h-5.5z" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="8.3" />
      <path d="M10 8.5l5 3.5-5 3.5z" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * Shared pricing-tier grid used by both the landing page's #pricing section
 * and PricingModal — kept as one component so the two never drift visually.
 */
export function PricingCards({
  plans,
  yearly = false,
  onSelectPlan,
  ctaLabel = 'Get Started',
}: {
  plans: ApiPlan[] | null;
  yearly?: boolean;
  onSelectPlan: (plan: ApiPlan) => void;
  ctaLabel?: string;
}) {
  // The "Most Popular" badge lands on the creator plan when present, else the
  // middle-priced plan, so a newly added plan never breaks the layout.
  const featuredSlug =
    plans && plans.length > 0
      ? (plans.find((p) => p.slug === 'creator') ?? plans[Math.floor((plans.length - 1) / 2)])?.slug
      : undefined;

  return (
    <div className="lp-grid-3 lp-pricing-grid">
      {plans === null && <p className="muted">Loading plans…</p>}
      {plans?.length === 0 && <p className="muted">Pricing isn&apos;t configured yet — check back soon.</p>}
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
                <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
                  <path
                    d="M8 1.2l1.85 3.9 4.15.55-3.05 2.95.75 4.3L8 10.9l-3.7 2 .75-4.3-3.05-2.95 4.15-.55z"
                    fill="currentColor"
                  />
                </svg>
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
              {p.features.map((f) => (
                <li key={f}>
                  <span className="lp-price-check" aria-hidden="true">
                    <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">
                      <path
                        d="M3 8.5l3 3 7-7"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
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
              <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
                <path
                  d="M3 8h9M8 3l5 5-5 5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </article>
        );
      })}
    </div>
  );
}
