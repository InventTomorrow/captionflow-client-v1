import { useEffect, useRef } from 'react';

/** Base tuning from the `Asaan Caption.html` preview — keep in sync with it. */
const CONFIG = {
  bg: '#041007',
  starColor: '#80f727',
  /** starColor as an RGB triple for rgba() fills. */
  starRgb: '128, 247, 39',
  /** Brighter tint for pulse heads and node flashes. */
  sparkRgb: '212, 255, 154',
  shade1: 'rgba(128, 247, 39, 0.081)',
  shade2: 'rgba(20, 83, 45, 0.112)',
  densityMultiplier: 1.9,
  speedMultiplier: 2.5,
  mouseRadius: 150,
};

/**
 * Depth layers, far → near. Nearer layers hold bigger, brighter, faster nodes
 * with longer links and drift further as the page scrolls, which is what sells
 * the depth. Links only form inside a layer, so the planes read separately.
 */
const LAYERS = [
  { share: 0.4, size: 0.6, alpha: 0.45, speed: 0.5, link: 90, linkAlpha: 0.1, parallax: 0.06, push: false },
  { share: 0.35, size: 1, alpha: 0.8, speed: 1, link: 110, linkAlpha: 0.2, parallax: 0.14, push: true },
  { share: 0.25, size: 1.45, alpha: 1, speed: 1.4, link: 130, linkAlpha: 0.26, parallax: 0.26, push: true },
] as const;

/** Signal pulses that run along links and hop from node to node. */
const PULSES = {
  max: 26,
  /** Frames between spawn attempts (at 60fps). */
  spawnEvery: 7,
  /** Chance a pulse carries on to a neighbour when it arrives. */
  chain: 0.6,
  maxHops: 3,
};

/** Cursor glow and the links it draws to nearby nodes. */
const CURSOR = { glowRadius: 240, glowAlpha: 0.1, link: 170, linkAlpha: 0.35 };

type Node = {
  layer: number;
  x: number;
  y: number;
  /** Where the node was drawn this frame (after parallax + wrap). */
  sx: number;
  sy: number;
  size: number;
  alpha: number;
  vx: number;
  vy: number;
  twinkleSpeed: number;
  /** 1 when a pulse lands on the node, decays to 0 — drives the ring. */
  flash: number;
};

type Pulse = { from: Node; to: Node; t: number; dur: number; hops: number };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const wrap = (v: number, size: number) => ((v % size) + size) % size;

/**
 * Layered, pulsing green node network — the `Asaan Caption.html` preview
 * (dark fill, two soft glows, twinkling nodes joined by faint links, a cursor
 * that pushes nodes away) upgraded for the pricing → final CTA run:
 *  - three depth layers with scroll parallax;
 *  - signal pulses that travel along links and hop between nodes;
 *  - a cursor glow that links itself to nearby nodes;
 *  - a centre glow that builds as the visitor scrolls toward the final CTA.
 *
 * Structural differences from the preview:
 *  - the preview pinned the canvas to the viewport (`position: fixed`) for the
 *    whole page; here the canvas is one screen tall and is moved to follow the
 *    viewport only while the wrapper it decorates is on screen, so it keeps
 *    the "fixed" feel inside that range and nowhere else, and the particle
 *    count — and the pairwise link pass — stays at one screen's worth;
 *  - the canvas is scaled for the device pixel ratio;
 *  - motion is scaled by frame time, so 120Hz screens don't run double speed;
 *  - nodes are only rebuilt when the width changes, so a phone's address bar
 *    sliding in and out doesn't reshuffle the field;
 *  - the cursor is mouse only; a finger scrolling the page doesn't push nodes;
 *  - the loop is parked while the range is off screen or the tab is hidden,
 *    and reduced-motion visitors get a single still frame.
 */
