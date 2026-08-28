import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import ReactSlick from 'react-slick';
import type { Settings } from 'react-slick';
import 'slick-carousel/slick/slick.css';
import 'slick-carousel/slick/slick-theme.css';
import {
  MessageSquare,
  SquarePen,
  CloudUpload,
  AudioLines,
  ALargeSmall,
  Download,
  Users,
  Target,
  Zap,
  FileVideo,
  History,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuthStore } from '../stores/authStore';
import { useFlagsStore } from '../stores/flagsStore';
import { PricingCards, discountedPrice, type ApiPlan } from '../components/PricingCards';
import { ManualPaymentModal } from '../components/ManualPaymentModal';

/** Vite/CJS interop: default export can be nested as `{ default: Component }`. */
const Slider = ((ReactSlick as unknown as { default?: typeof ReactSlick }).default ??
  ReactSlick) as typeof ReactSlick;

/** Yearly billing toggle hidden for now — flip back on when yearly pricing is ready to promote. */
const SHOW_YEARLY_TOGGLE = false;

/** Fades a section in once it scrolls into view (mirrors the original mockup's .cf-reveal). */
function Reveal({
  children,
  delayMs = 0,
  className = '',
  id,
}: {
  children: ReactNode;
  delayMs?: number;
  className?: string;
  id?: string;
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
      id={id}
      className={`lp-reveal ${visible ? 'is-visible' : ''} ${className}`.trim()}
      style={{ transitionDelay: `${delayMs}ms` }}
    >
      {children}
    </div>
  );
}

const DIFFERENTIATORS: Array<{ icon: LucideIcon | null; badge?: string; title: string; body: string }> = [
  {
    icon: MessageSquare,
    title: 'Trained on Real Pakistani Speech',
    body: 'Fine-tuned specifically on local accents, slang, and seamless code-switching—not an English AI guessing Urdu phonetics.',
  },
  {
    icon: SquarePen,
    title: 'Full Control Before You Post',
    body: 'Easily fix spelling, change line lengths, and adjust word timing with zero hassle.',
  },
  {
    icon: null,
    badge: '4K',
    title: 'High-Quality & Ready to Upload',
    body: 'Download crisp 4K videos with ready-to-use caption styles, or get simple subtitle files for your video editor.',
  },
];

const WHY_WE_BUILT: Array<{ icon: LucideIcon; title: string; body: string }> = [
  {
    icon: Users,
    title: 'Built for Pakistan',
    body: 'Trained on how Pakistan actually speaks — not just textbook English.',
  },
  {
    icon: Target,
    title: 'More Accurate',
    body: 'Understands Urdu, English, Roman Urdu, and code-switching like a native.',
  },
  {
    icon: Zap,
    title: 'Saves You Time',
    body: 'From hours to minutes. Focus on creating, not editing captions.',
  },
  {
    icon: FileVideo,
    title: 'Ready for Anything',
    body: 'Export in multiple formats, including 4K — ready for any platform.',
  },
];

const STEPS: Array<{ icon: LucideIcon; title: string; body: string }> = [
  { icon: CloudUpload, title: 'Upload', body: 'Upload your video or audio file.' },
  { icon: AudioLines, title: 'Transcribe', body: 'We transcribe your content.' },
  { icon: MessageSquare, title: 'Generate Captions', body: 'AI generates accurate captions instantly.' },
  { icon: ALargeSmall, title: 'Style', body: 'Choose a style that fits your content.' },
  { icon: Download, title: 'Export', body: 'Export and share your content.' },
];

const TEMPLATES: Array<{ name: string; video: string; poster: string }> = [
  { name: 'Word Pop', video: '/landing/templates/tpl-1.mp4', poster: '/landing/templates/tpl-1.jpg' },
  { name: 'Karaoke Fill', video: '/landing/templates/tpl-2.mp4', poster: '/landing/templates/tpl-2.jpg' },
  { name: 'Bold Impact', video: '/landing/templates/tpl-3.mp4', poster: '/landing/templates/tpl-3.jpg' },
  { name: 'Clean Single Line', video: '/landing/templates/tpl-4.mp4', poster: '/landing/templates/tpl-4.jpg' },
  { name: 'Minimal Sub', video: '/landing/templates/tpl-5.mp4', poster: '/landing/templates/tpl-5.jpg' },
];

