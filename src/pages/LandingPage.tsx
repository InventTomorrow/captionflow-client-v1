/**
 * LandingPage — the public home page. The design comes from
 * github.com/rehan-automates/asaancaption-landingpage (static HTML); its
 * styles live in ./landing/landing.css, scoped under `.lp2` so none of its
 * generic class names reach the app. Here its preview dialogs are replaced
 * by the real app: sign in, Get Started, the admin-managed plans and day
 * passes (paid ones open the bank-transfer popup), launch offer, maintenance
 * banner, WhatsApp and the legal pages.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useFlagsStore } from '../stores/flagsStore';
import { discountedPrice, type ApiPlan } from '../components/PricingCards';
import { usePlans } from '../lib/usePlans';
import { ManualPaymentModal } from '../components/ManualPaymentModal';
import { BrandLogo } from '../components/BrandLogo';
import './landing/landing.css';

const NAV = [
  { id: 'templates', label: 'Templates' },
  { id: 'features', label: 'Features' },
  { id: 'viral-clips', label: 'Viral Clips', isNew: true },
  { id: 'how-it-works', label: 'How it works' },
  { id: 'pricing', label: 'Pricing' },
];

const TEMPLATES = [
  { name: 'Word Pop', art: 'art-pop', top: 'WORD BY WORD', text: <>Apni <mark>kahani.</mark><br />Apne lafz.</> },
  { name: 'Karaoke Fill', art: 'art-karaoke', top: 'FOLLOW YOUR VOICE', text: <>Har lafz<br /><mark>ke saath.</mark></> },
  { name: 'Bold Impact', art: 'art-bold', top: 'MAKE IT LOUD', text: <>BAAT MEIN<br /><mark>DUM HAI.</mark></> },
  { name: 'Clean Single Line', art: 'art-clean', top: 'LESS IS MORE', text: <>Bas, itni si baat.</> },
  { name: 'Minimal Sub', art: 'art-minimal', top: 'LET THE STORY SPEAK', text: <>Chalo, shuru karte hain.</> },
];

const CLIPS = [
  { title: 'The idea that changed everything', meta: '00:38', score: 96, caption: <>The idea that<br /><span>changed everything.</span></> },
  { title: 'Nobody tells you this at the start', meta: '00:27', score: 91, caption: <>Nobody tells you this<br /><span>at the start.</span></> },
  { title: 'The one habit that actually worked', meta: '00:44', score: 88, caption: <>The one habit<br /><span>that actually worked.</span></> },
];

const STEPS: { title: string; text: string; preview: ReactNode }[] = [
  {
    title: 'Upload',
    text: 'Upload your video or audio file.',
    preview: (
      <div className="upload-preview">
        <span className="upload-symbol">↥</span>
        <strong>Drag &amp; drop a video,<br />or click to browse</strong>
        <span>MP4, MOV, AVI, MKV, WEBM</span>
        <div className="upload-file"><span>▤</span><span>podcast-clip.mp4<small>Ready to upload</small></span><span>✓</span></div>
      </div>
    ),
  },
  {
    title: 'Transcribe',
    text: 'We transcribe your content in seconds.',
    preview: (
      <div className="transcribe-preview">
        <span className="preview-title">TRANSCRIPT / ROMAN URDU</span>
        <div className="transcribe-line"><span>00:20</span>Subah subah chai peeyo,</div>
        <div className="transcribe-line"><span>00:23</span>aur kaam pe niklo</div>
        <div className="transcribe-line"><span>00:26</span>tension-free ho ke.</div>
        <div className="transcribe-line"><span>00:28</span>Chalo, shuru karte hain.</div>
      </div>
    ),
  },
  {
    title: 'Generate Captions',
    text: 'AI generates accurate captions instantly.',
    preview: (
      <div className="caption-preview">
        <span>CAPTIONS / WORD POP</span>
        <strong>aur <mark>kaam</mark> pe niklo</strong>
        <span>00:23 — 00:26</span>
      </div>
    ),
  },
  {
    title: 'Style',
    text: 'Choose a style that fits your content.',
    preview: (
      <div className="styles-preview">
        <span className="preview-title">CHOOSE YOUR STYLE</span>
        <div className="style-option">TikTok Classic <span>✓</span></div>
        <div className="style-option">Roboto Word Pop</div>
        <div className="style-option">TikTok Pill</div>
        <div className="style-option">Clean White</div>
        <div className="style-option">Poppins Bold</div>
      </div>
    ),
  },
  {
    title: 'Export',
    text: 'Export and share your content.',
    preview: (
      <div className="export-preview">
        <h3>Export Video</h3>
        <div className="export-row"><span>Quality</span><span>1080p — Full HD</span></div>
        <div className="export-row"><span>Format</span><span>MP4 (H.264)</span></div>
        <div className="export-row"><span>Frame rate</span><span>30 FPS — Faster Export</span></div>
        <div className="export-ready">✓ RENDERING COMPLETE · READY</div>
        <div className="export-button"><span>Download 1080p MP4</span><span>↓</span></div>
      </div>
    ),
  },
];

const pkr = (n: number) => n.toLocaleString('en-PK');
const two = (n: number) => String(n).padStart(2, '0');

export function LandingPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);
  const flags = useFlagsStore((s) => s.flags);
  const launchOffer = useFlagsStore((s) => s.launchOffer);
  const bankTransfer = useFlagsStore((s) => s.bankTransfer);
  const loadFlags = useFlagsStore((s) => s.load);
  const { plans, failed: plansFailed, retry: retryPlans } = usePlans();

  const [menuOpen, setMenuOpen] = useState(false);
  const [template, setTemplate] = useState(0);
  const [clip, setClip] = useState(0);
  const [step, setStep] = useState(0);
  const [videoPaused, setVideoPaused] = useState(false);
  const [paymentSlug, setPaymentSlug] = useState('');
  const [paymentOpen, setPaymentOpen] = useState(false);

  const headerRef = useRef<HTMLElement>(null);
  const heroRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const stepRefs = useRef<(HTMLButtonElement | null)[]>([]);
  /** False once the user paused the motion (or prefers reduced motion). */
  const videoWanted = useRef(true);

  useEffect(() => {
    void loadFlags();
  }, [loadFlags]);

  // Anchor links scroll smoothly and land below the floating nav (page-wide, while this page is open).
  useEffect(() => {
    const html = document.documentElement;
    const prev = { behavior: html.style.scrollBehavior, padding: html.style.scrollPaddingTop };
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) html.style.scrollBehavior = 'smooth';
    html.style.scrollPaddingTop = window.innerWidth <= 600 ? '96px' : '112px';
    return () => {
      html.style.scrollBehavior = prev.behavior;
      html.style.scrollPaddingTop = prev.padding;
    };
  }, []);

  // Links like "/#pricing" from elsewhere in the app are route changes, not page loads: scroll ourselves.
  useEffect(() => {
    if (!location.hash) return;
    const raf = requestAnimationFrame(() => document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start' }));
    return () => cancelAnimationFrame(raf);
  }, [location.hash]);

  // The floating nav becomes a pill after a little scroll; the change is animated with transforms (FLIP).
  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)');
    let scrolled = window.scrollY > 60;
    let frame = 0;
    let animation: Animation | undefined;
    header.classList.toggle('is-scrolled', scrolled);
    const update = () => {
      frame = 0;
      // A small dead zone stops the pill flickering around the threshold.
      const next = window.scrollY > (scrolled ? 48 : 72);
      if (next === scrolled) return;
      const first = reduce.matches ? null : header.getBoundingClientRect();
      animation?.cancel();
      scrolled = next;
      header.classList.toggle('is-scrolled', next);
      if (!first) return;
      const last = header.getBoundingClientRect();
      animation = header.animate(
        [
          { transform: `translateX(-50%) translate3d(${first.left - last.left}px, ${first.top - last.top}px, 0) scale(${first.width / last.width}, ${first.height / last.height})` },
          { transform: 'translateX(-50%) translate3d(0, 0, 0) scale(1, 1)' },
        ],
        { duration: 240, easing: 'cubic-bezier(.22, 1, .36, 1)' },
      );
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const onResize = () => animation?.cancel();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(frame);
      animation?.cancel();
    };
  }, []);

  // The hero video plays only while it is on screen, the tab is visible and motion is wanted.
  useEffect(() => {
    const video = videoRef.current;
    const hero = heroRef.current;
    if (!video || !hero) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)');
    if (reduce.matches) videoWanted.current = false;
    let inView = true;
    const sync = () => {
      if (videoWanted.current && inView && !document.hidden) {
        if (video.paused) video.play().catch(() => setVideoPaused(true));
      } else if (!video.paused) video.pause();
    };
    const onPlay = () => setVideoPaused(false);
    const onPause = () => setVideoPaused(true);
    const onReduce = (e: MediaQueryListEvent) => {
      if (!e.matches) return;
      videoWanted.current = false;
      sync();
    };
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    const io = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      sync();
    });
    io.observe(hero);
    document.addEventListener('visibilitychange', sync);
    reduce.addEventListener('change', onReduce);
    sync();
    return () => {
      io.disconnect();
      document.removeEventListener('visibilitychange', sync);
      reduce.removeEventListener('change', onReduce);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
    };
  }, []);

  // The mobile menu closes on Escape and when the window grows past the mobile layout.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    };
    const wide = matchMedia('(min-width:1101px)');
    const onWide = (e: MediaQueryListEvent) => {
      if (e.matches) setMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    wide.addEventListener('change', onWide);
    return () => {
      document.removeEventListener('keydown', onKey);
      wide.removeEventListener('change', onWide);
    };
  }, [menuOpen]);

  const toggleVideo = () => {
    const video = videoRef.current;
    if (!video) return;
    videoWanted.current = video.paused;
    if (video.paused) video.play().catch(() => setVideoPaused(true));
    else video.pause();
  };

  /** Signed in → straight to the app; otherwise sign in first. */
  const getStarted = () => {
    if (loading) return;
    setMenuOpen(false);
    navigate(user ? '/projects/upload' : '/login');
  };

  const startClipping = () => {
    if (loading) return;
    navigate(user ? '/clips' : '/login', user ? undefined : { state: { from: '/clips' } });
  };

  /** Free plans start right away; paid plans and passes open the bank-transfer popup. */
  const choosePlan = (plan: ApiPlan) => {
    if (plan.priceMonthlyPkr <= 0) {
      getStarted();
      return;
    }
    setPaymentSlug(plan.slug);
    setPaymentOpen(true);
  };

  const onStepKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number | undefined;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (index + 1) % STEPS.length;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (index - 1 + STEPS.length) % STEPS.length;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = STEPS.length - 1;
    if (next === undefined) return;
    e.preventDefault();
    setStep(next);
    const el = stepRefs.current[next];
    el?.focus();
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };

  const subscriptions = plans?.filter((p) => !p.isOneTime) ?? null;
  const passes = plans?.filter((p) => p.isOneTime) ?? [];
  const featuredSlug =
    subscriptions && subscriptions.length
      ? (subscriptions.find((p) => p.slug === 'creator') ?? subscriptions[Math.floor((subscriptions.length - 1) / 2)]).slug
      : '';
  const whatsapp = bankTransfer.whatsappNumber ? `https://wa.me/${bankTransfer.whatsappNumber.replace(/[^0-9]/g, '')}` : '';
  const showOffer = launchOffer.enabled && !!launchOffer.text;
  const signInLabel = user ? 'Open app' : 'Sign in';
  const goSignIn = () => {
    setMenuOpen(false);
    navigate(user ? '/projects/upload' : '/login');
  };
  const mobileLinks = [...NAV, { id: 'why-us', label: 'Why us' }, ...(passes.length ? [{ id: 'day-pass', label: 'Day Pass' }] : [])];

  return (
    <>
      <div className={`lp2${showOffer ? '' : ' no-offer'}${flags.maintenanceMode ? ' has-maintenance' : ''}`}>
        <a className="skip-link" href="#main">Skip to content</a>
        {flags.maintenanceMode && (
          <div className="maintenance-banner" role="status">
            {flags.maintenanceMessage || 'Asaan Caption is undergoing maintenance - some features may be unavailable.'}
          </div>
        )}
        {showOffer && (
          <div className="offer">
            <span className="offer-dot" />
            {launchOffer.text}
            <a href="#pricing" aria-label="View launch pricing">↗</a>
          </div>
        )}
        <header className="site-header" ref={headerRef}>
          <div className="nav-wrap">
            <a className="brand" href="#top" aria-label="Asaan Caption home">
              <BrandLogo />
            </a>
            <nav className="desktop-nav" aria-label="Main navigation">
              {NAV.map((n) => (
                <a key={n.id} href={`#${n.id}`}>
                  {n.label} {n.isNew && <span className="new-dot" />}
                </a>
              ))}
            </nav>
            <div className="nav-actions">
              <button type="button" className="sign-in text-button" onClick={goSignIn}>{signInLabel}</button>
              <button type="button" className="button button-small button-white" onClick={getStarted}>Get Started <span>↗</span></button>
              <button
                ref={menuButtonRef}
                type="button"
                className="menu-toggle"
                aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
                aria-expanded={menuOpen}
                aria-controls="mobile-nav"
                onClick={() => setMenuOpen((o) => !o)}
              >
                <span />
                <span />
              </button>
            </div>
          </div>
          <nav className="mobile-nav" id="mobile-nav" aria-label="Mobile navigation" hidden={!menuOpen}>
            {mobileLinks.map((n) => (
              <a key={n.id} href={`#${n.id}`} onClick={() => setMenuOpen(false)}>{n.label}</a>
            ))}
            <button type="button" className="text-button" onClick={goSignIn}>{signInLabel} ↗</button>
          </nav>
        </header>

        <main id="main">
          <section className="hero" id="top" aria-labelledby="hero-title" ref={heroRef}>
            <video ref={videoRef} className="hero-video" poster="/landing-v2/hero-poster.jpg" muted loop playsInline preload="metadata" aria-hidden="true">
              <source src="/landing-v2/hero.mp4" type="video/mp4" />
            </video>
            <div className="hero-topline page-width">
              <span>URDU. ENGLISH. EVERYTHING IN BETWEEN.</span>
              <span>MADE IN PAKISTAN <span className="tiny-star">✳</span></span>
            </div>
            <div className="hero-content page-width">
              <p className="eyebrow"><span className="status-dot" /> BUILT FOR THE WAY PAKISTAN SPEAKS</p>
              <h1 id="hero-title">Need Urdish captions?<br /><span className="brand-underline">We got it.</span></h1>
              <div className="hero-bottom">
                <div>
                  <p className="hero-description">Other tools break when Urdu meets English. We don&apos;t.</p>
                  <div className="hero-buttons">
                    <button type="button" className="button button-white" onClick={getStarted}>Get Started <span>↗</span></button>
                    <a href="#templates" className="button button-glass">Browse Templates <span>↓</span></a>
                  </div>
                </div>
                <div className="hero-meta">
                  <div className="sound-wave" aria-hidden="true">
                    {Array.from({ length: 11 }, (_, i) => <i key={i} />)}
                  </div>
                  <p>Your voice. Finally understood.</p>
                </div>
              </div>
            </div>
            <div className="hero-footer page-width">
              <span>Trusted by thousands of Pakistani creators</span>
              <a href="#templates">SCROLL TO EXPLORE <span>↓</span></a>
              <button type="button" onClick={toggleVideo} aria-label={videoPaused ? 'Play background video' : 'Pause background video'} aria-pressed={videoPaused}>
                <span className="video-control-icon">{videoPaused ? '▷' : 'Ⅱ'}</span>
                <span className="video-control-label">{videoPaused ? 'PLAY MOTION' : 'PAUSE MOTION'}</span>
              </button>
            </div>
          </section>

          <div className="language-strip">
            <div className="page-width">
              <span>ONE VOICE. EVERY WAY YOU SPEAK.</span>
              <div>
                <span>Urdu</span><b>+</b><span>English</span><b>+</b><span>Roman Urdu</span><b>=</b><span className="language-end">Asaan.</span>
              </div>
              <span className="strip-note">NOTHING LOST IN TRANSLATION. ↗</span>
            </div>
          </div>

          <section className="section page-width templates-section" id="templates">
            <div className="section-heading">
              <div>
                <p className="eyebrow"><span className="section-index">01 /</span> STYLES MADE FOR YOUR VOICE</p>
                <h2>All your favourite<br /><span className="brand-underline">templates.</span></h2>
              </div>
              <div className="heading-aside">
                <p>Styles built for Roman Urdu. Tweak and save your preset.</p>
                <button type="button" className="inline-link" onClick={getStarted}>Start with {TEMPLATES[template].name} <span>↗</span></button>
              </div>
            </div>
            <div className="template-grid" aria-label="Caption template previews">
              {TEMPLATES.map((t, i) => (
                <button
                  key={t.name}
                  type="button"
                  className={`template-card${i === template ? ' is-selected' : ''}`}
                  aria-pressed={i === template}
                  onClick={() => setTemplate(i)}
                >
                  <span className={`template-art ${t.art}`}>
                    <span className="preview-top">{t.top} <span>9:16</span></span>
                    <span className="art-backdrop" aria-hidden="true">Aa</span>
                    <span className="caption-text">{t.text}</span>
                    <span className="preview-bottom"><span className="mini-play">▶</span> ROMAN URDU <span className="selected-check">✓</span></span>
                  </span>
                  <span className="template-name">{t.name} <span>{two(i + 1)} ↗</span></span>
                </button>
              ))}
            </div>
            <div className="template-footnote">
              <span>YOUR CONTENT. YOUR STYLE.</span>
              <span aria-live="polite">{TEMPLATES[template].name} selected</span>
            </div>
          </section>

          <section className="features-section" id="features">
            <div className="section page-width">
              <div className="section-heading">
                <div>
                  <p className="eyebrow"><span className="section-index">02 /</span> BUILT FOR REAL CONVERSATIONS</p>
                  <h2>Speak in Urdu, English,<br /><span className="brand-underline">or both.</span></h2>
                </div>
                <div className="heading-aside">
                  <p>Asaan Caption understands what others miss. Accurate, natural captions for real Pakistani speech, with no awkward guesses.</p>
                </div>
              </div>
              <div className="comparison">
                <div className="comparison-intro">
                  <div className="audio-symbol" aria-hidden="true">
                    {Array.from({ length: 9 }, (_, i) => <span key={i} />)}
                  </div>
                  <span>THE SAME VOICE.<br />A DIFFERENT UNDERSTANDING.</span>
                  <span className="comparison-duration">00:06</span>
                </div>
                <div className="transcript transcript-other">
                  <span className="small-label">OTHER TOOLS <span>×</span></span>
                  <p>“Super super chai tea ke calm pay nick low”</p>
                  <span className="transcript-note">Lost in translation.</span>
                </div>
                <div className="transcript transcript-asaan">
                  <span className="small-label">ASAAN CAPTION <span>✓</span></span>
                  <p>“Subah subah chai peeyo, aur kaam pe niklo <span>tension-free ho ke.</span>”</p>
                  <span className="transcript-note">Understands local pronunciation, code-switching, and everyday slang.</span>
                </div>
              </div>
              <div className="feature-columns">
                <article>
                  <span className="feature-icon">[ا]</span>
                  <h3>Built for Pakistani speech</h3>
                  <p>Understands local accents, Urdu, Roman Urdu, and the way they mix mid-sentence.</p>
                </article>
                <article>
                  <span className="feature-icon">[↔]</span>
                  <h3>Edit before you post</h3>
                  <p>Fix spelling, adjust word timing, and style captions your way, with zero hassle.</p>
                </article>
                <article>
                  <span className="feature-icon">[↗]</span>
                  <h3>Ready to export</h3>
                  <p>Download crisp 4K video with captions burned in, or take an SRT into your editor.</p>
                  <span className="format-tags">4K <i>·</i> SRT <i>·</i> MP4</span>
                </article>
              </div>
            </div>
          </section>

          <section className="section page-width viral-section" id="viral-clips">
            <div className="section-heading">
              <div>
                <p className="eyebrow"><span className="section-index">03 /</span><span className="new-label">NEW</span> VIRAL CLIPS</p>
                <h2>One long video.<br /><span className="muted">A week of content.</span></h2>
              </div>
              <div className="heading-aside">
                <p>Upload a podcast, interview, vlog, or stream. We find the strongest moments, reframe them for vertical, and add captions.</p>
                <button type="button" className="inline-link" onClick={startClipping}>Create Viral Clips <span>↗</span></button>
              </div>
            </div>
            <div className="clips-workspace">
              <div className="workspace-toolbar">
                <span><span className="status-dot" /> creator-podcast-07.mp4</span>
                <span className="analyzed">✓ Analyzed</span>
              </div>
              <div className="clips-demo">
                <div className="source-video">
                  <div className="source-meta"><span>LONG VIDEO</span><span>1:12:48</span></div>
                  <div className="source-wave" aria-hidden="true" />
                  <div className="source-caption">{CLIPS[clip].caption}</div>
                  <div className="source-timeline"><span>00:00</span><div><i /></div><span>1:12:48</span></div>
                </div>
                <div className="clips-arrow" aria-hidden="true">→</div>
                <div className="clips-results">
                  <div className="clips-results-heading"><span>8 clips found</span><span>Best moments first ↗</span></div>
                  <div className="clip-list">
                    {CLIPS.map((c, i) => (
                      <button
                        key={c.title}
                        type="button"
                        className={`clip-row${i === clip ? ' is-active' : ''}`}
                        aria-pressed={i === clip}
                        onClick={() => setClip(i)}
                      >
                        <span className="clip-number">{two(i + 1)}</span>
                        <span className="clip-info"><strong>{c.title}</strong><span>{c.meta} · Vertical · Captioned</span></span>
                        <span className="clip-score">{c.score}<span>HOOK SCORE</span></span>
                        <span className="clip-arrow">↗</span>
                      </button>
                    ))}
                  </div>
                  <div className="demo-label">ILLUSTRATIVE WORKFLOW PREVIEW</div>
                </div>
              </div>
            </div>
            <div className="feature-columns clip-features">
              <article><span className="small-label">01 / FIND</span><h3>Find the moments</h3><p>AI ranks the strongest hooks and ideas in your video.</p></article>
              <article><span className="small-label">02 / FRAME</span><h3>Frame for vertical</h3><p>Keep the speaker in shot with a ready-made 9:16 crop.</p></article>
              <article><span className="small-label">03 / CAPTION</span><h3>Caption every clip</h3><p>Start with your favourite style, then fine-tune before export.</p></article>
            </div>
          </section>

          <section className="workflow-section" id="how-it-works">
            <div className="section page-width">
              <div className="section-heading">
                <div>
                  <p className="eyebrow"><span className="section-index">04 /</span> THE WHOLE WORKFLOW. NOTHING MISSING.</p>
                  <h2>Upload. Process. Export.<br /><span className="muted">Done within <span className="brand-underline">2 minutes.</span></span></h2>
                </div>
                <div className="heading-aside"><p>One focused flow from your original video to a polished, captioned export.</p></div>
              </div>
              <div className="workflow">
                <div className="workflow-steps" role="tablist" aria-label="Caption workflow">
                  {STEPS.map((s, i) => (
                    <button
                      key={s.title}
                      ref={(el) => {
                        stepRefs.current[i] = el;
                      }}
                      type="button"
                      role="tab"
                      id={`step-${i}`}
                      className={`workflow-step${i === step ? ' is-active' : ''}`}
                      aria-controls="workflow-panel"
                      aria-selected={i === step}
                      tabIndex={i === step ? 0 : -1}
                      onClick={() => setStep(i)}
                      onKeyDown={(e) => onStepKey(e, i)}
                    >
                      <span>{two(i + 1)}</span>
                      <div><strong>{s.title}</strong><p>{s.text}</p></div>
                      <b>↗</b>
                    </button>
                  ))}
                </div>
                <div className="workflow-panel" id="workflow-panel" role="tabpanel" aria-labelledby={`step-${step}`} tabIndex={0}>
                  <div className="panel-chrome"><span><i /><i /><i /></span><span>ASAAN / WORKSPACE</span><span>↗</span></div>
                  <div className="step-preview">{STEPS[step].preview}</div>
                  <span className="workspace-preview-label">WORKFLOW PREVIEW</span>
                </div>
              </div>
            </div>
          </section>

          <section className="section page-width about-section" id="why-us">
            <div className="about-heading">
              <p className="eyebrow"><span className="section-index">05 /</span> WHY WE BUILT THIS</p>
              <h2>Most tools weren&apos;t built<br />for the way we speak.<br /><span className="muted">So we built one.</span></h2>
              <p className="about-intro">
                <strong>Subtitling used to be the slowest part of our workflow.</strong> Other tools treated Pakistani speech like an
                afterthought. Asaan Caption is trained for real local speech patterns, so captions sound natural, accurate, and actually
                usable.
              </p>
              <span className="made-in">MADE IN PAKISTAN. <strong>BUILT FOR CREATORS LIKE YOU.</strong><span>↗</span></span>
            </div>
            <div className="about-list">
              {[
                ['Built for Pakistan', 'Trained on real Pakistani speech, accents, and everyday phrasing.'],
                ['More Accurate', 'Understands Urdu, English, Roman Urdu, and mixed speech naturally.'],
                ['Saves You Time', 'Turn hours of caption work into minutes so you can publish faster.'],
                ['Ready for Export', 'Export 4K videos or SRT subtitle files for any platform.'],
              ].map(([title, text], i) => (
                <article key={title}>
                  <span>{two(i + 1)}</span>
                  <div><h3>{title}</h3><p>{text}</p></div>
                  <span>↗</span>
                </article>
              ))}
            </div>
          </section>

          <section className="pricing-section" id="pricing">
            <div className="section page-width">
              <div className="section-heading">
                <div>
                  <p className="eyebrow"><span className="section-index">06 /</span> HONEST PRICING. NOTHING HIDDEN.</p>
                  <h2>Built for your content.<br /><span className="muted">Priced for your reality.</span></h2>
                </div>
                <div className="heading-aside">
                  <p>Stop paying for features built for everyone else. No unused suites. Just what a Pakistani creator needs.</p>
                  {showOffer && <span className="launch-label"><span className="status-dot" /> {launchOffer.text}</span>}
                </div>
              </div>
              {subscriptions === null ? (
                <p className="plans-state" role="status">
                  {plansFailed ? (
                    <>
                      Couldn&apos;t load the plans.{' '}
                      <button type="button" className="inline-link" onClick={retryPlans}>Try again <span>↻</span></button>
                    </>
                  ) : (
                    'Loading plans…'
                  )}
                </p>
              ) : (
                <div className="pricing-grid">
                  {subscriptions.map((p, i) => {
                    const featured = p.slug === featuredSlug;
                    const free = p.priceMonthlyPkr <= 0;
                    const discounted = discountedPrice(p.priceMonthlyPkr, p);
                    return (
                      <article key={p._id} className={`price-card${featured ? ' price-featured' : ''}`}>
                        {featured && <div className="popular-label">THE CREATOR&apos;S CHOICE <span>POPULAR ↗</span></div>}
                        <div className="plan-top">
                          <h3>{p.name}</h3>
                          {discounted != null ? <span className="discount">{p.discountPercent}% OFF</span> : <span>{two(i + 1)} /</span>}
                        </div>
                        {p.description && <p className="plan-description">{p.description}</p>}
                        <div className="price">
                          {free ? (
                            <span>Free</span>
                          ) : (
                            <>
                              <span className="currency">PKR</span>
                              <span>{pkr(discounted ?? p.priceMonthlyPkr)}</span>
                              <span className="per">/mo</span>
                              {discounted != null && <s>{pkr(p.priceMonthlyPkr)}</s>}
                            </>
                          )}
                        </div>
                        <button type="button" className={`button ${featured ? 'button-primary' : 'button-outline'}`} onClick={() => choosePlan(p)}>
                          Get Started <span>↗</span>
                        </button>
                        <ul>
                          {p.features.map((f) => <li key={f}>{f}</li>)}
                        </ul>
                      </article>
                    );
                  })}
                </div>
              )}
              <div className="pricing-assurances"><span>✓ No hidden fees</span><span>✓ Cancel any time</span><span>✓ First exports free</span></div>
            </div>
          </section>

          {passes.length > 0 && (
            <section className="section page-width pass-section" id="day-pass">
              <div className="pass-intro">
                <p className="eyebrow">NO SUBSCRIPTION NEEDED</p>
                <h2>Short on time?<br /><span className="muted">Grab a Pass.</span></h2>
                <p>One-time access, no auto-renewal — perfect for a single shoot or a quick campaign.</p>
              </div>
              {passes.map((p) => {
                const discounted = discountedPrice(p.priceMonthlyPkr, p);
                return (
                  <article key={p._id} className="pass-card">
                    <div className="pass-title">
                      <h3>{p.name}</h3>
                      <span>
                        PKR <strong>{pkr(discounted ?? p.priceMonthlyPkr)}</strong>
                        {discounted != null && <> <s>{pkr(p.priceMonthlyPkr)}</s></>}
                      </span>
                    </div>
                    {p.description && <p>{p.description}</p>}
                    <ul>
                      {p.features.map((f) => <li key={f}>{f}</li>)}
                    </ul>
                    <button type="button" className="inline-link" onClick={() => choosePlan(p)}>Get {p.name} <span>↗</span></button>
                  </article>
                );
              })}
            </section>
          )}

          <section className="final-cta">
            <div className="page-width">
              <p className="eyebrow"><span className="status-dot" /> READY WHEN YOU ARE</p>
              <h2>The broken<br />transcript era <span>is over.</span></h2>
              <div className="cta-bottom">
                <p>Your mix isn&apos;t the problem. Prove it in under 2 minutes.</p>
                <div>
                  <button type="button" className="button button-white" onClick={getStarted}>Get Started <span>↗</span></button>
                  <span>No card needed. First exports on us.</span>
                </div>
              </div>
              <div className="cta-watermark" aria-hidden="true">[ a ]</div>
            </div>
          </section>
        </main>

        <footer className="footer page-width">
          <div className="footer-main">
            <div className="footer-brand">
              <a className="brand" href="#top" aria-label="Asaan Caption home">
                <BrandLogo />
              </a>
              <p>Automatic captions engineered for the way Pakistan speaks — Urdu, Roman Urdu, and everything in between.</p>
              <div className="footer-tags"><span>Pakistan-first</span><span>AI-powered</span></div>
            </div>
            <div className="footer-links">
              <span className="small-label">PRODUCT</span>
              <a href="#templates">Templates</a>
              <a href="#features">Features</a>
              <a href="#viral-clips">Viral Clips</a>
              <a href="#how-it-works">How It Works</a>
            </div>
            <div className="footer-links">
              <span className="small-label">EXPLORE</span>
              <a href="#why-us">Why Us</a>
              <a href="#pricing">Pricing</a>
              {passes.length > 0 && <a href="#day-pass">Day Pass</a>}
              {whatsapp && <a href={whatsapp} target="_blank" rel="noopener noreferrer">Contact on WhatsApp ↗</a>}
            </div>
            <div className="footer-links">
              <span className="small-label">LEGAL</span>
              <Link to="/privacy">Privacy Policy</Link>
              <Link to="/terms">Terms of Service</Link>
              <Link to="/cookies">Cookie Policy</Link>
              <button type="button" onClick={goSignIn}>{signInLabel} ↗</button>
            </div>
          </div>
          <div className="footer-bottom">
            <span>© {new Date().getFullYear()} Asaan Caption</span>
            <span>Built for the way Pakistan speaks.</span>
            <a href="#top">BACK TO TOP ↑</a>
          </div>
        </footer>
      </div>

      {/* Outside .lp2, so the landing's button reset never touches the popup. */}
      <ManualPaymentModal open={paymentOpen} onClose={() => setPaymentOpen(false)} plans={plans} initialSlug={paymentSlug} />
    </>
  );
}