export function MeshBackdrop() {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!root || !canvas || !ctx) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let width = 0;
    let height = 0;
    /** Nodes grouped by layer, far → near. */
    let layers: Node[][] = [];
    let pulses: Pulse[] = [];
    let spawnClock = 0;

    /** Pixels scrolled past the top of the range, and 0→1 progress through it. */
    let scrolled = 0;
    let progress = 0;

    /** Pointer in viewport coordinates; null while it is outside the window. */
    let pointer: { x: number; y: number } | null = null;

    const createNodes = () => {
      const total = Math.floor(Math.floor((width * height) / 12000) * CONFIG.densityMultiplier);
      layers = LAYERS.map((cfg, layer) =>
        Array.from({ length: Math.round(total * cfg.share) }, () => {
          const x = Math.random() * width;
          const y = Math.random() * height;
          return {
            layer,
            x,
            y,
            sx: x,
            sy: y,
            size: (Math.random() * 2.2 + 0.6) * cfg.size,
            alpha: Math.random(),
            vx: (Math.random() - 0.5) * 0.5 * CONFIG.speedMultiplier * cfg.speed,
            vy: (Math.random() - 0.5) * 0.5 * CONFIG.speedMultiplier * cfg.speed,
            twinkleSpeed: (Math.random() * 0.02 + 0.005) * CONFIG.speedMultiplier,
            flash: 0,
          };
        }),
      );
      pulses = [];
    };

    // The dark fill and the preview's two shading glows only change with the
    // canvas size, so they are painted once into an offscreen canvas on fit()
    // and blitted each frame; only the scroll-driven centre glow is still a
    // per-frame gradient.
    const bg = document.createElement('canvas');
    const bgCtx = bg.getContext('2d');

    /** Screen-sized canvas, capped at the wrapper's height. */
    const fit = () => {
      const nextWidth = root.clientWidth || 1;
      const nextHeight = Math.max(1, Math.min(window.innerHeight, root.clientHeight || 1));
      const widthChanged = nextWidth !== width;
      width = nextWidth;
      height = nextHeight;

      // 1.25x keeps the nodes crisp enough while keeping the per-frame fill
      // affordable on an integrated GPU.
      const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
      canvas.style.height = `${height}px`;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      bg.width = canvas.width;
      bg.height = canvas.height;
      if (bgCtx) {
        bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        bgCtx.fillStyle = CONFIG.bg;
        bgCtx.fillRect(0, 0, width, height);
        const grad1 = bgCtx.createRadialGradient(width * 0.8, height * 0.2, 10, width * 0.8, height * 0.2, width * 0.55);
        grad1.addColorStop(0, CONFIG.shade1);
        grad1.addColorStop(1, 'transparent');
        bgCtx.fillStyle = grad1;
        bgCtx.fillRect(0, 0, width, height);
        const grad2 = bgCtx.createRadialGradient(width * 0.2, height * 0.8, 10, width * 0.2, height * 0.8, width * 0.55);
        grad2.addColorStop(0, CONFIG.shade2);
        grad2.addColorStop(1, 'transparent');
        bgCtx.fillStyle = grad2;
        bgCtx.fillRect(0, 0, width, height);
      }

      if (widthChanged || layers.length === 0) createNodes();
    };

    /** Keeps the canvas over whichever part of the wrapper is on screen.
     *  The transform is only written when the offset actually changes: an
     *  unconditional write every frame forced a style recalc on every frame
     *  the loop ran, even with the page sitting still. */
    let lastOffset = -1;
    const follow = () => {
      const rect = root.getBoundingClientRect();
      const travel = Math.max(rect.height - height, 0);
      const offset = Math.round(clamp(-rect.top, 0, travel));
      if (offset !== lastOffset) {
        lastOffset = offset;
        canvas.style.transform = `translate3d(0, ${offset}px, 0)`;
      }
      scrolled = -rect.top;
      progress = travel > 0 ? clamp(-rect.top / travel, 0, 1) : 1;
    };

    /** Places every node for this frame: its drift position plus scroll parallax. */
    const place = () => {
      layers.forEach((nodes, i) => {
        const shift = scrolled * LAYERS[i].parallax;
        for (const p of nodes) {
          p.sx = p.x;
          p.sy = wrap(p.y - shift, height);
        }
      });
    };

    const neighbours = (node: Node, exclude: Node | null) => {
      const reach = LAYERS[node.layer].link;
      const reachSq = reach * reach;
      return layers[node.layer].filter((o) => {
        if (o === node || o === exclude) return false;
        const dx = o.sx - node.sx;
        const dy = o.sy - node.sy;
        return dx * dx + dy * dy < reachSq;
      });
    };

    const launchFrom = (from: Node, exclude: Node | null, hops: number): Pulse | null => {
      const options = neighbours(from, exclude);
      if (options.length === 0) return null;
      const to = options[Math.floor(Math.random() * options.length)];
      return { from, to, t: 0, dur: 38 + Math.random() * 34, hops };
    };

    const step = (k: number) => {
      const rect = canvas.getBoundingClientRect();
      const mx = pointer ? pointer.x - rect.left : 0;
      const my = pointer ? pointer.y - rect.top : 0;

      layers.forEach((nodes, i) => {
        const cfg = LAYERS[i];
        for (const p of nodes) {
          p.x = wrap(p.x + p.vx * k, width);
          p.y = wrap(p.y + p.vy * k, height);

          // Twinkle fade
          p.alpha += p.twinkleSpeed * k;
          if (p.alpha > 1 || p.alpha < 0.2) {
            p.twinkleSpeed = -p.twinkleSpeed;
            p.alpha = clamp(p.alpha, 0.2, 1);
          }

          p.flash = Math.max(0, p.flash - 0.035 * k);

          // Cursor pushes nearby mid/near nodes away (measured where they're drawn)
          if (pointer && cfg.push) {
            const mdx = p.sx - mx;
            const mdy = p.sy - my;
            const mdist = Math.sqrt(mdx * mdx + mdy * mdy);
            if (mdist < CONFIG.mouseRadius && mdist > 0) {
              const force = (CONFIG.mouseRadius - mdist) / CONFIG.mouseRadius;
              p.x = wrap(p.x + (mdx / mdist) * force * 3.5 * k, width);
              p.y = wrap(p.y + (mdy / mdist) * force * 3.5 * k, height);
            }
          }
        }
      });

      place();

      // Advance pulses; retire any whose link broke (wrapped or drifted apart).
      const next: Pulse[] = [];
      for (const pulse of pulses) {
        pulse.t += k / pulse.dur;
        const reach = LAYERS[pulse.from.layer].link * 1.3;
        const dx = pulse.to.sx - pulse.from.sx;
        const dy = pulse.to.sy - pulse.from.sy;
        if (dx * dx + dy * dy > reach * reach) continue;
        if (pulse.t < 1) {
          next.push(pulse);
          continue;
        }
        pulse.to.flash = 1;
        if (pulse.hops < PULSES.maxHops && Math.random() < PULSES.chain) {
          const hop = launchFrom(pulse.to, pulse.from, pulse.hops + 1);
          if (hop) next.push(hop);
        }
      }
      pulses = next;

      // Spawn fresh pulses from mid/near nodes.
      spawnClock += k;
      while (spawnClock >= PULSES.spawnEvery) {
        spawnClock -= PULSES.spawnEvery;
        if (pulses.length >= PULSES.max) continue;
        const pool = layers[1 + Math.floor(Math.random() * 2)] ?? [];
        if (pool.length === 0) continue;
        const fresh = launchFrom(pool[Math.floor(Math.random() * pool.length)], null, 0);
        if (fresh) pulses.push(fresh);
      }
    };

    const draw = () => {
      // 1 + 2. Dark background and the pair of shading glows, pre-rendered.
      ctx.globalAlpha = 1;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(bg, 0, 0);
      ctx.restore();

      // 3. Centre glow that builds toward the final CTA
      const build = ctx.createRadialGradient(
        width * 0.5,
        height * 0.58,
        10,
        width * 0.5,
        height * 0.58,
        Math.max(width, height) * 0.6,
      );
      build.addColorStop(0, `rgba(${CONFIG.starRgb}, ${0.025 + 0.085 * progress})`);
      build.addColorStop(1, 'transparent');
      ctx.fillStyle = build;
      ctx.fillRect(0, 0, width, height);

      // 4. Links, per layer (far first, so near links sit on top)
      ctx.strokeStyle = CONFIG.starColor;
      ctx.lineWidth = 1;
      layers.forEach((nodes, i) => {
        const cfg = LAYERS[i];
        const reachSq = cfg.link * cfg.link;
        for (let a = 0; a < nodes.length; a++) {
          const p = nodes[a];
          for (let b = a + 1; b < nodes.length; b++) {
            const q = nodes[b];
            const dx = p.sx - q.sx;
            const dy = p.sy - q.sy;
            const distSq = dx * dx + dy * dy;
            if (distSq < reachSq) {
              ctx.globalAlpha = (1 - Math.sqrt(distSq) / cfg.link) * cfg.linkAlpha;
              ctx.beginPath();
              ctx.moveTo(p.sx, p.sy);
              ctx.lineTo(q.sx, q.sy);
              ctx.stroke();
            }
          }
        }
      });

      // 5. Cursor glow + links to nearby nodes
      if (pointer) {
        const rect = canvas.getBoundingClientRect();
        const mx = pointer.x - rect.left;
        const my = pointer.y - rect.top;
        if (mx >= 0 && mx <= width && my >= 0 && my <= height) {
          const glow = ctx.createRadialGradient(mx, my, 0, mx, my, CURSOR.glowRadius);
          glow.addColorStop(0, `rgba(${CONFIG.starRgb}, ${CURSOR.glowAlpha})`);
          glow.addColorStop(1, 'transparent');
          ctx.globalAlpha = 1;
          ctx.fillStyle = glow;
          ctx.fillRect(mx - CURSOR.glowRadius, my - CURSOR.glowRadius, CURSOR.glowRadius * 2, CURSOR.glowRadius * 2);

          const reachSq = CURSOR.link * CURSOR.link;
          for (const nodes of layers.slice(1)) {
            for (const p of nodes) {
              const dx = p.sx - mx;
              const dy = p.sy - my;
              const distSq = dx * dx + dy * dy;
              if (distSq < reachSq) {
                ctx.globalAlpha = (1 - Math.sqrt(distSq) / CURSOR.link) * CURSOR.linkAlpha;
                ctx.beginPath();
                ctx.moveTo(mx, my);
                ctx.lineTo(p.sx, p.sy);
                ctx.stroke();
              }
            }
          }
        }
      }

      // 6. Nodes
      ctx.fillStyle = CONFIG.starColor;
      layers.forEach((nodes, i) => {
        const layerAlpha = LAYERS[i].alpha;
        for (const p of nodes) {
          ctx.globalAlpha = clamp(p.alpha, 0, 1) * layerAlpha;
          ctx.beginPath();
          ctx.arc(p.sx, p.sy, p.size, 0, Math.PI * 2);
          ctx.fill();
        }
      });

      // 7. Landing flashes — a ring that widens and fades
      ctx.strokeStyle = `rgb(${CONFIG.sparkRgb})`;
      for (const nodes of layers) {
        for (const p of nodes) {
          if (p.flash <= 0) continue;
          ctx.globalAlpha = p.flash * 0.6;
          ctx.beginPath();
          ctx.arc(p.sx, p.sy, p.size + (1 - p.flash) * 9, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // 8. Pulses — a lit trail along the link plus a glowing head
      for (const pulse of pulses) {
        const { from, to } = pulse;
        const t = clamp(pulse.t, 0, 1);
        const hx = from.sx + (to.sx - from.sx) * t;
        const hy = from.sy + (to.sy - from.sy) * t;
        const fade = Math.sin(Math.PI * t) * 0.4 + 0.6;

        ctx.globalAlpha = 0.45 * fade;
        ctx.strokeStyle = CONFIG.starColor;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(from.sx, from.sy);
        ctx.lineTo(hx, hy);
        ctx.stroke();

        ctx.fillStyle = `rgb(${CONFIG.starRgb})`;
        ctx.globalAlpha = 0.16 * fade;
        ctx.beginPath();
        ctx.arc(hx, hy, 6, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = `rgb(${CONFIG.sparkRgb})`;
        ctx.globalAlpha = fade;
        ctx.beginPath();
        ctx.arc(hx, hy, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.lineWidth = 1;
      ctx.globalAlpha = 1;
    };

    /* ── RENDER LOOP (parked while off screen or the tab is hidden) ── */
    let frame = 0;
    let running = false;
    let last = 0;

    // While the page scrolls (LandingPage.tsx's .is-scrolling) the field is
    // drawn at half rate: the canvas still follows the viewport every frame
    // so it keeps its fixed feel, but repainting it under the compositor
    // every frame is what an integrated GPU can't afford.
    const holder = root.closest('.lp-body');
    let oddFrame = false;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      oddFrame = !oddFrame;
      if (oddFrame && holder?.classList.contains('is-scrolling')) {
        follow();
        return;
      }
      // Frame-time scale: 1 at 60fps; capped so a stalled tab doesn't jump.
      const k = clamp((now - last) / (1000 / 60), 0, 3);
      last = now;
      follow();
      step(k);
      draw();
    };

    const start = () => {
      if (running || reduceMotion) return;
      running = true;
      last = performance.now();
      frame = requestAnimationFrame(tick);
    };

    const stop = () => {
      if (!running) return;
      running = false;
      cancelAnimationFrame(frame);
    };

    const still = () => {
      follow();
      place();
      draw();
    };

    fit();
    // The first frame paints even for reduced-motion visitors, who keep it.
    still();

    let onScreen = false;
    const sync = () => (onScreen && !document.hidden ? start() : stop());

    const io = new IntersectionObserver(
      ([entry]) => {
        onScreen = entry.isIntersecting;
        sync();
      },
      { threshold: 0 },
    );
    io.observe(root);
    document.addEventListener('visibilitychange', sync);

    // Scrolling still moves the canvas (and its parallax) when the loop is parked.
    const onScroll = () => {
      if (!running) still();
    };
    window.addEventListener('scroll', onScroll, { passive: true });

    // Mouse only, like the preview — a finger scrolling the page shouldn't
    // shove the nodes around.
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      pointer = { x: e.clientX, y: e.clientY };
    };
    const onPointerLeave = () => {
      pointer = null;
    };
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', onPointerLeave);

    const refit = () => {
      fit();
      if (!running) still();
    };
    const ro = new ResizeObserver(refit);
    ro.observe(root);
    window.addEventListener('resize', refit);

    return () => {
      stop();
      io.disconnect();
      ro.disconnect();
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('pointermove', onPointerMove);
      document.documentElement.removeEventListener('pointerleave', onPointerLeave);
      window.removeEventListener('resize', refit);
    };
  }, []);

  return (
    <div className="lp-mesh-fx" ref={rootRef} aria-hidden="true">
      <canvas className="lp-mesh-fx-canvas" ref={canvasRef} />
    </div>
  );
}