export function LandingPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [yearly, setYearly] = useState(false);
  const [plans, setPlans] = useState<ApiPlan[] | null>(null);
  /** Start centered on tpl-2 so the first view is tpl-1 | tpl-2 | tpl-3. */
  const [tplIdx, setTplIdx] = useState(1);
  const tplSliderRef = useRef<InstanceType<typeof Slider> | null>(null);
  const flags = useFlagsStore((s) => s.flags);
  const launchOffer = useFlagsStore((s) => s.launchOffer);
  const loadFlags = useFlagsStore((s) => s.load);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [selectedPaymentSlug, setSelectedPaymentSlug] = useState('');
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);

  useEffect(() => {
    void loadFlags();
    void api
      .get('/billing/plans')
      .then((r) => setPlans(r.data.plans))
      .catch(() => setPlans([]));
  }, [loadFlags]);

  // `<Link to="/#pricing">` (used by upgrade CTAs elsewhere in the app) is a
  // client-side route change, not a real page load — the browser only
  // auto-scrolls to a URL hash on an actual navigation, so arriving here
  // from another route lands at the top instead of the target section
  // unless we scroll to it ourselves.
  useEffect(() => {
    if (!location.hash) return;
    const id = location.hash.slice(1);
    const raf = requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => cancelAnimationFrame(raf);
  }, [location.hash]);

  // Dismissal is only in-memory (not persisted to storage) — closing the
  // banner hides it for this page view, but it comes back on refresh so a
  // live launch offer keeps getting seen rather than being hidden forever
  // after one click.
  function dismissBanner() {
    setBannerDismissed(true);
  }

  const subscriptionPlans = plans?.filter((p) => !p.isOneTime) ?? null;
  const dayPassPlans = plans?.filter((p) => p.isOneTime) ?? [];

  /** Get Started always resolves against the current session — no session → /login, signed in → /projects/upload. */
  const getStarted = () => {
    if (loading) return;
    navigate(user ? '/projects/upload' : '/login');
    setMobileOpen(false);
  };

  /** Subscription plan cards have no online checkout — route the pick into
   *  the manual bank-transfer payment popup instead, same as day passes.
   *  The free tier has nothing to pay, so it keeps the old sign-up flow. */
  const selectSubscriptionPlan = (plan: ApiPlan) => {
    if (plan.priceMonthlyPkr <= 0) {
      getStarted();
      return;
    }
    setSelectedPaymentSlug(plan.slug);
    setPaymentModalOpen(true);
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

  return (
    <div className="lp-body">
      {launchOffer.enabled && launchOffer.text && !bannerDismissed && (
        <div className="lp-launch-banner">
          <span className="lp-launch-banner-icon" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M13 2 5 13h5.5L10 22l8-11h-5.5z" />
            </svg>
          </span>
          <span className="lp-launch-banner-text">{launchOffer.text}</span>
          <button
            type="button"
            className="lp-launch-banner-close"
            aria-label="Dismiss offer"
            onClick={dismissBanner}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
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
              <a href="#templates">Templates</a>
            </li>
            <li>
              <a href="#difference">Features</a>
            </li>
            <li>
              <a href="#how-it-works">How It Works</a>
            </li>
            <li>
              <a href="#pricing">Pricing</a>
            </li>
            <li>
              <a href="#day-pass">Day Pass</a>
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
            <a href="#templates" onClick={() => setMobileOpen(false)}>
              Templates
            </a>
            <a href="#difference" onClick={() => setMobileOpen(false)}>
              Features
            </a>
            <a href="#how-it-works" onClick={() => setMobileOpen(false)}>
              How It Works
            </a>
            <a href="#pricing" onClick={() => setMobileOpen(false)}>
              Pricing
            </a>
            <a href="#day-pass" onClick={() => setMobileOpen(false)}>
              Day Pass
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
                          poster={t.poster}
                          muted
                          loop
                          playsInline
                          preload="metadata"
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
                    &quot;Super super chai tea ke calm pay nick low&quot;
                  </p>
                </div>
                <div className="lp-compare-card lp-compare-good">
                  <p className="lp-compare-label">Asaan Caption</p>
                  <p className="lp-compare-text">
                    &quot;Subah subah chai peeyo, aur kaam pe niklo tension-free ho ke.&quot;
                  </p>
                </div>
              </div>
              <p className="lp-compare-footnote">
                Understands local pronunciation, accents, and everyday slangs.
              </p>
            </Reveal>
          </div>
        </section>

        <section id="difference" className="lp-section lp-section-surface">
          <div className="lp-container">
            <Reveal className="lp-section-head">
              <p className="lp-eyebrow">The Asaan Caption difference</p>
              <span className="lp-eyebrow-line" aria-hidden="true" />
              <h2 className="lp-h2 lp-h2-wide">
                Speak in <span className="lp-accent-text">Urdu</span>, English, or both.
                <br />
                Asaan <span className="lp-accent-text">Caption</span> handles the rest.
              </h2>
            </Reveal>
            <div className="lp-grid-3">
              {DIFFERENTIATORS.map((d, i) => (
                <Reveal key={d.title} delayMs={i * 100}>
                  <article className="lp-card lp-card-feature">
                    <div className={`lp-icon-ring${d.badge ? ' is-square' : ''}`}>
                      {d.icon ? <d.icon size={20} strokeWidth={1.75} /> : d.badge}
                    </div>
                    <h3 className="lp-card-title">{d.title}</h3>
                    <div className="lp-card-divider" aria-hidden="true" />
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
              <span className="lp-eyebrow-line" aria-hidden="true" />
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
                  <Reveal key={step.title} delayMs={i * 90} className="lp-step">
                    <div className="lp-step-icon-wrap">
                      <div className="lp-step-icon">
                        <step.icon size={22} strokeWidth={2} />
                      </div>
                      <span className="lp-step-number">{String(i + 1).padStart(2, '0')}</span>
                    </div>
                    <h3 className="lp-step-title">{step.title}</h3>
                    <p className="lp-step-body">{step.body}</p>
                  </Reveal>
                ))}
              </ol>
            </div>
          </div>
        </section>

        <section id="about" className="lp-section lp-section-surface">
          <div className="lp-container">
            <Reveal className="lp-section-head">
              <p className="lp-eyebrow">Why we built this</p>
              <span className="lp-eyebrow-line" aria-hidden="true" />
              <h2 className="lp-h2 lp-h2-wide">
                Why we built <span className="lp-accent-text">Asaan Caption</span>
              </h2>
            </Reveal>
            <Reveal>
              <div className="lp-about-card lp-glass">
                <div className="lp-icon-ring lp-about-icon">
                  <History size={20} strokeWidth={1.75} />
                </div>
                <p className="lp-body-text">
                  <strong className="lp-body-strong">
                    Subtitling was the slowest part of our workflow — every tool treated Pakistani
                    speech as an afterthought.
                  </strong>{' '}
                  So we built our own. Asaan Caption is trained on real Pakistani speech patterns
                  to give you captions that are accurate, natural, and actually sound like us.
                </p>
              </div>
            </Reveal>
            <div className="lp-grid-4">
              {WHY_WE_BUILT.map((d, i) => (
                <Reveal key={d.title} delayMs={i * 100}>
                  <article className="lp-card">
                    <div className="lp-icon-ring">
                      <d.icon size={20} strokeWidth={1.75} />
                    </div>
                    <h3 className="lp-card-title">{d.title}</h3>
                    <div className="lp-card-divider" aria-hidden="true" />
                    <p className="lp-card-body">{d.body}</p>
                  </article>
                </Reveal>
              ))}
            </div>
            <Reveal className="lp-about-badge-wrap">
              <span className="lp-pill lp-made-badge">
                <ShieldCheck size={16} strokeWidth={2} />
                Made in Pakistan. <span className="lp-accent-text">Built for creators like you.</span>
              </span>
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
            {SHOW_YEARLY_TOGGLE && (
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
            )}
            <Reveal>
              <PricingCards plans={subscriptionPlans} yearly={yearly} onSelectPlan={selectSubscriptionPlan} />
            </Reveal>
            <ul className="lp-hero-tags lp-price-notes">
              <li className="lp-pill">✓ No hidden fees</li>
              <li className="lp-pill">✓ Cancel any time</li>
              <li className="lp-pill">✓ First exports free</li>
            </ul>
          </div>
        </section>

        {dayPassPlans.length > 0 && (
          <section id="day-pass" className="lp-section lp-daypass-section">
            <div className="lp-container">
              <Reveal className="lp-section-head lp-daypass-head">
                <p className="lp-eyebrow">No subscription needed</p>
                <h2 className="lp-h2">
                  Short on time? <span className="lp-accent-text">Grab a Pass</span>
                </h2>
                <p className="lp-body-text lp-narrow-text">
                  One-time access, no auto-renewal — perfect for a single shoot or a quick campaign.
                </p>
              </Reveal>
              <div className="lp-daypass-layout">
                <div className="lp-daypass-grid">
                  {dayPassPlans.map((p, i) => {
                    const discounted = discountedPrice(p.priceMonthlyPkr, p);
                    return (
                      <Reveal key={p._id} delayMs={i * 100}>
                        <article className="lp-card lp-price-card lp-daypass-card">
                          {discounted != null && (
                            <span className="lp-price-discount-ribbon">{p.discountPercent}% OFF</span>
                          )}
                          <h3 className="lp-price-name">{p.name}</h3>
                          {p.description && <p className="lp-price-desc">{p.description}</p>}
                          <div className="lp-price-amount">
                            <div className="lp-price-figure-row">
                              {discounted != null && (
                                <span className="lp-price-was">PKR {p.priceMonthlyPkr.toLocaleString()}</span>
                              )}
                              <span className="lp-price-currency">PKR</span>
                              <span className="lp-price-figure">
                                {(discounted ?? p.priceMonthlyPkr).toLocaleString()}
                              </span>
                            </div>
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
                            className="lp-btn lp-btn-primary lp-price-cta"
                            onClick={() => {
                              setSelectedPaymentSlug(p.slug);
                              setPaymentModalOpen(true);
                            }}
                          >
                            Get {p.name}
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
              </div>
            </div>
          </section>
        )}

        <ManualPaymentModal
          open={paymentModalOpen}
          onClose={() => setPaymentModalOpen(false)}
          plans={plans}
          initialSlug={selectedPaymentSlug}
        />

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
