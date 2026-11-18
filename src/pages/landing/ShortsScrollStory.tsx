/**
 * ShortsScrollStory — "one long video → three reels", told by scrolling.
 *
 * The section is taller than the screen; its stage stays pinned (position:
 * sticky) while the visitor scrolls through it, and the scroll progress
 * (0 → 1) drives the story:
 *   0.00–0.30  the long 16:9 video; three best moments light up on its timeline
 *   0.30–0.78  the long video steps back while three 9:16 reels fly out of
 *              those moments into a row
 *   0.70–1.00  captions appear on the reels: ready to post
 * Positions are written straight to the elements' styles on each animation
 * frame (no React re-render while scrolling), and only while the section is
 * on screen. With reduced motion the finished state is shown, not pinned.
 *
 * Media: swap in real files via SHORTS_MEDIA (an image now; give a `video`
 * and it plays muted on loop instead).
 */
import { useEffect, useRef } from 'react';

type Media = { image: string; video?: string; position?: string };

/** Stand-ins until the real long video and its three reels are supplied (public/landing-v2/shorts). */
const SHORTS_MEDIA: { long: Media; reels: (Media & { caption: [string, string]; length: string; score: number })[] } = {
  long: { image: '/landing-v2/shorts/long-video.jpg' },
  reels: [
    { image: '/landing-v2/shorts/long-video.jpg', position: '52% 50%', caption: ['Consistency is the part', 'nobody talks about.'], length: '0:38', score: 96 },
    { image: '/landing-v2/shorts/long-video.jpg', position: '58% 40%', caption: ['Shuru mein koi', 'yeh nahi batata.'], length: '0:27', score: 91 },
    { image: '/landing-v2/shorts/long-video.jpg', position: '64% 55%', caption: ['The one habit that', 'actually worked.'], length: '0:44', score: 88 },
  ],
};

/** Where each moment sits on the long video's timeline (0–1), which is where its reel flies out from. */
const MOMENTS = [0.18, 0.47, 0.76];
const STEPS = ['Long video', 'Best moments', 'Ready reels'];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const range = (p: number, from: number, to: number) => clamp01((p - from) / (to - from));
const ease = (t: number) => 1 - Math.pow(1 - t, 3);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function MediaView({ media, className }: { media: Media; className: string }) {
  return media.video ? (
    <video className={className} src={media.video} poster={media.image} muted loop playsInline autoPlay style={{ objectPosition: media.position }} />
  ) : (
    <img className={className} src={media.image} alt="" loading="lazy" decoding="async" style={{ objectPosition: media.position }} />
  );
}

export function ShortsScrollStory() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const reelRefs = useRef<(HTMLDivElement | null)[]>([]);
  const segRefs = useRef<(HTMLElement | null)[]>([]);
  const stepRefs = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const stage = stageRef.current;
    const frame = frameRef.current;
    if (!wrap || !stage || !frame) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frameId = 0;
    let onScreen = false;

    const render = () => {
      frameId = 0;
      const rect = wrap.getBoundingClientRect();
      const travel = Math.max(1, rect.height - window.innerHeight);
      const p = reduce.matches ? 1 : clamp01(-rect.top / travel);

      // The long video: full size, then it steps back and dims behind the reels.
      const back = ease(range(p, 0.3, 0.72));
      const fw = frame.offsetWidth;
      const fh = frame.offsetHeight;
      const sh = stage.offsetHeight;
      const frameScale = lerp(1, 0.6, back);
      const frameY = lerp(0, -sh * 0.2, back);
      frame.style.transform = `translate(-50%, -50%) translateY(${frameY}px) scale(${frameScale})`;
      frame.style.setProperty('--dim', String(lerp(0, 0.55, back)));

      // The best moments light up one after another on the timeline, and fade back once their reels are out.
      segRefs.current.forEach((seg, i) =>
        seg?.style.setProperty('--on', String(ease(range(p, 0.06 + i * 0.07, 0.14 + i * 0.07)) * (1 - 0.8 * back))),
      );

      // The reels fly out of their moments into a row below the long video; all three always fit the width.
      const sw = stage.offsetWidth;
      const reelW = Math.min((Math.min(sh * 0.5, 460) * 9) / 16, (sw * 0.94) / 3.3);
      const gap = Math.min(reelW * 0.15, 36);
      reelRefs.current.forEach((reel, i) => {
        if (!reel) return;
        const t = ease(range(p, 0.34 + i * 0.06, 0.66 + i * 0.06));
        // Start: the moment on the (stepping back) timeline. End: its place in the row.
        const startX = (MOMENTS[i] - 0.5) * fw * frameScale;
        const startY = frameY + (fh * frameScale) / 2 - 8;
        const endX = (i - 1) * (reelW + gap);
        const endY = sh * 0.12;
        reel.style.width = `${reelW}px`;
        reel.style.transform = `translate(-50%, -50%) translate(${lerp(startX, endX, t)}px, ${lerp(startY, endY, t)}px) scale(${lerp(0.18, 1, t)})`;
        reel.style.opacity = String(range(t, 0, 0.25));
        reel.style.setProperty('--cap', String(ease(range(p, 0.7 + i * 0.05, 0.84 + i * 0.05))));
      });

      // Which step of the story is on.
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
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    onScreen = true;
    schedule();
    return () => {
      io.disconnect();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      cancelAnimationFrame(frameId);
    };
  }, []);

  return (
    <div className="shorts-story" ref={wrapRef}>
      <div className="shorts-stage" ref={stageRef}>
        <ol className="shorts-steps" aria-label="How Viral Clips works">
          {STEPS.map((s, i) => (
            <li
              key={s}
              ref={(el) => {
                stepRefs.current[i] = el;
              }}
              className={i === 0 ? 'is-on' : undefined}
            >
              <span>{String(i + 1).padStart(2, '0')}</span>
              {s}
            </li>
          ))}
        </ol>

        <div className="shorts-frame" ref={frameRef}>
          <MediaView media={SHORTS_MEDIA.long} className="shorts-media" />
          <div className="shorts-frame-dim" aria-hidden="true" />
          <div className="shorts-frame-top"><span><i className="status-dot" /> LONG VIDEO · 16:9</span><span>1:12:48</span></div>
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
            <div className="shorts-reel-top"><span>9:16</span><span>{r.score}</span></div>
            <p className="shorts-reel-caption">
              {r.caption[0]}
              <br />
              <mark>{r.caption[1]}</mark>
            </p>
            <div className="shorts-reel-meta">CLIP {String(i + 1).padStart(2, '0')} · {r.length}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
