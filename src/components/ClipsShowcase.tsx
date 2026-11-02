import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowRight, Captions, Check, Clock3, Play, Scissors, Sparkles, Smartphone } from 'lucide-react';
import { useScrollHold } from '../lib/useScrollHold';

type ClipsShowcaseProps = {
  onStart: () => void;
};

const FEATURES: Array<{ icon: ReactNode; title: string; body: string }> = [
  {
    icon: <Sparkles size={20} strokeWidth={2.1} aria-hidden="true" />,
    title: 'Find the moments',
    body: 'AI ranks the strongest hooks and ideas in your video.',
  },
  {
    icon: <Smartphone size={20} strokeWidth={2.1} aria-hidden="true" />,
    title: 'Frame for vertical',
    body: 'Keep the speaker in shot with a ready-made 9:16 crop.',
  },
  {
    icon: <Captions size={20} strokeWidth={2.1} aria-hidden="true" />,
    title: 'Caption every clip',
    body: 'Start with your favourite style, then fine-tune before export.',
  },
];

const CLIPS = [
  { score: 96, time: '00:38', title: 'The idea that changed everything', tone: 'lime' },
  { score: 91, time: '00:27', title: 'Nobody tells you this at the start', tone: 'blue' },
  { score: 88, time: '00:44', title: 'The one habit that actually worked', tone: 'violet' },
];

const stepVar = (index: number) => ({ '--i': index }) as CSSProperties;

/**
 * A product-led preview of the long-video-to-short-clips workflow. The UI is
 * intentionally illustrative rather than interactive: its timeline, scan,
 * and output cards run as one restrained loop while this block is on screen.
 */
export function ClipsShowcase({ onStart }: ClipsShowcaseProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [entered, setEntered] = useState(false);
  const [visible, setVisible] = useState(false);
  const held = useScrollHold();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        setVisible(entry.isIntersecting);
        if (entry.isIntersecting && entry.intersectionRatio >= 0.12) setEntered(true);
      },
      { threshold: [0, 0.12], rootMargin: '0px 0px -8% 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`lp-clips${entered ? ' is-live' : ''}${visible && !held ? ' is-visible' : ''}`}
    >
      <div className="lp-clips-stage" aria-label="Illustration of a long video becoming three short clips">
        <div className="lp-clips-toolbar">
          <span className="lp-clips-window-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span className="lp-clips-file">
            <span className="lp-clips-file-icon" aria-hidden="true">
              <Play size={10} fill="currentColor" />
            </span>
            creator-podcast-07.mp4
          </span>
          <span className="lp-clips-duration">
            <Clock3 size={13} aria-hidden="true" />
            1:12:48
          </span>
        </div>

        <div className="lp-clips-workspace">
          <div className="lp-clips-source" style={stepVar(0)}>
            <div className="lp-clips-source-head">
              <span>Long video</span>
              <span className="lp-clips-source-status">
                <i aria-hidden="true" /> Analyzed
              </span>
            </div>
            <div className="lp-clips-source-preview">
              <span className="lp-clips-studio-light" aria-hidden="true" />
              <span className="lp-clips-person lp-clips-person-a" aria-hidden="true">
                <i />
              </span>
              <span className="lp-clips-person lp-clips-person-b" aria-hidden="true">
                <i />
              </span>
              <span className="lp-clips-source-caption">
                <b>Consistency is the part</b>
                <span>nobody wants to talk about.</span>
              </span>
              <span className="lp-clips-play" aria-hidden="true">
                <Play size={20} fill="currentColor" />
              </span>
            </div>

            <div className="lp-clips-timeline" aria-hidden="true">
              <div className="lp-clips-waveform">
                {Array.from({ length: 48 }, (_, i) => (
                  <i key={i} style={{ '--bar': `${26 + ((i * 37) % 68)}%` } as CSSProperties} />
                ))}
              </div>
              <span className="lp-clips-range lp-clips-range-a" />
              <span className="lp-clips-range lp-clips-range-b" />
              <span className="lp-clips-range lp-clips-range-c" />
              <span className="lp-clips-playhead" />
            </div>
            <div className="lp-clips-timecodes" aria-hidden="true">
              <span>00:00</span>
              <span>36:24</span>
              <span>1:12:48</span>
            </div>
          </div>

          <div className="lp-clips-convert" style={stepVar(1)} aria-hidden="true">
            <span className="lp-clips-convert-ring">
              <Scissors size={20} strokeWidth={2.2} />
            </span>
            <span className="lp-clips-convert-line" />
          </div>

          <div className="lp-clips-results" style={stepVar(2)}>
            <div className="lp-clips-results-head">
              <span>
                <Sparkles size={15} aria-hidden="true" /> 8 clips found
              </span>
              <span>Best moments first</span>
            </div>
            <div className="lp-clips-stack">
              {CLIPS.map((clip, index) => (
                <article
                  key={clip.title}
                  className={`lp-clips-card lp-clips-card-${clip.tone}`}
                  style={stepVar(index)}
                >
                  <div className="lp-clips-card-visual" aria-hidden="true">
                    <span className="lp-clips-card-orb" />
                    <span className="lp-clips-card-person">
                      <i />
                    </span>
                    <span className="lp-clips-card-caption">
                      {index === 0 ? (
                        <>
                          THE IDEA THAT <b>CHANGED</b> EVERYTHING
                        </>
                      ) : index === 1 ? (
                        <>
                          NOBODY TELLS YOU <b>THIS</b>
                        </>
                      ) : (
                        <>
                          DO THIS <b>EVERY DAY</b>
                        </>
                      )}
                    </span>
                    <span className="lp-clips-card-time">{clip.time}</span>
                  </div>
                  <div className="lp-clips-card-meta">
                    <span className="lp-clips-score">
                      <Check size={10} strokeWidth={3} aria-hidden="true" /> {clip.score}
                    </span>
                    <span>{clip.title}</span>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>

        <div className="lp-clips-scan" aria-hidden="true">
          <Sparkles size={13} /> Finding the best moments
        </div>
      </div>

      <div className="lp-clips-feature-grid">
        {FEATURES.map((feature, index) => (
          <article key={feature.title} className="lp-clips-feature" style={stepVar(index + 3)}>
            <span className="lp-clips-feature-icon" aria-hidden="true">
              {feature.icon}
            </span>
            <span>
              <strong>{feature.title}</strong>
              <small>{feature.body}</small>
            </span>
          </article>
        ))}
      </div>

      <div className="lp-clips-action" style={stepVar(6)}>
        <button type="button" className="lp-btn lp-btn-primary lp-btn-lg lp-btn-shine" onClick={onStart}>
          Create Viral Clips
          <ArrowRight size={18} strokeWidth={2.2} aria-hidden="true" />
        </button>
        <p>Made for podcasts, interviews, vlogs, and streams.</p>
      </div>
    </div>
  );
}
