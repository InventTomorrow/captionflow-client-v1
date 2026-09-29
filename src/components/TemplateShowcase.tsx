import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export type ShowcaseTemplate = { name: string; video: string; poster: string };

/** How long each template holds the stage before the next one slides in. */
const AUTOPLAY_MS = 4500;

/** Shortest signed distance from slide `from` to slide `to` around the ring. */
const ringOffset = (from: number, to: number, n: number) => {
  let d = (to - from) % n;
  if (d > n / 2) d -= n;
  if (d < -n / 2) d += n;
  return d;
};

/**
 * Full-height template stage: one phone-sized preview as tall as the screen
 * allows, its neighbours receding behind it in a shallow coverflow, a rail
 * of template names underneath with the autoplay progress, and arrows.
 *
 * Every slide is positioned by its ring offset from the active one
 * (data-o = -2 … 2) and the CSS moves it with transforms only, so a change
 * of slide is a compositor-side move. Only the active slide and the next
 * one carry a real <video> (the next one preloads so the hand-off is
 * seamless); the others show their poster as a plain image. Five video
 * elements painting at once, as the section scrolled into view, was a
 * visible hitch. Exactly one video plays — the active one, and only while
 * the section is on screen. Autoplay parks while the mouse rests on the
 * active phone, keyboard focus is inside, or the section is off screen.
 */
export function TemplateShowcase({
  templates,
  onUse,
}: {
  templates: ShowcaseTemplate[];
  onUse: (template: ShowcaseTemplate) => void;
}) {
  const n = templates.length;
  const [index, setIndex] = useState(0);
  /** Mouse resting on the active phone, or keyboard focus inside the stage. */
  const [hover, setHover] = useState(false);
  const [kbFocus, setKbFocus] = useState(false);
  const paused = hover || kbFocus;
  const [visible, setVisible] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRefs = useRef<Array<HTMLVideoElement | null>>([]);
  const dragStart = useRef<number | null>(null);
  const swiped = useRef(false);

  const go = (next: number) => setIndex(((next % n) + n) % n);

  // Only a section that is actually on screen animates or plays video.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      threshold: 0.3,
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Autoplay. `index` is a dependency on purpose: a manual pick restarts the
  // full hold rather than being cut short by a timer already in flight.
  // It only pauses while the mouse rests on the active phone or keyboard
  // focus is inside the stage — not on any hover, and not on the focus a
  // mouse click leaves behind on an arrow (that used to stop it for good).
  useEffect(() => {
    if (paused || !visible || n < 2) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = window.setInterval(() => setIndex((i) => (i + 1) % n), AUTOPLAY_MS);
    return () => window.clearInterval(id);
  }, [paused, visible, n, index]);

  // One video at a time: the active slide, from the top, while on screen.
  // A slide that has never played is already at 0, and seeking a video
  // that is about to be shown blanks it until the seek lands — so only
  // rewind one that actually moved.
  useEffect(() => {
    videoRefs.current.forEach((video, i) => {
      if (!video) return;
      if (i === index && visible) {
        if (video.currentTime > 0.25) video.currentTime = 0;
        void video.play().catch(() => undefined);
      } else {
        video.pause();
      }
    });
  }, [index, visible]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragStart.current = e.clientX;
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    dragStart.current = null;
    if (start === null) return;
    const dx = e.clientX - start;
    if (Math.abs(dx) < 40) return;
    // A swipe ends over a slide, which would also fire that slide's click.
    swiped.current = true;
    window.setTimeout(() => {
      swiped.current = false;
    }, 0);
    go(index + (dx < 0 ? 1 : -1));
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      go(index - 1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      go(index + 1);
    }
  };

  const active = templates[index];

  return (
    <div
      ref={rootRef}
      className={`lp-stage${paused ? ' is-paused' : ''}`}
      onFocus={(e) => {
        if (e.target.matches(':focus-visible')) setKbFocus(true);
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setKbFocus(false);
      }}
      onKeyDown={onKeyDown}
    >
      <div
        className="lp-stage-viewport"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          dragStart.current = null;
        }}
      >
        <div className="lp-stage-floor" aria-hidden="true" />
        {templates.map((t, i) => {
          const o = ringOffset(index, i, n);
          const isActive = o === 0;
          const shown = Math.abs(o) <= 2;
          return (
            <figure
              key={t.video}
              className={`lp-stage-slide${isActive ? ' is-active' : ''}`}
              data-o={shown ? o : undefined}
              hidden={!shown}
              aria-hidden={!isActive}
              onClick={() => {
                if (!swiped.current && !isActive) go(i);
              }}
              onPointerEnter={(e) => {
                if (isActive && e.pointerType === 'mouse') setHover(true);
              }}
              onPointerLeave={(e) => {
                if (e.pointerType === 'mouse') setHover(false);
              }}
            >
              {o === 0 || o === 1 ? (
                <video
                  ref={(el) => {
                    videoRefs.current[i] = el;
                  }}
                  className="lp-stage-video"
                  src={t.video}
                  poster={t.poster}
                  muted
                  loop
                  playsInline
                  preload="auto"
                />
              ) : (
                <img className="lp-stage-video" src={t.poster} alt="" loading="lazy" decoding="async" />
              )}
              <div className="lp-stage-dim" aria-hidden="true" />
              <figcaption className="lp-visually-hidden">{t.name}</figcaption>
            </figure>
          );
        })}
        <button
          type="button"
          className="lp-stage-arrow lp-stage-arrow-prev"
          onClick={() => go(index - 1)}
          aria-label="Previous template"
        >
          <ChevronLeft size={22} strokeWidth={2.2} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="lp-stage-arrow lp-stage-arrow-next"
          onClick={() => go(index + 1)}
          aria-label="Next template"
        >
          <ChevronRight size={22} strokeWidth={2.2} aria-hidden="true" />
        </button>
      </div>

      <div className="lp-stage-bar">
        <div className="lp-stage-rail" role="tablist" aria-label="Templates">
          {templates.map((t, i) => (
            <button
              key={t.video}
              type="button"
              role="tab"
              aria-selected={i === index}
              className={`lp-stage-pill${i === index ? ' is-active' : ''}`}
              onClick={() => go(i)}
            >
              <span className="lp-stage-pill-label">{t.name}</span>
              {i === index && (
                <span key={index} className="lp-stage-progress" aria-hidden="true" />
              )}
            </button>
          ))}
        </div>
        <div className="lp-stage-cta">
          <button type="button" className="lp-btn lp-btn-primary" onClick={() => onUse(active)}>
            Start with {active.name}
          </button>
        </div>
      </div>
    </div>
  );
}
