import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowRight, Check, Mic, Pencil, Upload, X } from 'lucide-react';
import { useScrollHold } from '../lib/useScrollHold';

/**
 * The "difference" stage: the other-tools-versus-Asaan-Caption comparison
 * with an arrow between, a footnote, then three feature cards, each with an
 * icon tile and a small decorative motif that moves while the section is on
 * screen (`is-visible`). Cards rise in once (`is-live`), staggered by --i.
 */

const COMPARE = {
  bad: 'Super super chai tea ke calm pay nick low',
  good: 'Subah subah chai peeyo, aur kaam pe niklo tension-free ho ke.',
};

/** Bar heights for the waveform motif, as a fraction of its height. */
const WAVE = [0.3, 0.55, 0.85, 0.5, 1, 0.7, 0.4, 0.9, 0.6, 0.35, 0.75, 0.45];

const stepVar = (i: number) => ({ '--i': i }) as CSSProperties;

function WaveMotif() {
  return (
    <span className="lp-diff-motif lp-motif-wave" aria-hidden="true">
      {WAVE.map((h, i) => (
        <span key={i} style={{ height: `${h * 100}%`, ...stepVar(i) }} />
      ))}
    </span>
  );
}

function LinesMotif() {
  return (
    <span className="lp-diff-motif lp-motif-lines" aria-hidden="true">
      <span style={{ width: 128 }} />
      <span style={{ width: 96 }} className="is-edit">
        <i />
      </span>
      <span style={{ width: 72 }} />
    </span>
  );
}

function ChipsMotif() {
  return (
    <span className="lp-diff-motif lp-motif-chips" aria-hidden="true">
      {['4K', 'SRT', 'MP4'].map((label, i) => (
        <span key={label} style={stepVar(i)}>
          {label}
        </span>
      ))}
    </span>
  );
}

const FEATURES: Array<{ id: string; icon: ReactNode; title: string; body: string; motif: ReactNode }> = [
  {
    id: 'speech',
    icon: <Mic size={30} strokeWidth={2} aria-hidden="true" />,
    title: 'Built for Pakistani speech',
    body: 'Understands local accents, Urdu, Roman Urdu, and the way they mix mid-sentence.',
    motif: <WaveMotif />,
  },
  {
    id: 'edit',
    icon: <Pencil size={30} strokeWidth={2} aria-hidden="true" />,
    title: 'Edit before you post',
    body: 'Fix spelling, adjust word timing, and style captions your way, with zero hassle.',
    motif: <LinesMotif />,
  },
  {
    id: 'export',
    icon: <Upload size={30} strokeWidth={2} aria-hidden="true" />,
    title: 'Ready to export',
    body: 'Download crisp 4K video with captions burned in, or take an SRT into your editor.',
    motif: <ChipsMotif />,
  },
];

export function DifferenceShowcase() {
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
      className={`lp-diff-body${live ? ' is-live' : ''}${visible && !held ? ' is-visible' : ''}`}
    >
      <div className="lp-cmp" style={stepVar(0)}>
        <div className="lp-cmp-card lp-cmp-bad">
          <div className="lp-cmp-head">
            <span className="lp-cmp-disc" aria-hidden="true">
              <X size={20} strokeWidth={2.6} />
            </span>
            <span className="lp-cmp-label">Other tools</span>
          </div>
          <p className="lp-cmp-text">&ldquo;{COMPARE.bad}&rdquo;</p>
        </div>
        <span className="lp-cmp-arrow" aria-hidden="true">
          <ArrowRight size={22} strokeWidth={2.4} />
        </span>
        <div className="lp-cmp-card lp-cmp-good">
          <div className="lp-cmp-head">
            <span className="lp-cmp-disc" aria-hidden="true">
              <Check size={20} strokeWidth={2.8} />
            </span>
            <span className="lp-cmp-label">Asaan Caption</span>
          </div>
          <p className="lp-cmp-text">&ldquo;{COMPARE.good}&rdquo;</p>
        </div>
      </div>
      <p className="lp-cmp-note" style={stepVar(1)}>
        Understands local pronunciation, code-switching, and everyday slang.
      </p>

      <div className="lp-diff-grid">
        {FEATURES.map((f, i) => (
          <article key={f.id} className="lp-card lp-diff-card" style={stepVar(i + 2)}>
            {f.motif}
            <span className="lp-diff-ico" aria-hidden="true">
              {f.icon}
            </span>
            <h3 className="lp-diff-title">{f.title}</h3>
            <span className="lp-diff-bar" aria-hidden="true" />
            <p className="lp-diff-text">{f.body}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
