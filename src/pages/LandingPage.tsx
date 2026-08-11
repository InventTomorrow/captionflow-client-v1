import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactSlick from 'react-slick';
import type { Settings } from 'react-slick';
import 'slick-carousel/slick/slick.css';
import 'slick-carousel/slick/slick-theme.css';
import { api } from '../lib/api';
import { useAuthStore } from '../stores/authStore';
import { useFlagsStore } from '../stores/flagsStore';

/** Vite/CJS interop: default export can be nested as `{ default: Component }`. */
const Slider = ((ReactSlick as unknown as { default?: typeof ReactSlick }).default ??
  ReactSlick) as typeof ReactSlick;

interface ApiPlan {
  _id: string;
  slug: string;
  name: string;
  description?: string;
  priceMonthlyPkr: number;
  priceYearlyPkr: number;
  features: string[];
  sortOrder: number;
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

/** Fades a section in once it scrolls into view (mirrors the original mockup's .cf-reveal). */
function Reveal({
  children,
  delayMs = 0,
  className = '',
}: {
  children: ReactNode;
  delayMs?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`lp-reveal ${visible ? 'is-visible' : ''} ${className}`.trim()}
      style={{ transitionDelay: `${delayMs}ms` }}
    >
      {children}
    </div>
  );
}

const DIFFERENTIATORS = [
  {
    icon: '🎯',
    title: 'Trained on how Pakistan speaks',
    body: 'Built on Pakistani speech — not an English model with an Urdu patch.',
  },
  {
    icon: '✏️',
    title: 'Edit every single word',
    body: 'Fix wording and timing before export. Nothing goes out until you say so.',
  },
  {
    icon: '🎬',
    title: 'Export up to 4K',
    body: 'Burned-in video or SRT — sharp and ready to post.',
  },
];

const WHY_US = [
  {
    icon: '🇵🇰',
    title: 'Not adapted. Built.',
    body: 'Trained on Pakistani speech from the ground up.',
  },
  {
    icon: '🎯',
    title: 'Accuracy where it counts',
    body: 'Model does the heavy lift. You keep final say.',
  },
  {
    icon: '💸',
    title: 'Pay for what you use',
    body: 'No translation suites. No enterprise fluff. Just captions.',
  },
];

const STEPS = ['Upload', 'Transcribe', 'Generate Captions', 'Style', 'Export'];

const TEMPLATES: Array<{ name: string; video: string }> = [
  { name: 'Word Pop', video: '/landing/templates/tpl-1.mp4' },
  { name: 'Karaoke Fill', video: '/landing/templates/tpl-2.mp4' },
  { name: 'Bold Impact', video: '/landing/templates/tpl-3.mp4' },
  { name: 'Clean Single Line', video: '/landing/templates/tpl-4.mp4' },
  { name: 'Minimal Sub', video: '/landing/templates/tpl-5.mp4' },
];

const TESTIMONIALS = [
  {
    quote: 'Pehli baar koi tool meri Urdish samajhta hai.',
    author: '@zaravlogs · Karachi',
    tags: ['Reels Creator', '85K Followers'],
  },
  {
    quote: 'Shoot, upload, export — under two minutes.',
    author: '@haris.makes · Lahore',
    tags: ['Freelance Editor', 'Video Agency'],
  },
  {
    quote: 'Roman Urdu captions that finally look clean.',
    author: '@studio.noor · Islamabad',
    tags: ['Content Studio', 'Client Work'],
  },
];

