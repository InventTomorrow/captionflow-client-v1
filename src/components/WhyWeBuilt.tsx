import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { FileUp, ShieldCheck, Target, Users, Zap } from 'lucide-react';
import { useScrollHold } from '../lib/useScrollHold';

/**
 * "Why we built this": the story card (icon disc, divider, copy) with a lit
 * bottom edge, four reason cards with icon tiles and a corner glow, and the
 * "Made in Pakistan" badge. Everything rises in once, staggered by --i
 * (`is-live`); the edge highlight and corner glows only move while the block
 * is on screen (`is-visible`). Transforms and opacity only.
 */

const REASONS: Array<{ id: string; icon: ReactNode; title: string; body: string }> = [
  {
    id: 'pakistan',
    icon: <Users size={30} strokeWidth={2} aria-hidden="true" />,
    title: 'Built for Pakistan',
    body: 'Trained on real Pakistani speech, accents, and everyday phrasing.',
  },
  {
    id: 'accurate',
    icon: <Target size={30} strokeWidth={2} aria-hidden="true" />,
    title: 'More Accurate',
    body: 'Understands Urdu, English, Roman Urdu, and mixed speech naturally.',
  },
  {
    id: 'time',
    icon: <Zap size={30} strokeWidth={2} aria-hidden="true" />,
    title: 'Saves You Time',
    body: 'Turn hours of caption work into minutes so you can publish faster.',
  },
  {
    id: 'export',
    icon: <FileUp size={30} strokeWidth={2} aria-hidden="true" />,
    title: 'Ready for Export',
    body: 'Export 4K videos or SRT subtitle files for any platform.',
  },
];

const stepVar = (i: number) => ({ '--i': i }) as CSSProperties;

/** Speech bubble carrying a waveform: lucide's message-circle with bars. */
function SpeechWaveIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={38}
      height={38}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
      <path d="M8 10v3" />
      <path d="M11 8v7" />
      <path d="M14 10v3" />
      <path d="M17 9v5" />
    </svg>
  );
}

export function WhyWeBuilt() {
  const ref = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState(false);
  const [visible, setVisible] = useState(false);
  const held = useScrollHold();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        setVisible(entry.isIntersecting);
        if (entry.isIntersecting && entry.intersectionRatio >= 0.15) setLive(true);
      },
      { threshold: [0, 0.15] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`lp-why${live ? ' is-live' : ''}${visible && !held ? ' is-visible' : ''}`}
    >
      <div className="lp-why-card" style={stepVar(0)}>
        <span className="lp-why-disc" aria-hidden="true">
          <SpeechWaveIcon />
        </span>
        <span className="lp-why-divider" aria-hidden="true" />
        <p className="lp-why-text">
          <strong>Subtitling used to be the slowest part of our workflow.</strong> Other tools treated
          Pakistani speech like an afterthought. Asaan Caption is trained for real local speech
          patterns, so captions sound natural, accurate, and actually usable.
        </p>
        <span className="lp-why-edge" aria-hidden="true" />
      </div>

      <div className="lp-why-grid">
        {REASONS.map((r, i) => (
          <article key={r.id} className="lp-card lp-why-item" style={stepVar(i + 1)}>
            <span className="lp-why-tile" aria-hidden="true">
              {r.icon}
            </span>
            <h3 className="lp-why-title">{r.title}</h3>
            <span className="lp-why-bar" aria-hidden="true" />
            <p className="lp-why-body">{r.body}</p>
          </article>
        ))}
      </div>

      <div className="lp-why-badge-wrap" style={stepVar(5)}>
        <span className="lp-why-badge">
          <span className="lp-why-badge-ico" aria-hidden="true">
            <ShieldCheck size={18} strokeWidth={2.2} />
          </span>
          <span className="lp-why-badge-divider" aria-hidden="true" />
          <span>
            Made in Pakistan. <b>Built for creators like you.</b>
          </span>
        </span>
      </div>
    </div>
  );
}
