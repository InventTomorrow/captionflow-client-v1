/**
 * TemplateCarousel — the landing's template section: phone-sized previews in a
 * shallow 3D coverflow (the active one large and lit, neighbours receding),
 * arrows, a rail of template names with the autoplay progress, and a
 * "Start with …" button. Same behaviour as the previous landing's showcase,
 * styled for the charcoal theme (landing.css, .tpl-stage*).
 *
 * Every slide is placed by its ring offset from the active one (data-o = -2 … 2)
 * and moved by CSS transforms only. Every visible phone plays its own muted, looping
 * preview while the section is on screen. The active one loads first (from the top
 * whenever it becomes active); the neighbours start once it can play, so the first
 * frame shows fast. Phones skip the outer pair, which are hidden there.
 * Autoplay pauses while the mouse rests on the active phone, keyboard focus is
 * inside, the section is off screen, or the visitor prefers reduced motion.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { CaretLeft, CaretRight } from '@phosphor-icons/react';

export type CarouselTemplate = { name: string; video: string; poster: string };

/** How long each template holds the stage before the next one slides in (matches the progress bar in CSS). */
const AUTOPLAY_MS = 4500;

/** Shortest signed distance from slide `from` to slide `to` around the ring. */
function ringOffset(from: number, to: number, n: number) {
  let d = (to - from) % n;
  if (d > n / 2) d -= n;
  if (d < -n / 2) d += n;
  return d;
}

export function TemplateCarousel({
  templates,
  initial = 0,
  onUse,
}: {
  templates: CarouselTemplate[];
  initial?: number;
  onUse: (template: CarouselTemplate) => void;
}) {
  const n = templates.length;
  const [index, setIndex] = useState(initial);
  const [hover, setHover] = useState(false);
  const [kbFocus, setKbFocus] = useState(false);
  const [visible, setVisible] = useState(false);
  const paused = hover || kbFocus;
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRefs = useRef<Array<HTMLVideoElement | null>>([]);
  const dragStart = useRef<number | null>(null);
  const swiped = useRef(false);

  const go = (next: number) => setIndex(((next % n) + n) % n);

  // Only a section that is on screen animates or plays video.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Autoplay. `index` is a dependency on purpose: a manual pick restarts the full hold.
  useEffect(() => {
    if (paused || !visible || n < 2) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = window.setInterval(() => setIndex((i) => (i + 1) % n), AUTOPLAY_MS);
    return () => window.clearInterval(id);
  }, [paused, visible, n, index]);

  // Every visible phone plays while the section is on screen: the active one first (from the
  // top), the neighbours as soon as it can play. Off screen, everything pauses.
  useEffect(() => {
    const videos = videoRefs.current;
    if (!visible) {
      videos.forEach((v) => v?.pause());
      return;
    }
    const narrow = window.matchMedia('(max-width: 720px)').matches;
    const play = (v: HTMLVideoElement) => {
      v.muted = true;
      void v.play().catch(() => undefined);
    };
    const activeVideo = videos[index];
    if (activeVideo) {
      if (activeVideo.currentTime > 0.25) activeVideo.currentTime = 0;
      play(activeVideo);
    }
    const startNeighbours = () =>
      videos.forEach((v, i) => {
        if (!v || i === index) return;
        const o = Math.abs(ringOffset(index, i, n));
        if (o > 2 || (narrow && o === 2)) {
          v.pause();
          return;
        }
        v.preload = 'auto';
        play(v);
      });
    if (!activeVideo || activeVideo.readyState >= 3) {
      startNeighbours();
      return;
    }
    activeVideo.addEventListener('canplay', startNeighbours, { once: true });
    return () => activeVideo.removeEventListener('canplay', startNeighbours);
  }, [index, visible, n]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    dragStart.current = e.clientX;
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
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

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
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
      className={`tpl-stage${paused ? ' is-paused' : ''}`}
      onFocus={(e) => {
        if (e.target.matches(':focus-visible')) setKbFocus(true);
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setKbFocus(false);
      }}
      onKeyDown={onKeyDown}
    >
      <div
        className="tpl-stage-viewport"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          dragStart.current = null;
        }}
      >
        <div className="tpl-stage-floor" aria-hidden="true" />
        {templates.map((t, i) => {
          const o = ringOffset(index, i, n);
          const isActive = o === 0;
          const shown = Math.abs(o) <= 2;
          return (
            <figure
              key={t.video}
              className={`tpl-stage-slide${isActive ? ' is-active' : ''}`}
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
              <video
                ref={(el) => {
                  videoRefs.current[i] = el;
                }}
                className="tpl-stage-video"
                src={t.video}
                poster={t.poster}
                muted
                loop
                playsInline
                preload={isActive ? 'auto' : 'metadata'}
              />
              <div className="tpl-stage-dim" aria-hidden="true" />
              <figcaption className="tpl-stage-sr">{t.name}</figcaption>
            </figure>
          );
        })}
        <button type="button" className="tpl-stage-arrow tpl-stage-arrow-prev" onClick={() => go(index - 1)} aria-label="Previous template">
          <CaretLeft size={20} weight="bold" aria-hidden="true" />
        </button>
        <button type="button" className="tpl-stage-arrow tpl-stage-arrow-next" onClick={() => go(index + 1)} aria-label="Next template">
          <CaretRight size={20} weight="bold" aria-hidden="true" />
        </button>
      </div>

      <div className="tpl-stage-bar">
        <div className="tpl-stage-rail" role="tablist" aria-label="Templates">
          {templates.map((t, i) => (
            <button
              key={t.video}
              type="button"
              role="tab"
              aria-selected={i === index}
              className={`tpl-stage-pill${i === index ? ' is-active' : ''}`}
              onClick={() => go(i)}
            >
              <span className="tpl-stage-pill-label">{t.name}</span>
              {i === index && <span key={index} className="tpl-stage-progress" aria-hidden="true" />}
            </button>
          ))}
        </div>
        <button type="button" className="button button-white tpl-stage-cta" onClick={() => onUse(active)}>
          Start with {active.name} <span>↗</span>
        </button>
      </div>
    </div>
  );
}
