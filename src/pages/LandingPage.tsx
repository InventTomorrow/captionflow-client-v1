import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { LayoutGrid } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useFlagsStore } from '../stores/flagsStore';
import { PricingCards, discountedPrice, type ApiPlan } from '../components/PricingCards';
import { usePlans } from '../lib/usePlans';
import { ManualPaymentModal } from '../components/ManualPaymentModal';
import { HeroBackdrop } from '../components/HeroBackdrop';
import { SparkleBackdrop } from '../components/SparkleBackdrop';
import { MeshBackdrop } from '../components/MeshBackdrop';
import { AmbientBackdrop } from '../components/AmbientBackdrop';
import { TemplateShowcase, type ShowcaseTemplate } from '../components/TemplateShowcase';
import { WorkflowSteps } from '../components/WorkflowSteps';
import { DifferenceShowcase } from '../components/DifferenceShowcase';
import { WhyWeBuilt } from '../components/WhyWeBuilt';

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

/** Delay (ms) into the hero's load sequence — read by the lp-hero-word / lp-hero-in keyframes. */
const enterAt = (ms: number) => ({ '--lp-in': ms }) as CSSProperties;

/**
 * One headline line, split into words that rise into place one after another.
 *
 * `accent` paints the line in the green gradient. A text-clipped gradient on
 * the whole line garbles once the words animate on their own layers, so each
 * word clips the gradient to its own glyphs instead — and is told where it
 * sits in the line (--lp-word-x / --lp-line-w) so it paints its slice of one
 * line-wide gradient and the line still reads as a single continuous sweep.
 */
function HeroWords({
  text,
  start,
  step = 90,
  accent = false,
}: {
  text: string;
  start: number;
  step?: number;
  accent?: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const line = ref.current;
    if (!line || !accent) return;
    const apply = () => {
      const width = line.offsetWidth;
      line.querySelectorAll<HTMLElement>('.lp-hero-word').forEach((word) => {
        word.style.setProperty('--lp-line-w', `${width}px`);
        word.style.setProperty('--lp-word-x', `${-word.offsetLeft}px`);
      });
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(line);
    return () => ro.disconnect();
  }, [accent, text]);

  return (
    <span ref={ref} className={`lp-hero-line${accent ? ' lp-hero-line-accent' : ''}`}>
      {text.split(' ').map((word, i) => (
        <Fragment key={`${word}-${i}`}>
          {i > 0 && ' '}
          <span className="lp-hero-word" style={enterAt(start + i * step)}>
            {word}
          </span>
        </Fragment>
      ))}
    </span>
  );
}

/**
 * Nudges its child toward the mouse while the cursor is over it and lets the
 * CSS transition ease it back — the hero CTAs feel pulled toward the hand.
 * Touch pointers and reduced-motion visitors get a still button.
 */
function Magnetic({ children, strength = 0.32 }: { children: ReactNode; strength?: number }) {
  const ref = useRef<HTMLSpanElement>(null);

  const onMove = (e: ReactPointerEvent<HTMLSpanElement>) => {
    const el = ref.current;
    if (!el || e.pointerType !== 'mouse') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const rect = el.getBoundingClientRect();
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    el.style.transform = `translate(${(dx * strength).toFixed(1)}px, ${(dy * strength).toFixed(1)}px)`;
  };

  const onLeave = () => {
    if (ref.current) ref.current.style.transform = '';
  };

  return (
    <span ref={ref} className="lp-magnet" onPointerMove={onMove} onPointerLeave={onLeave}>
      {children}
    </span>
  );
}

/** One link per page section, in page order; the active underline follows these ids. */
const NAV_LINKS: Array<{ id: string; label: string }> = [
  { id: 'templates', label: 'Templates' },
  { id: 'difference', label: 'Features' },
  { id: 'how-it-works', label: 'How It Works' },
  { id: 'about', label: 'Why Us' },
  { id: 'pricing', label: 'Pricing' },
  { id: 'day-pass', label: 'Day Pass' },
];

/** Posters are the `-stage` versions: the same frames scaled to the size the
 *  stage shows them at. The full-size ones cost a visible hitch to decode and
 *  upload, all five at once, the moment the section scrolled into view. */
