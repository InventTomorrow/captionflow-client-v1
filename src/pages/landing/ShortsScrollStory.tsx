/**
 * ShortsScrollStory — the Viral Clips section: "one long video → three reels",
 * told by scrolling.
 *
 * The section is taller than the screen; its stage (heading, step line and a
 * canvas) stays pinned (position: sticky) while the visitor scrolls through it,
 * and the scroll progress (0 → 1) drives the story inside the canvas:
 *   0.00–0.30  the long 16:9 video; three best moments light up on its timeline
 *   0.30–0.78  the long video steps back to the top while three 9:16 reels fly
 *              out of those moments into a row under it
 *   0.70–1.00  captions appear on the reels: ready to post
 * Everything is sized from the canvas (whatever the screen leaves after the
 * heading), so it fits phones and wide screens alike. Positions are written
 * straight to the elements on animation frames while the section is on screen
 * (no React re-render while scrolling). With reduced motion the finished
 * picture is shown, not pinned.
 *
 * Media (SHORTS_MEDIA): each slot is a muted looping video with a poster frame. Videos only
 * start downloading when the story comes near the screen and only play while it is on screen,
 * so the landing's first load stays light. Reels with burned-in captions need no caption overlay.
 */
import { useEffect, useRef } from 'react';

type Media = { image: string; video?: string; position?: string };
type Reel = Media & { caption?: [string, string]; length: string };

/** The long video and the three reels cut from it (public/landing-v2/shorts); the reels carry their own captions. */
const SHORTS_MEDIA: { long: Media; reels: Reel[] } = {
  long: { image: '/landing-v2/shorts/long-poster.webp', video: '/landing-v2/shorts/long.mp4' },
  reels: [
    { image: '/landing-v2/shorts/clip-1-poster.webp', video: '/landing-v2/shorts/clip-1.mp4', length: '0:30' },
    { image: '/landing-v2/shorts/clip-2-poster.webp', video: '/landing-v2/shorts/clip-2.mp4', length: '0:20' },
    { image: '/landing-v2/shorts/clip-3-poster.webp', video: '/landing-v2/shorts/clip-3.mp4', length: '0:29' },
  ],
};

/** Where each moment sits on the long video's timeline (0–1), which is where its reel flies out from. */
const MOMENTS = [0.18, 0.47, 0.76];
/** Each step's short word stays on phones; the rest of the label shows where there is room. */
const STEPS: [string, string][] = [['Find', 'the moments'], ['Frame', 'for vertical'], ['Caption', 'every clip']];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const range = (p: number, from: number, to: number) => clamp01((p - from) / (to - from));
const ease = (t: number) => 1 - Math.pow(1 - t, 3);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function MediaView({ media, className }: { media: Media; className: string }) {
  return media.video ? (
    <video className={className} src={media.video} poster={media.image} muted loop playsInline preload="none" style={{ objectPosition: media.position }} />
  ) : (
    <img className={className} src={media.image} alt="" loading="lazy" decoding="async" style={{ objectPosition: media.position }} />
  );
}