export function LandingPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [yearly, setYearly] = useState(false);
  const [plans, setPlans] = useState<ApiPlan[] | null>(null);
  /** Start centered on tpl-2 so the first view is tpl-1 | tpl-2 | tpl-3. */
  const [tplIdx, setTplIdx] = useState(1);
  const tplSliderRef = useRef<InstanceType<typeof Slider> | null>(null);
  const flags = useFlagsStore((s) => s.flags);
  const loadFlags = useFlagsStore((s) => s.load);

  useEffect(() => {
    void loadFlags();
    void api
      .get('/billing/plans')
      .then((r) => setPlans(r.data.plans))
      .catch(() => setPlans([]));
  }, [loadFlags]);

  /** Get Started always resolves against the current session — no session → /login, signed in → /projects/upload. */
  const getStarted = () => {
    if (loading) return;
    navigate(user ? '/projects/upload' : '/login');
    setMobileOpen(false);
  };

  const prevTpl = () => tplSliderRef.current?.slickPrev();
  const nextTpl = () => tplSliderRef.current?.slickNext();

  /**
   * Only the centered slide should ever play. `infinite: true` + `centerMode`
   * makes react-slick clone every slide (5 videos become ~13 <video> nodes),
   * and marking them all `autoPlay` had every clone fetching/decoding at
   * once — the visible one would play whatever was already buffered for a
   * moment, then stall (and flash black) as the others starved it of
   * bandwidth. Play exactly one at a time, restarting it from the top.
   */
  useEffect(() => {
    const videos = document.querySelectorAll<HTMLVideoElement>(
      '.lp-tpl-showcase .lp-tpl-figure-video',
    );
    videos.forEach((v) => {
      const isCenter = v.closest('.slick-slide')?.classList.contains('slick-center');
      if (isCenter) {
        v.currentTime = 0;
        void v.play().catch(() => undefined);
      } else if (!v.dataset.primed) {
        // A fully buffered video that has never actually played paints
        // nothing — solid black — until it decodes at least one frame.
        // Play-then-immediately-pause once so a slide waiting for its turn
        // shows a real freeze-frame instead of a black box. Only flag it
        // "primed" once that actually succeeds (StrictMode's double-invoked
        // effects, or a stray pause() elsewhere, can abort the play()
        // promise before it resolves) — if it fails, the next tplIdx change
        // retries instead of leaving the slide permanently black.
        void v
          .play()
          .then(() => {
            v.pause();
            // Some source clips open on a black leader/fade-in frame — park
            // the frozen preview a little further in so it isn't the frame
            // this priming pass happened to land on. Real playback (above)
            // always restarts from 0 regardless.
            v.currentTime = Math.min(0.3, (v.duration || 1) / 3);
            v.dataset.primed = '1';
          })
          .catch(() => undefined);
      } else {
        v.pause();
      }
    });
  }, [tplIdx]);

  const tplSliderSettings: Settings = {
    infinite: true,
    autoplay: true,
    autoplaySpeed: 2000,
    speed: 500,
    centerMode: true,
    centerPadding: '0px',
    slidesToShow: 3,
    slidesToScroll: 1,
    initialSlide: 1,
    arrows: false,
    dots: false,
    pauseOnHover: true,
    afterChange: (index) => setTplIdx(index),
    responsive: [
      {
        breakpoint: 760,
        settings: {
          slidesToShow: 1,
          centerMode: true,
          centerPadding: '48px',
        },
      },
    ],
  };

  // Admin sets these in Admin > Plans (server/src/models/Plan.ts) — the
  // "Most Popular" badge lands on the creator plan when present, else the
  // middle-priced plan, so a newly added plan never breaks the layout.
  const featuredSlug =
    plans && plans.length > 0
      ? (plans.find((p) => p.slug === 'creator') ?? plans[Math.floor((plans.length - 1) / 2)])?.slug
      : undefined;

  return (
    <div className="lp-body">
      <header className="lp-nav">
        {flags.maintenanceMode && (
          <div className="maintenance-banner">
            {flags.maintenanceMessage ||
              'Asaan Caption is undergoing maintenance — some features may be unavailable.'}
          </div>
        )}
        <nav className="lp-nav-shell lp-glass">
          <a href="#top" className="lp-brand">
            <img src="/logo.png" alt="Asaan Caption" className="lp-brand-logo" />
          </a>
          <ul className="lp-nav-links">
            <li>
              <a href="#how-it-works">How It Works</a>
            </li>
            <li>
              <a href="#pricing">Pricing</a>
            </li>
          </ul>
          <div className="lp-nav-actions">
            <a href="#pricing" className="lp-btn lp-btn-ghost lp-nav-pricing">
              View Pricing
            </a>
            <button type="button" className="lp-btn lp-btn-primary" onClick={getStarted}>
              Get Started
            </button>
            <button
              type="button"
              aria-label="Toggle menu"
              aria-expanded={mobileOpen}
              className="lp-nav-toggle"
              onClick={() => setMobileOpen((v) => !v)}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 5h16" />
                <path d="M4 12h16" />
                <path d="M4 19h16" />
              </svg>
            </button>
          </div>
        </nav>
        <div className={`lp-mobile-panel ${mobileOpen ? 'is-open' : ''}`}>
          <div className="lp-mobile-inner">
            <a href="#how-it-works" onClick={() => setMobileOpen(false)}>
              How It Works
            </a>
            <a href="#pricing" onClick={() => setMobileOpen(false)}>
              Pricing
            </a>
            <button type="button" className="lp-btn lp-btn-primary lp-mobile-cta" onClick={getStarted}>
              Get Started
            </button>
          </div>
        </div>
      </header>

      <main>
        <section
          id="top"
          className="lp-hero"
          style={flags.maintenanceMode ? { paddingTop: 152 } : undefined}
        >
          <div className="lp-hero-grid-bg" aria-hidden="true" />
          <div className="lp-blob" aria-hidden="true" />
          <div className="lp-hero-divider" aria-hidden="true" />
          <div className="lp-container lp-center">
            <Reveal>
              <h1 className="lp-hero-title">
                <span className="lp-grad">Need Urdish Captions?</span>
                <br />
                We Got it.
              </h1>
              <p className="lp-hero-sub lp-center-text">
                Other tools break when Urdu meets English. We don&apos;t.
              </p>
              <div className="lp-hero-ctas">
                <button
                  type="button"
                  className="lp-btn lp-btn-primary lp-btn-lg lp-btn-glow"
                  onClick={getStarted}
                >
                  Get started 
                </button>
              </div>
              <p className="lp-hero-trust">Trusted by thousands of Pakistani creators</p>
              <p className="lp-hero-rating">
                <span className="lp-accent-text">★★★★★</span> <strong>4.9</strong>
              </p>
            </Reveal>
          </div>
        </section>

        <section id="templates" className="lp-section lp-section-surface">
          <div className="lp-container lp-center">
            <Reveal className="lp-section-head">
              <h2 className="lp-h2">
                All your favourite <span className="lp-accent-text">templates</span>
              </h2>
              <p className="lp-body-text lp-narrow-text lp-center-text">
                Styles built for Roman Urdu. Tweak and save your preset.
              </p>
            </Reveal>
            <Reveal delayMs={100}>
              <div className="lp-tpl-showcase">
                <Slider ref={tplSliderRef} {...tplSliderSettings}>
                  {TEMPLATES.map((t) => (
                    <div key={t.video} className="lp-tpl-slide">
                      <figure className="lp-tpl-figure">
                        <video
                          className="lp-tpl-figure-video"
                          src={t.video}
                          muted
                          loop
                          playsInline
                          preload="auto"
                        />
                      </figure>
                    </div>
                  ))}
                </Slider>
              </div>
            </Reveal>
            <Reveal delayMs={160}>
              <div className="lp-tpl-controls lp-glass">
                <button
                  type="button"
                  className="lp-carousel-btn"
                  onClick={prevTpl}
                  aria-label="Previous template"
                >
                  ‹
                </button>
                <div className="lp-tpl-controls-info">
                  <div className="lp-tpl-controls-avatar">{TEMPLATES[tplIdx].name.charAt(0)}</div>
                  <div>
                    <p className="lp-tpl-controls-name">{TEMPLATES[tplIdx].name}</p>
                    <p className="lp-tpl-controls-sub">Fully customizable</p>
                  </div>
                </div>
                <button
                  type="button"
                  className="lp-carousel-btn"
                  onClick={nextTpl}
                  aria-label="Next template"
                >
                  ›
                </button>
              </div>
            </Reveal>
          </div>
        </section>

        <section className="lp-section">
          <div className="lp-container">
            <Reveal className="lp-section-head">
              <p className="lp-eyebrow">Why most tools fail you</p>
              <h2 className="lp-h2 lp-h2-wide">
                You speak <span className="lp-accent-text">Urdish</span>.<br />
                They were never built for that.
              </h2>
              <p className="lp-body-text lp-narrow-text">
                Other tools guess. You spend 20 minutes fixing what should take 2.
              </p>
            </Reveal>
            <Reveal>
              <div className="lp-compare">
                <div className="lp-compare-card lp-compare-bad">
                  <p className="lp-compare-label">Other Tools</p>
                  <p className="lp-compare-text">
                    &quot;Yar aaj ka shoot boht smooth gya -- litraly ek hi take men&quot;
                  </p>
                </div>
                <div className="lp-compare-card lp-compare-good">
                  <p className="lp-compare-label">Asaan Caption</p>
                  <p className="lp-compare-text">
                    &quot;Yaar, aaj ka <span className="lp-accent-text">shoot</span> bohat smooth
                    gaya, literally ek hi take mein&quot;
                  </p>
                </div>
              </div>
              <p className="lp-compare-footnote">Same sentence. One tool heard it right.</p>
            </Reveal>
          </div>
        </section>

        <section id="difference" className="lp-section lp-section-surface">
          <div className="lp-container">
            <Reveal className="lp-section-head">
              <p className="lp-eyebrow">The Asaan Caption difference</p>
              <h2 className="lp-h2 lp-h2-wide">
                Speak in <span className="lp-accent-text">Urdu</span>, English, or both.
                <br />
                Asaan <span className="lp-accent-text">Caption</span> handles the rest.
              </h2>
            </Reveal>
            <div className="lp-grid-3">
              {DIFFERENTIATORS.map((d, i) => (
                <Reveal key={d.title} delayMs={i * 100}>
                  <article className="lp-card">
                    <div className="lp-card-icon">{d.icon}</div>
                    <h3 className="lp-card-title">{d.title}</h3>
                    <p className="lp-card-body">{d.body}</p>
                  </article>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section id="how-it-works" className="lp-section">
          <div className="lp-container">
            <Reveal className="lp-section-head">
              <p className="lp-eyebrow">The whole workflow. Nothing missing.</p>
              <h2 className="lp-h2">
                Upload. Process. Export.
                <br />
                Done within <span className="lp-accent-text">2 minutes</span>.
              </h2>
            </Reveal>
            <div className="lp-steps">
              <div className="lp-steps-line" aria-hidden="true" />
              <ol className="lp-steps-list">
                {STEPS.map((step, i) => (
                  <Reveal key={step} delayMs={i * 90} className="lp-step">
                    <div className="lp-step-number">{String(i + 1).padStart(2, '0')}</div>
                    <h3 className="lp-step-title">{step}</h3>
                  </Reveal>
                ))}
              </ol>
            </div>
          </div>
        </section>

        <section className="lp-section lp-section-surface">
          <div className="lp-container">
            <Reveal className="lp-section-head">
              <p className="lp-eyebrow">Why Asaan Caption?</p>
              <h2 className="lp-h2">
                Because <span className="lp-accent-text">Urdish</span> deserves better
                <br />
                than a broken transcript.
              </h2>
              <p className="lp-body-text lp-narrow-text">
                Code-switching isn&apos;t the bug. The old tools were.
              </p>
            </Reveal>
            <div className="lp-grid-3">
              {WHY_US.map((d, i) => (
                <Reveal key={d.title} delayMs={i * 100}>
                  <article className="lp-card">
                    <div className="lp-card-icon">{d.icon}</div>
                    <h3 className="lp-card-title">{d.title}</h3>
                    <p className="lp-card-body">{d.body}</p>
                  </article>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section className="lp-section lp-export">
          <div className="lp-blob" aria-hidden="true" />
          <div className="lp-container">
            <Reveal className="lp-section-head">
              <p className="lp-eyebrow">Ready to ship</p>
              <h2 className="lp-h2 lp-h2-wide">
                Export in <span className="lp-accent-text">SRT or burned-in 4K</span>
              </h2>
              <p className="lp-body-text lp-narrow-text">
                Burned-in 4K or SRT — ready for your timeline.
              </p>
              <div className="lp-export-cta">
                <button type="button" className="lp-btn lp-btn-primary lp-btn-lg" onClick={getStarted}>
                  Get Started
                </button>
              </div>
            </Reveal>
          </div>
        </section>

        <section id="about" className="lp-section lp-section-surface">
          <div className="lp-container">
            <Reveal className="lp-section-head">
              <p className="lp-eyebrow">Why we built this</p>
              <h2 className="lp-h2 lp-h2-wide">
                Why we built <span className="lp-accent-text">Asaan Caption</span>
              </h2>
            </Reveal>
            <Reveal>
              <div className="lp-about-card lp-glass">
                <p className="lp-body-text">
                  Subtitling was the slowest part of our workflow — every tool treated Pakistani
                  speech as an afterthought. So we built our own.
                </p>
              </div>
            </Reveal>
          </div>
        </section>

        <section id="pricing" className="lp-section">
          <div className="lp-container">
            <Reveal className="lp-section-head">
              <p className="lp-eyebrow">Honest pricing. Nothing hidden.</p>
              <h2 className="lp-h2">
                Stop paying for features
                <br />
                built for <span className="lp-accent-text">everyone else</span>.
              </h2>
              <p className="lp-body-text lp-narrow-text">
                No unused suites. Just what a Pakistani creator needs.
              </p>
            </Reveal>
            <div className="lp-price-toggle-wrap">
              <div className="lp-price-toggle">
                <button
                  type="button"
                  className={yearly ? '' : 'is-active'}
                  onClick={() => setYearly(false)}
                >
                  Monthly
                </button>
                <button type="button" className={yearly ? 'is-active' : ''} onClick={() => setYearly(true)}>
                  Yearly · Save 20%
                </button>
              </div>
            </div>
            <div className="lp-grid-3 lp-pricing-grid">
              {plans === null && <p className="muted">Loading plans…</p>}
              {plans?.length === 0 && (
                <p className="muted">Pricing isn&apos;t configured yet — check back soon.</p>
              )}
              {plans?.map((p, i) => {
                const featured = p.slug === featuredSlug;
                const monthlyFree = p.priceMonthlyPkr <= 0;
                const shown = yearly ? p.priceYearlyPkr : p.priceMonthlyPkr;
                // Yearly billing shows the discounted rate — cross out the
                // monthly rate alongside it so the saving actually reads as
                // a saving, not just a different number.
                const showWasPrice = yearly && !monthlyFree && p.priceYearlyPkr < p.priceMonthlyPkr;
                return (
                  <Reveal key={p._id} delayMs={i * 100}>
                    <article className={`lp-card lp-price-card ${featured ? 'lp-price-featured' : ''}`}>
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
                            {showWasPrice && (
                              <span className="lp-price-was">
                                PKR {p.priceMonthlyPkr.toLocaleString()}
                              </span>
                            )}
                            <span className="lp-price-currency">PKR</span>
                            <span className="lp-price-figure">{shown.toLocaleString()}</span>
                            <span className="lp-price-suffix">/mo</span>
                          </div>
                        )}
                        {monthlyFree && <span className="lp-price-figure lp-price-figure-free">Free</span>}
                        {!monthlyFree && yearly && (
                          <span className="lp-price-period">billed yearly</span>
                        )}
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
                        onClick={getStarted}
                      >
                        Get Started
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
                  </Reveal>
                );
              })}
            </div>
            <ul className="lp-hero-tags lp-price-notes">
              <li className="lp-pill">✓ No hidden fees</li>
              <li className="lp-pill">✓ Cancel any time</li>
              <li className="lp-pill">✓ First exports free</li>
            </ul>
          </div>
        </section>

        <section className="lp-section lp-section-surface">
          <div className="lp-container">
            <Reveal className="lp-section-head">
              <p className="lp-eyebrow">What creators are saying</p>
              <h2 className="lp-h2 lp-h2-wide">
                Finally a caption tool
                <br />
                that <span className="lp-accent-text">grew up here</span>.
              </h2>
              <p className="lp-body-text lp-narrow-text">
                Built for how Pakistani creators actually talk.
              </p>
            </Reveal>
            <div className="lp-grid-3">
              {TESTIMONIALS.map((t, i) => (
                <Reveal key={t.author} delayMs={i * 100}>
                  <article className="lp-card lp-testimonial-card">
                    <div className="lp-stars" aria-label="5 out of 5 stars">
                      ★★★★★
                    </div>
                    <p className="lp-testimonial-quote">&ldquo;{t.quote}&rdquo;</p>
                    <div className="lp-testimonial-meta">
                      <p className="lp-testimonial-author">{t.author}</p>
                      <div className="lp-testimonial-tags">
                        {t.tags.map((tag) => (
                          <span key={tag}>{tag}</span>
                        ))}
                      </div>
                    </div>
                  </article>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section id="start" className="lp-section lp-final-cta">
          <div className="lp-blob" aria-hidden="true" />
          <div className="lp-container lp-narrow lp-center">
            <Reveal>
              <h2 className="lp-h2">
                The <span className="lp-accent-text">broken transcript</span> era is over.
              </h2>
              <p className="lp-body-text lp-narrow-text lp-center-text">
                Your mix isn&apos;t the problem. Prove it in under 2 minutes.
              </p>
              <div className="lp-final-cta-btn">
                <button
                  type="button"
                  className="lp-btn lp-btn-primary lp-btn-lg lp-btn-glow"
                  onClick={getStarted}
                >
                  Get Started
                </button>
              </div>
              <p className="lp-hero-trust">No card needed. First exports on us.</p>
              <p className="lp-final-note">Takes under 2 minutes from upload to export.</p>
            </Reveal>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-container lp-footer-row">
          <div>
            <div className="lp-footer-brand">
              <img src="/logo.png" alt="Asaan Caption" className="lp-footer-logo" />
            </div>
            <p className="lp-footer-tagline">Built for the way Pakistan speaks.</p>
          </div>
          <ul className="lp-footer-links">
            <li>
              <a href="#how-it-works">How It Works</a>
            </li>
            <li>
              <a href="#pricing">Pricing</a>
            </li>
            <li>
              <a href="#top">Privacy</a>
            </li>
            <li>
              <a href="#top">Contact</a>
            </li>
          </ul>
        </div>
        <div className="lp-footer-bottom">
          <div className="lp-container">
            <p>© 2026 Asaan Caption — Built for the way Pakistan speaks.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