const TEMPLATES: ShowcaseTemplate[] = [
  { name: 'Word Pop', video: '/landing/templates/tpl-1.mp4', poster: '/landing/templates/tpl-1-stage.jpg' },
  { name: 'Karaoke Fill', video: '/landing/templates/tpl-2.mp4', poster: '/landing/templates/tpl-2-stage.jpg' },
  { name: 'Bold Impact', video: '/landing/templates/tpl-3.mp4', poster: '/landing/templates/tpl-3-stage.jpg' },
  { name: 'Clean Single Line', video: '/landing/templates/tpl-4.mp4', poster: '/landing/templates/tpl-4-stage.jpg' },
  { name: 'Minimal Sub', video: '/landing/templates/tpl-5.mp4', poster: '/landing/templates/tpl-5-stage.jpg' },
];

export function LandingPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [yearly, setYearly] = useState(false);
  const { plans, failed: plansFailed, retry: retryPlans } = usePlans();
  const flags = useFlagsStore((s) => s.flags);
  const bankTransfer = useFlagsStore((s) => s.bankTransfer);
  const launchOffer = useFlagsStore((s) => s.launchOffer);
  const loadFlags = useFlagsStore((s) => s.load);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [selectedPaymentSlug, setSelectedPaymentSlug] = useState('');
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const heroRef = useRef<HTMLElement>(null);

  useEffect(() => {
    void loadFlags();
  }, [loadFlags]);

  // The hero backdrop runs behind the floating nav: the hero is pulled up by
  // the header's height (--lp-nav-h) and pads its copy back down below it.
  // Measured rather than hard-coded — the maintenance banner and the mobile
  // panel both live inside the header and change its height.
  useEffect(() => {
    const body = bodyRef.current;
    const header = headerRef.current;
    if (!body || !header) return;
    // Measured to the bottom of the pill, not the whole header: with the
    // mobile menu open the header is hundreds of pixels taller, and a
    // section tapped in that menu landed that far below the nav.
    const apply = () => {
      const shell = header.querySelector<HTMLElement>('.lp-nav-shell');
      const h = shell
        ? shell.getBoundingClientRect().bottom - header.getBoundingClientRect().top
        : header.offsetHeight;
      body.style.setProperty('--lp-nav-h', `${Math.round(h)}px`);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(header);
    return () => ro.disconnect();
  }, []);

  // Scroll: the nav pill tightens once the page moves, the hero copy
  // parallaxes (--lp-hero-scroll, read by the CSS) and the scroll cue fades.
  // Throttled to one update per frame, and written straight to the DOM:
  // a state change here would re-render the whole landing page mid-scroll.
  useEffect(() => {
    let frame = 0;
    let settle = 0;
    const update = () => {
      frame = 0;
      const y = window.scrollY;
      headerRef.current?.classList.toggle('is-scrolled', y > 12);
      const hero = heroRef.current;
      if (hero) {
        hero.style.setProperty('--lp-hero-scroll', String(Math.min(y, 900)));
        hero.classList.toggle('is-scrolled', y > 80);
      }
    };
    // While the page is moving, the decorative loops (backdrops, card
    // motifs, glows) are paused via .is-scrolling: dozens of compositor
    // animations ticking under a scroll is what made it stutter on an
    // integrated GPU. They resume a beat after the scroll settles.
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
      const body = bodyRef.current;
      if (body) {
        body.classList.add('is-scrolling');
        window.clearTimeout(settle);
        settle = window.setTimeout(() => body.classList.remove('is-scrolling'), 160);
      }
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
      window.clearTimeout(settle);
    };
  }, []);

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

  // Underline the nav link for whichever section is crossing the middle of
  // the viewport; the hero ("top") clears it. Toggled directly on the links
  // rather than through state, so a section change never re-renders the
  // page while it is scrolling. Re-registered when the day-pass section
  // appears, since it only renders once plans have loaded.
  useEffect(() => {
    const setActive = (id: string) => {
      headerRef.current?.querySelectorAll<HTMLAnchorElement>('.lp-nav-links a').forEach((a) => {
        const on = id !== '' && a.getAttribute('href') === `#${id}`;
        a.classList.toggle('is-active', on);
        if (on) a.setAttribute('aria-current', 'location');
        else a.removeAttribute('aria-current');
      });
    };
    const sections = ['top', ...NAV_LINKS.map((l) => l.id)]
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(entry.target.id === 'top' ? '' : entry.target.id);
        }
      },
      { rootMargin: '-45% 0px -50% 0px', threshold: 0 },
    );
    sections.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, [dayPassPlans.length]);

  const browseTemplates = () => {
    document.getElementById('templates')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

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

  return (
    <div className="lp-body" ref={bodyRef}>
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
      <header ref={headerRef} className="lp-nav">
        {flags.maintenanceMode && (
          <div className="maintenance-banner">
            {flags.maintenanceMessage ||
              'Asaan Caption is undergoing maintenance - some features may be unavailable.'}
          </div>
        )}
        <nav className="lp-nav-shell lp-glass">
          <a href="#top" className="lp-brand">
            <img src="/logo.png" alt="Asaan Caption" className="lp-brand-logo" />
          </a>
          <ul className="lp-nav-links">
            {NAV_LINKS.map((link) => (
              <li key={link.id}>
                <a href={`#${link.id}`}>{link.label}</a>
              </li>
            ))}
          </ul>
          <div className="lp-nav-actions">
            {/* Ghost slot beside Get Started: a visitor signs in here, and once
                a session exists the same click just goes back into the app. */}
            <button type="button" className="lp-btn lp-btn-ghost lp-nav-signin" onClick={getStarted}>
              {user ? 'Dashboard' : 'Sign in'}
            </button>
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
            {NAV_LINKS.map((link) => (
              <a key={link.id} href={`#${link.id}`} onClick={() => setMobileOpen(false)}>
                {link.label}
              </a>
            ))}
            <button type="button" className="lp-btn lp-btn-ghost lp-mobile-cta" onClick={getStarted}>
              {user ? 'Dashboard' : 'Sign in'}
            </button>
            <button type="button" className="lp-btn lp-btn-primary lp-mobile-cta" onClick={getStarted}>
              Get Started
            </button>
          </div>
        </div>
      </header>

      <main>
        <section id="top" ref={heroRef} className="lp-hero">
          <HeroBackdrop />
          <div className="lp-container lp-center">
            <h1 className="lp-hero-title">
              <HeroWords text="Need Urdish Captions?" start={140} accent />
              <br />
              <HeroWords text="We Got it." start={430} />
            </h1>
            <p className="lp-hero-sub lp-center-text lp-hero-in" style={enterAt(720)}>
              Other tools break when Urdu meets English.{' '}
              <span className="lp-hero-karaoke">We don&apos;t.</span>
            </p>
            <div className="lp-hero-ctas lp-hero-in" style={enterAt(880)}>
              <Magnetic>
                <button
                  type="button"
                  className="lp-btn lp-btn-primary lp-btn-lg lp-btn-glow lp-btn-shine"
                  onClick={getStarted}
                >
                  Get Started
                </button>
              </Magnetic>
              <Magnetic>
                <button
                  type="button"
                  className="lp-btn lp-btn-glassy lp-btn-lg"
                  onClick={browseTemplates}
                >
                  <LayoutGrid size={18} strokeWidth={2} aria-hidden="true" />
                  Browse Templates
                </button>
              </Magnetic>
            </div>
            <p className="lp-hero-trust lp-hero-in" style={enterAt(1060)}>
              Trusted by thousands of Pakistani creators
            </p>
          </div>
          <button
            type="button"
            className="lp-hero-cue lp-hero-in"
            style={enterAt(1600)}
            onClick={browseTemplates}
            aria-label="Scroll to templates"
          >
            <span className="lp-hero-cue-mouse" aria-hidden="true" />
            <span aria-hidden="true">Scroll</span>
          </button>
        </section>

        <section
          id="templates"
          className="lp-section lp-section-surface lp-section-sparkle lp-section-stage"
        >
          <SparkleBackdrop />
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
              <TemplateShowcase templates={TEMPLATES} onUse={getStarted} />
            </Reveal>
          </div>
        </section>

        <section id="difference" className="lp-section lp-diff">
          <AmbientBackdrop />
          <div className="lp-diff-arc" aria-hidden="true" />
          <div className="lp-container">
            <Reveal className="lp-section-head">
              <p className="lp-eyebrow lp-eyebrow-pill">
                <span className="lp-eyebrow-dot" aria-hidden="true" />
                Built for real conversations
              </p>
              <h2 className="lp-h2 lp-h2-wide">
                Speak in <span className="lp-accent-text">Urdu</span>, English, or both.
                <br />
                <span className="lp-accent-text">Asaan Caption</span> understands what others miss.
              </h2>
              <p className="lp-body-text lp-narrow-text">
                Accurate, natural captions for real Pakistani speech, with no awkward guesses.
              </p>
            </Reveal>
            <DifferenceShowcase />
          </div>
          <div className="lp-diff-floor" aria-hidden="true" />
        </section>

        <section id="how-it-works" className="lp-section lp-section-ambient">
          <AmbientBackdrop />
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
            <WorkflowSteps />
          </div>
        </section>

        <section id="about" className="lp-section lp-why-section">
          <AmbientBackdrop />
          <div className="lp-diff-arc" aria-hidden="true" />
          <div className="lp-container">
            <Reveal className="lp-section-head">
              <p className="lp-eyebrow">Why we built this</p>
              <span className="lp-eyebrow-line" aria-hidden="true" />
              <h2 className="lp-h2 lp-h2-wide">
                Why we built <span className="lp-accent-text">Asaan Caption</span>
              </h2>
              <p className="lp-body-text lp-narrow-text">
                Most tools were not built for real Pakistani speech. We made one that is.
              </p>
            </Reveal>
            <WhyWeBuilt />
          </div>
        </section>

        <div className="lp-mesh-zone">
          <MeshBackdrop />

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
                <PricingCards
                  plans={subscriptionPlans}
                  failed={plansFailed}
                  onRetry={retryPlans}
                  yearly={yearly}
                  onSelectPlan={selectSubscriptionPlan}
                />
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
                    One-time access, no auto-renewal - perfect for a single shoot or a quick campaign.
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
        </div>

        <ManualPaymentModal
          open={paymentModalOpen}
          onClose={() => setPaymentModalOpen(false)}
          plans={plans}
          initialSlug={selectedPaymentSlug}
        />
      </main>

      <footer className="lp-footer">
        <div className="lp-ft-top">
          <div className="lp-ft-brand-col">
            <a href="#top" className="lp-ft-brand-mark">
              <img src="/logo.png" alt="Asaan Caption" className="lp-ft-brand-logo" />
            </a>

            <p className="lp-ft-tagline">
              Automatic captions engineered for the way Pakistan speaks — Urdu, Roman Urdu, and
              everything in between.
            </p>

            <div className="lp-ft-badges">
              <span className="lp-ft-badge lp-ft-badge-accent">🇵🇰 Pakistan-first</span>
              <span className="lp-ft-badge">Urdu &amp; Roman Urdu</span>
              <span className="lp-ft-badge">AI-powered</span>
            </div>
          </div>

          <div className="lp-ft-nav-col">
            <div className="lp-ft-col-label">Product</div>
            <ul className="lp-ft-links">
              {NAV_LINKS.map((link) => (
                <li key={link.id}>
                  <a href={`#${link.id}`}>
                    <span className="lp-ft-dot" />
                    {link.label}
                  </a>
                </li>
              ))}
              {/* The same WhatsApp number the payment flow uses, set by the
                  admin under bank-transfer settings; hidden until it is. */}
              {bankTransfer.whatsappNumber && (
                <li>
                  <a
                    href={`https://wa.me/${bankTransfer.whatsappNumber.replace(/[^0-9]/g, '')}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span className="lp-ft-dot" />
                    Contact on WhatsApp
                  </a>
                </li>
              )}
            </ul>
          </div>

          <div className="lp-ft-nav-col">
            <div className="lp-ft-col-label">Legal</div>
            <ul className="lp-ft-links">
              <li>
                <a href="#top">
                  <span className="lp-ft-dot" />
                  Privacy Policy
                </a>
              </li>
              <li>
                <a href="#top">
                  <span className="lp-ft-dot" />
                  Terms of Service
                </a>
              </li>
              <li>
                <a href="#top">
                  <span className="lp-ft-dot" />
                  Cookie Policy
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="lp-ft-divider" />

        <div className="lp-ft-bottom">
          <p className="lp-ft-copy">
            © 2026 <strong>Asaan Caption</strong> — Built for the way Pakistan speaks.
          </p>

          <div className="lp-ft-bottom-links">
            <button type="button" className="lp-ft-bottom-btn" onClick={getStarted}>
              {user ? 'Dashboard' : 'Sign in'}
            </button>
            <a href="#top">Back to top</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