export function ShortsScrollStory() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const reelRefs = useRef<(HTMLDivElement | null)[]>([]);
  const segRefs = useRef<(HTMLElement | null)[]>([]);
  const stepRefs = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    const frame = frameRef.current;
    if (!wrap || !stage || !canvas || !frame) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frameId = 0;
    let onScreen = false;

    const render = () => {
      frameId = 0;
      const rect = wrap.getBoundingClientRect();
      const travel = Math.max(1, rect.height - window.innerHeight);
      const p = reduce.matches ? 1 : clamp01(-rect.top / travel);
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;

      // The long video, as large as the canvas allows.
      const fw = Math.min(cw, ((ch * 0.92) * 16) / 9, 980);
      const fh = (fw * 9) / 16;
      const back = ease(range(p, 0.3, 0.72));
      // How far the long video steps back: little on phones (the reels are narrow there), more on wide screens.
      const small = cw < 560 ? 0.94 : cw < 900 ? 0.64 : 0.5;
      const smallH = fh * small;

      // End state: the stepped-back video with the row of reels right under it.
      const gapY = Math.max(14, ch * 0.025);
      const reelMaxH = Math.min(ch - smallH - gapY, ch * 0.78);
      const reelW = Math.min((reelMaxH * 9) / 16, (cw * 0.96) / 3.25);
      const realH = (reelW * 16) / 9;
      // The picture keeps one top edge from start to end, right under the steps; whatever height is
      // left over is split above the heading and below the reels, so the whole screen reads as one
      // centred block. The block height is fixed for the whole story, so nothing jumps.
      const blockH = Math.max(fh, smallH + gapY + realH);
      stage.style.setProperty('--shift', `${Math.max(0, ch - blockH) / 2}px`);
      const top = -ch / 2;

      const frameScale = lerp(1, small, back);
      const frameY = top + (fh * frameScale) / 2;
      frame.style.width = `${fw}px`;
      frame.style.transform = `translate(-50%, -50%) translateY(${frameY}px) scale(${frameScale})`;
      frame.style.setProperty('--dim', String(lerp(0, 0.5, back)));
      // Its labels and timeline fade once it has stepped back (they'd be too small to read).
      frame.style.setProperty('--chrome', String(1 - range(back, 0.45, 1)));

      // The best moments light up one after another.
      segRefs.current.forEach((seg, i) =>
        seg?.style.setProperty('--on', String(ease(range(p, 0.06 + i * 0.07, 0.14 + i * 0.07)))),
      );

      // The three reels grow out of their moments together and settle into one row under the video
      // (same size at every moment, so the in-between frames stay tidy); then the captions land one by one.
      const gap = Math.min(reelW * 0.14, 32);
      const t = ease(range(p, 0.36, 0.72));
      const startY = frameY + (fh * frameScale) / 2 - 8;
      const endY = top + smallH + gapY + realH / 2;
      reelRefs.current.forEach((reel, i) => {
        if (!reel) return;
        const startX = (MOMENTS[i] - 0.5) * fw * frameScale;
        const endX = (i - 1) * (reelW + gap);
        reel.style.width = `${reelW}px`;
        reel.style.transform = `translate(-50%, -50%) translate(${lerp(startX, endX, t)}px, ${lerp(startY, endY, t)}px) scale(${lerp(0.18, 1, t)})`;
        reel.style.opacity = String(range(t, 0, 0.25));
        reel.style.setProperty('--cap', String(ease(range(p, 0.72 + i * 0.05, 0.86 + i * 0.05))));
      });

      const step = p < 0.28 ? 0 : p < 0.7 ? 1 : 2;
      stepRefs.current.forEach((li, i) => li?.classList.toggle('is-on', i === step));
    };

    const schedule = () => {
      if (onScreen && !frameId) frameId = requestAnimationFrame(render);
    };
    const io = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;
      schedule();
    });
    io.observe(wrap);
    // Videos: fetch once the story is within about a screen of view, play only while it is showing.
    const videos = [...wrap.querySelectorAll('video')];
    const mediaIo = new IntersectionObserver(
      ([entry]) => {
        videos.forEach((v) => {
          if (entry.isIntersecting && !reduce.matches) {
            if (v.preload !== 'auto') v.preload = 'auto';
            void v.play().catch(() => undefined);
          } else v.pause();
        });
      },
      { rootMargin: '100% 0px' },
    );
    mediaIo.observe(wrap);
    const ro = new ResizeObserver(schedule);
    ro.observe(canvas);
    window.addEventListener('scroll', schedule, { passive: true });
    onScreen = true;
    schedule();
    return () => {
      io.disconnect();
      mediaIo.disconnect();
      ro.disconnect();
      window.removeEventListener('scroll', schedule);
      cancelAnimationFrame(frameId);
    };
  }, []);

  return (
    <div className="shorts-story" ref={wrapRef}>
      <div className="shorts-stage" ref={stageRef}>
        <header className="shorts-head">
          <p className="eyebrow"><span className="section-index">03 /</span><span className="new-label">NEW</span> VIRAL CLIPS</p>
          <h2>One long video. <span className="muted shorts-nowrap">A week of content.</span></h2>
        </header>
        <ol className="shorts-steps" aria-label="How Viral Clips works">
          {STEPS.map(([word, more], i) => (
            <li
              key={word}
              ref={(el) => {
                stepRefs.current[i] = el;
              }}
              className={i === 0 ? 'is-on' : undefined}
            >
              <span>{String(i + 1).padStart(2, '0')}</span>
              {word}
              <i className="shorts-step-more"> {more}</i>
            </li>
          ))}
        </ol>

        <div className="shorts-canvas" ref={canvasRef}>
          <div className="shorts-frame" ref={frameRef}>
            <MediaView media={SHORTS_MEDIA.long} className="shorts-media" />
            <div className="shorts-frame-dim" aria-hidden="true" />
            <div className="shorts-frame-top"><span><i className="status-dot" /> LONG VIDEO · 16:9</span><span>2:58:49</span></div>
            <div className="shorts-timeline" aria-hidden="true">
              {MOMENTS.map((m, i) => (
                <i
                  key={m}
                  ref={(el) => {
                    segRefs.current[i] = el;
                  }}
                  style={{ left: `${m * 100}%` }}
                />
              ))}
            </div>
          </div>

          {SHORTS_MEDIA.reels.map((r, i) => (
            <div
              key={i}
              className="shorts-reel"
              ref={(el) => {
                reelRefs.current[i] = el;
              }}
            >
              <MediaView media={r} className="shorts-media" />
              {r.caption && (
                <p className="shorts-reel-caption">
                  {r.caption[0]}
                  <br />
                  <mark>{r.caption[1]}</mark>
                </p>
              )}
              <div className="shorts-reel-meta">CLIP {String(i + 1).padStart(2, '0')} · {r.length}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
