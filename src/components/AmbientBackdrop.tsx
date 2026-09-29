import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useScrollHold } from '../lib/useScrollHold';

/**
 * Ambient backdrop for the "How it works" band: a faint square-dot grid
 * drifting diagonally, two soft accent glows that breathe, and a few rising
 * sparks in the hero's square-particle motif. Fills the section it sits in
 * (.lp-section-ambient) behind the content.
 *
 * Pure CSS motion — transforms and opacity only, no canvas and no per-frame
 * script — and the loops pause while the section is off screen.
 */

/** Spread the sparks deterministically so every load looks the same. */
const SPARKS = Array.from({ length: 14 }, (_, i) => ({
  left: `${(i * 37 + 11) % 100}%`,
  top: `${(i * 53 + 20) % 100}%`,
  size: 3 + (i % 3) * 2,
  delay: `-${(i * 1.7) % 12}s`,
  duration: `${14 + (i % 5) * 3}s`,
}));

export function AmbientBackdrop() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const held = useScrollHold();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      threshold: 0,
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`lp-ambient${visible && !held ? ' is-visible' : ''}`}
      aria-hidden="true"
    >
      <div className="lp-ambient-grid-wrap">
        <div className="lp-ambient-grid" />
      </div>
      <div className="lp-ambient-glow lp-ambient-glow-1" />
      <div className="lp-ambient-glow lp-ambient-glow-2" />
      {SPARKS.map((s, i) => (
        <span
          key={i}
          className="lp-ambient-spark"
          style={
            {
              left: s.left,
              top: s.top,
              width: s.size,
              height: s.size,
              animationDelay: s.delay,
              animationDuration: s.duration,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
