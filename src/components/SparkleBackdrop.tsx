import { useEffect, useRef } from 'react';

/** Tuning from the parrot-green background preview (2nd.html) — keep in sync with it. */
const CONFIG = {
  particleCount: 140,
  background: '#0B0E14',
  /** Parrot green #8FFF00 as an RGB triple for the rgba() fills. */
  rgb: '143, 255, 0',
};

type Sparkle = {
  x: number;
  y: number;
  size: number;
  vx: number;
  vy: number;
  alpha: number;
  twinkleSpeed: number;
  twinkleDir: 1 | -1;
};

/**
 * Twinkling parrot-green sparkle field ported from the `2nd.html` preview: a
 * dark fill, a faint green radial glow in the middle, and slowly rising,
 * glowing particles.
 *
 * Deliberate differences from the preview:
 *  - the preview pinned the canvas to the viewport (`position: fixed`); here it
 *    is absolutely positioned inside the section it decorates, so it only
 *    paints that section and scrolls away with it;
 *  - the canvas is scaled for the device pixel ratio so sparkles stay crisp;
 *  - the loop is parked while the section is off screen or the tab is hidden,
 *    and reduced-motion visitors get a single still frame.
 *
 * Particle count, sizes, speeds, twinkle and colors are the preview's, unchanged.
 */
export function SparkleBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let width = canvas.clientWidth || 1;
    let height = canvas.clientHeight || 1;

    // The dark fill and the centre glow never change between resizes, so
    // they are painted once into an offscreen canvas and blitted each frame
    // instead of rasterising a full-canvas radial gradient 60 times a second.
    const bg = document.createElement('canvas');
    const bgCtx = bg.getContext('2d');

    const fitCanvas = () => {
      // 1.25x is plenty for soft sparkles, and the fill cost of a section-sized
      // canvas is what an integrated GPU feels.
      const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      bg.width = canvas.width;
      bg.height = canvas.height;
      if (bgCtx) {
        bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        bgCtx.fillStyle = CONFIG.background;
        bgCtx.fillRect(0, 0, width, height);
        const glow = bgCtx.createRadialGradient(
          width / 2,
          height / 2,
          50,
          width / 2,
          height / 2,
          Math.max(width, height) / 1.2,
        );
        glow.addColorStop(0, `rgba(${CONFIG.rgb}, 0.05)`);
        glow.addColorStop(1, 'rgba(11, 14, 20, 0)');
        bgCtx.fillStyle = glow;
        bgCtx.fillRect(0, 0, width, height);
      }
    };
    fitCanvas();

    const spawn = (): Sparkle => ({
      x: Math.random() * width,
      y: Math.random() * height,
      size: Math.random() * 2.5 + 0.5,
      vy: -(Math.random() * 0.4 + 0.1), // slow upward float
      vx: (Math.random() - 0.5) * 0.2,
      alpha: Math.random() * 0.8 + 0.2,
      twinkleSpeed: Math.random() * 0.02 + 0.005,
      twinkleDir: Math.random() > 0.5 ? 1 : -1,
    });

    const particles: Sparkle[] = Array.from({ length: CONFIG.particleCount }, spawn);

    const update = (p: Sparkle) => {
      p.x += p.vx;
      p.y += p.vy;

      p.alpha += p.twinkleSpeed * p.twinkleDir;
      if (p.alpha >= 1 || p.alpha <= 0.2) p.twinkleDir = p.twinkleDir === 1 ? -1 : 1;

      // Respawn along the bottom edge once a sparkle drifts out of the box.
      if (p.y < 0 || p.x < 0 || p.x > width) {
        p.y = height + 10;
        p.x = Math.random() * width;
      }
    };

    // One pre-rendered glow sprite, stamped at each sparkle's size. Drawing
    // 140 arcs with ctx.shadowBlur every frame was the section's whole
    // budget; a scaled drawImage of the same glow is close to free.
    const SPRITE = 64;
    const sprite = document.createElement('canvas');
    sprite.width = SPRITE;
    sprite.height = SPRITE;
    const sctx = sprite.getContext('2d');
    if (sctx) {
      const half = SPRITE / 2;
      const glow = sctx.createRadialGradient(half, half, 0, half, half, half);
      glow.addColorStop(0, `rgba(${CONFIG.rgb}, 1)`);
      glow.addColorStop(0.22, `rgba(${CONFIG.rgb}, 0.95)`);
      glow.addColorStop(0.45, `rgba(${CONFIG.rgb}, 0.35)`);
      glow.addColorStop(1, `rgba(${CONFIG.rgb}, 0)`);
      sctx.fillStyle = glow;
      sctx.fillRect(0, 0, SPRITE, SPRITE);
    }

    const drawParticle = (p: Sparkle) => {
      // The sprite's solid core is ~22% of its radius, so scale it so that
      // core matches the sparkle's size and the glow extends around it.
      const radius = p.size * 4.5;
      ctx.globalAlpha = p.alpha;
      ctx.drawImage(sprite, p.x - radius, p.y - radius, radius * 2, radius * 2);
    };

    const draw = () => {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(bg, 0, 0);
      ctx.restore();

      particles.forEach(drawParticle);
      ctx.globalAlpha = 1;
    };

    /* ── RENDER LOOP (parked while off screen or the tab is hidden) ── */
    let frame = 0;
    let running = false;

    // Holds its frame while the page scrolls (see LandingPage.tsx's
    // .is-scrolling), so the canvas isn't repainted under the compositor.
    const holder = canvas.closest('.lp-body');
    const tick = () => {
      frame = requestAnimationFrame(tick);
      if (holder?.classList.contains('is-scrolling')) return;
      particles.forEach(update);
      draw();
    };

    const start = () => {
      if (running || reduceMotion) return;
      running = true;
      frame = requestAnimationFrame(tick);
    };

    const stop = () => {
      if (!running) return;
      running = false;
      cancelAnimationFrame(frame);
    };

    // The first frame paints even for reduced-motion visitors, who keep it.
    draw();

    let onScreen = false;
    const sync = () => (onScreen && !document.hidden ? start() : stop());

    const io = new IntersectionObserver(
      ([entry]) => {
        onScreen = entry.isIntersecting;
        sync();
      },
      { threshold: 0 },
    );
    io.observe(canvas);
    document.addEventListener('visibilitychange', sync);

    const ro = new ResizeObserver(() => {
      width = canvas.clientWidth || 1;
      height = canvas.clientHeight || 1;
      fitCanvas();
      // Scatter sparkles the shrunken box left outside it; otherwise they all
      // respawn along the bottom edge at once and rise as a band.
      particles.forEach((p) => {
        if (p.x > width || p.y > height) {
          p.x = Math.random() * width;
          p.y = Math.random() * height;
        }
      });
      if (!running) draw();
    });
    ro.observe(canvas);

    return () => {
      stop();
      io.disconnect();
      ro.disconnect();
      document.removeEventListener('visibilitychange', sync);
    };
  }, []);

  return <canvas className="lp-sparkle-fx" ref={canvasRef} aria-hidden="true" />;
}
