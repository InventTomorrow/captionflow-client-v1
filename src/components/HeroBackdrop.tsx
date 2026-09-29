import { useEffect, useRef } from 'react';

type Three = typeof import('three');

/** Tuning for the terrain + particle field. */
const CONFIG = {
  /** World units per second the ridges roll toward the camera. */
  flow: 1.4,
  /** Height range of the noise terrain (peaks reach roughly +amp, valleys -amp). */
  amp: 6.5,
  /** Seconds between light sweeps rolling in from the horizon. */
  sweepEvery: 7,
  /** Square-particle counts, far/fine → near/bold. */
  particles: { fine: 520, mid: 170, bold: 46 },
  /** Pixel-ratio cap: wireframe lines read fine at 1.25x and fill cost is
   *  what hurts integrated GPUs on a full-screen canvas. */
  maxPixelRatio: 1.25,
};

/* Palette — the landing accent (#89E900) and the darker greens it fades into.
   Valleys sit close to the background so only the ridges and peaks read. */
const GRID_LOW = { r: 0.03, g: 0.17, b: 0.08 };
const GRID_HIGH = { r: 0.5, g: 0.86, b: 0.06 };
const SWEEP = { r: 0.72, g: 1.0, b: 0.5 };

/* ── Periodic value noise, baked once into a tile ──────────────────────────
   Hashing three octaves per vertex per frame was the hero's biggest CPU cost.
   The terrain only ever samples a scrolling window of the same field, so the
   field is baked once into a seamless tile and each vertex does one bilinear
   lookup instead. */

/** Samples per side of the tile. */
const TILE = 256;
/** Lattice cells per side at the base octave (the tile repeats every cell count). */
const TILE_CELLS = 8;
/** World units covered by one repeat of the tile (base frequency ≈ 0.038/unit). */
const TILE_WORLD = TILE_CELLS / 0.038;

const hash = (x: number, y: number) => {
  let n = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
};

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Value noise on a lattice that wraps every `period` cells. */
const wrappedNoise = (x: number, y: number, period: number) => {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const u = smooth(x - ix);
  const v = smooth(y - iy);
  const x0 = ((ix % period) + period) % period;
  const y0 = ((iy % period) + period) % period;
  const x1 = (x0 + 1) % period;
  const y1 = (y0 + 1) % period;
  const a = hash(x0, y0);
  const b = hash(x1, y0);
  const c = hash(x0, y1);
  const d = hash(x1, y1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
};

let noiseTile: Float32Array | null = null;

/** Three octaves of wrapped value noise, roughly 0..0.9, baked on first use. */
function getNoiseTile(): Float32Array {
  if (noiseTile) return noiseTile;
  const tile = new Float32Array(TILE * TILE);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      let sum = 0;
      let amp = 0.5;
      let cells = TILE_CELLS;
      for (let o = 0; o < 3; o++) {
        sum += amp * wrappedNoise((x / TILE) * cells + 3.1, (y / TILE) * cells, cells);
        amp *= 0.5;
        cells *= 2;
      }
      tile[y * TILE + x] = sum;
    }
  }
  noiseTile = tile;
  return tile;
}

/** Bilinear sample of the tile at fractional tile coordinates (wrapping). */
const sampleTile = (tile: Float32Array, fx: number, fy: number) => {
  const x = ((fx % TILE) + TILE) % TILE;
  const y = ((fy % TILE) + TILE) % TILE;
  const x0 = x | 0;
  const y0 = y | 0;
  const x1 = (x0 + 1) % TILE;
  const y1 = (y0 + 1) % TILE;
  const tx = x - x0;
  const ty = y - y0;
  const row0 = y0 * TILE;
  const row1 = y1 * TILE;
  const a = tile[row0 + x0];
  const b = tile[row0 + x1];
  const c = tile[row1 + x0];
  const d = tile[row1 + x1];
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
};

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = (v: number) => clamp(v, 0, 1);
const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Soft-edged square sprite for the particle field (drawn once, shared). */
function makeSquareSprite(THREE: Three, blur: number) {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const side = size * 0.42;
    ctx.shadowColor = 'rgba(137, 233, 0, 1)';
    ctx.shadowBlur = blur;
    ctx.fillStyle = '#d6ff9e';
    ctx.fillRect((size - side) / 2, (size - side) / 2, side, side);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Animated hero backdrop: a three.js wireframe terrain that rolls toward the
 * viewer under a field of drifting square particles, beneath CSS aurora orbs
 * and a cursor spotlight.
 *
 *  - Terrain height is baked value noise plus two slow-moving hills, so it
 *    reads as ridges and peaks rather than a regular wave. Vertex colours
 *    brighten with height and dim with distance, and a light band sweeps in
 *    from the horizon every few seconds.
 *  - Particles are soft squares in three depth classes; each drifts upward,
 *    twinkles, and the whole field turns slowly.
 *  - The camera eases toward the cursor and settles lower as the page
 *    scrolls, so the scene has parallax against the copy.
 *
 * Kept cheap on purpose: the noise is a tile lookup, the canvas is capped at
 * 1.5x, the spotlight moves with a transform (no layout), and scroll position
 * comes from the scroll event rather than a per-frame layout read. three.js
 * is imported dynamically so it lands in its own chunk. The loop parks while
 * the hero is off screen or the tab is hidden, and reduced-motion visitors
 * get a single still frame.
 */
export function HeroBackdrop() {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const spotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    const spot = spotRef.current;
    if (!root || !canvas || !spot) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let width = root.clientWidth || 1;
    let height = root.clientHeight || 1;
    /** True while the hero is on screen and the tab is visible. */
    let live = !document.hidden;

    /* ── SCROLL (read from the event, never from layout inside the loop) ── */
    let scrollY = window.scrollY;
    let heroTop = 0;
    const measureTop = () => {
      heroTop = root.getBoundingClientRect().top + window.scrollY;
    };
    measureTop();
    const onScroll = () => {
      scrollY = window.scrollY;
    };
    window.addEventListener('scroll', onScroll, { passive: true });

    /* ── MOUSE SPOTLIGHT (section-local pixels, starts centered) ── */
    let tmx = width / 2;
    let tmy = height / 2;
    let mx = tmx;
    let my = tmy;

    const placeSpotlight = () => {
      spot.style.transform = `translate3d(${mx.toFixed(1)}px, ${my.toFixed(1)}px, 0)`;
    };
    placeSpotlight();

    const onMouseMove = (e: MouseEvent) => {
      const rect = root.getBoundingClientRect();
      tmx = e.clientX - rect.left;
      tmy = e.clientY - rect.top;
    };
    window.addEventListener('mousemove', onMouseMove, { passive: true });

    let spotFrame = 0;
    const tickSpotlight = () => {
      spotFrame = requestAnimationFrame(tickSpotlight);
      const dx = tmx - mx;
      const dy = tmy - my;
      // Once the ease has settled, stop touching the style: every write is a
      // style recalc, and an idle cursor shouldn't cost one per frame.
      if (Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05) return;
      mx += dx * 0.1;
      my += dy * 0.1;
      placeSpotlight();
    };
    if (!reduceMotion && live) spotFrame = requestAnimationFrame(tickSpotlight);

    /* ── THREE.JS SCENE (deferred) ── */
    let disposed = false;
    let disposeScene = () => {};
    let resizeScene = () => {};
    let startScene = () => {};
    let stopScene = () => {};

    void import('three')
      .then((THREE) => {
        if (disposed) return;

        const tile = getNoiseTile();

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 400);
        const CAMERA_BASE = { x: 0, y: 13, z: 48 };
        camera.position.set(CAMERA_BASE.x, CAMERA_BASE.y, CAMERA_BASE.z);
        const lookTarget = new THREE.Vector3(0, -16, -12);

        const renderer = new THREE.WebGLRenderer({
          canvas,
          alpha: true,
          antialias: true,
          powerPreference: 'high-performance',
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, CONFIG.maxPixelRatio));
        renderer.setSize(width, height, false);

        /* ── TERRAIN ── */
        const COLS = 72;
        const ROWS = 54;
        const GRID_W = 190;
        const GRID_D = 140;
        const gridGeo = new THREE.PlaneGeometry(GRID_W, GRID_D, COLS, ROWS);
        const gridPos = gridGeo.attributes.position;
        const gridArr = gridPos.array as Float32Array;
        const gridColors = new Float32Array(gridPos.count * 3);
        gridGeo.setAttribute('color', new THREE.BufferAttribute(gridColors, 3));
        const gridMat = new THREE.MeshBasicMaterial({
          wireframe: true,
          vertexColors: true,
          transparent: true,
          opacity: 0.44,
          depthWrite: false,
        });
        const gridMesh = new THREE.Mesh(gridGeo, gridMat);
        gridMesh.rotation.x = -Math.PI / 2;
        gridMesh.position.y = -13;
        scene.add(gridMesh);

        /** Two broad hills that wander slowly, so the horizon keeps a skyline. */
        const hills = [
          { x: -42, z: 8, h: 9, r: 28 },
          { x: 46, z: -4, h: 11, r: 32 },
        ];

        /* ── PARTICLES (three depth classes of soft squares) ── */
        const crispSprite = makeSquareSprite(THREE, 6);
        const softSprite = makeSquareSprite(THREE, 18);

        type Field = {
          points: import('three').Points;
          geo: import('three').BufferGeometry;
          mat: import('three').PointsMaterial;
          positions: Float32Array;
          velocity: Float32Array;
          baseOpacity: number;
          twinkle: number;
          phase: number;
        };

        const makeField = (
          count: number,
          size: number,
          opacity: number,
          sprite: import('three').Texture,
          tint: number,
        ): Field => {
          const geo = new THREE.BufferGeometry();
          const positions = new Float32Array(count * 3);
          const colors = new Float32Array(count * 3);
          const velocity = new Float32Array(count);
          const base = new THREE.Color(tint);
          const bright = new THREE.Color(0xd6ff9e);
          for (let i = 0; i < count; i++) {
            positions[i * 3] = (Math.random() - 0.5) * 210;
            positions[i * 3 + 1] = (Math.random() - 0.5) * 110;
            positions[i * 3 + 2] = (Math.random() - 0.5) * 120;
            const c = base.clone().lerp(bright, Math.random() * 0.5);
            colors[i * 3] = c.r;
            colors[i * 3 + 1] = c.g;
            colors[i * 3 + 2] = c.b;
            velocity[i] = 0.5 + Math.random() * 1.1;
          }
          geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
          geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
          const mat = new THREE.PointsMaterial({
            size,
            map: sprite,
            vertexColors: true,
            transparent: true,
            opacity,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          });
          const points = new THREE.Points(geo, mat);
          scene.add(points);
          return {
            points,
            geo,
            mat,
            positions,
            velocity,
            baseOpacity: opacity,
            twinkle: 0.6 + Math.random() * 0.6,
            phase: Math.random() * Math.PI * 2,
          };
        };

        const fields: Field[] = [
          makeField(CONFIG.particles.fine, 0.95, 1, crispSprite, 0x89e900),
          makeField(CONFIG.particles.mid, 2, 0.8, crispSprite, 0x78e08f),
          makeField(CONFIG.particles.bold, 4.4, 0.42, softSprite, 0x4cd137),
        ];

        /* ── RENDER LOOP ── */
        const tileScale = TILE / TILE_WORLD;
        const dR = GRID_HIGH.r - GRID_LOW.r;
        const dG = GRID_HIGH.g - GRID_LOW.g;
        const dB = GRID_HIGH.b - GRID_LOW.b;

        /* The terrain only needs re-shaping every other frame — it moves
           slowly, and its vertex/colour rewrite plus GPU upload is the
           loop's main CPU cost. Camera and particles still update every
           frame, so motion stays smooth. */
        let terrainFrame = 0;

        const draw = (t: number, dt: number) => {
          terrainFrame++;
          if (terrainFrame % 2 === 1 || dt === 0) {
          /* Terrain: baked noise + wandering hills, coloured by height and distance. */
          const flowT = t * CONFIG.flow;
          const sweepPhase = (t % CONFIG.sweepEvery) / CONFIG.sweepEvery;
          // The band starts beyond the far edge and rolls to the near edge.
          const sweepV = GRID_D * 0.55 - sweepPhase * GRID_D * 1.1;
          const hillDrift = Math.sin(t * 0.09) * 6;
          const hill0x = hills[0].x + hillDrift;
          const hill1x = hills[1].x + hillDrift;
          const inv0 = 1 / (2 * hills[0].r * hills[0].r);
          const inv1 = 1 / (2 * hills[1].r * hills[1].r);

          for (let i = 0, j = 0; i < gridPos.count; i++, j += 3) {
            const u = gridArr[j];
            const v = gridArr[j + 1];
            // +v is away from the camera after the -90° tilt; add time so the
            // ridges travel toward the viewer.
            const n = sampleTile(tile, u * tileScale, (v + flowT) * tileScale);
            let h = (n * 1.45 - 0.62) * CONFIG.amp;
            const dx0 = u - hill0x;
            const dz0 = v - hills[0].z;
            h += hills[0].h * Math.exp(-(dx0 * dx0 + dz0 * dz0) * inv0);
            const dx1 = u - hill1x;
            const dz1 = v - hills[1].z;
            h += hills[1].h * Math.exp(-(dx1 * dx1 + dz1 * dz1) * inv1);
            gridArr[j + 2] = h;

            const lift = clamp01((h + CONFIG.amp) / (CONFIG.amp * 2.6));
            const tone = lift * lift * lift;
            // Far rows fade toward black so the grid dissolves at the horizon.
            const dist = (v + GRID_D / 2) / GRID_D;
            const fade = 1 - smoothstep(0.25, 1, dist) * 0.97;
            // Rolling light band.
            const dv = v - sweepV;
            const band = Math.exp(-(dv * dv) / 98) * 0.55 * fade;

            gridColors[j] = (GRID_LOW.r + dR * tone) * fade + SWEEP.r * band;
            gridColors[j + 1] = (GRID_LOW.g + dG * tone) * fade + SWEEP.g * band;
            gridColors[j + 2] = (GRID_LOW.b + dB * tone) * fade + SWEEP.b * band;
          }
          gridPos.needsUpdate = true;
          gridGeo.attributes.color.needsUpdate = true;
          }

          /* Particles: rise, wrap, twinkle, and turn slowly as one field. */
          for (const field of fields) {
            const arr = field.positions;
            for (let i = 0; i < field.velocity.length; i++) {
              let y = arr[i * 3 + 1] + field.velocity[i] * dt;
              if (y > 55) y -= 110;
              arr[i * 3 + 1] = y;
            }
            (field.geo.attributes.position as import('three').BufferAttribute).needsUpdate = true;
            field.points.rotation.y = t * 0.02;
            field.points.rotation.x = Math.sin(t * 0.05) * 0.04;
            field.mat.opacity =
              field.baseOpacity * (0.72 + 0.28 * Math.sin(t * field.twinkle + field.phase));
          }

          /* Camera: cursor drift plus scroll parallax. */
          const scrollShift = clamp(scrollY - heroTop, 0, 900) * 0.012;
          const nx = (tmx / width) * 2 - 1;
          const ny = -(tmy / height) * 2 + 1;
          camera.position.x += (CAMERA_BASE.x + nx * 5 - camera.position.x) * 0.04;
          camera.position.y += (CAMERA_BASE.y + ny * 2.5 - scrollShift - camera.position.y) * 0.05;
          camera.lookAt(lookTarget);

          renderer.render(scene, camera);
        };

        // Own clock rather than THREE.Clock: the loop is parked while the hero
        // is scrolled out of view or the tab is hidden, and wall-clock time
        // would make the terrain jump on resume.
        let elapsed = 0;
        let last = 0;
        let frame = 0;
        let running = false;

        // While the page is scrolling (LandingPage.tsx flags .lp-body with
        // .is-scrolling) the scene holds its last frame: rendering it under
        // a scroll competes with the compositor for the same GPU.
        const holder = root.closest('.lp-body');
        const tick = (now: number) => {
          frame = requestAnimationFrame(tick);
          if (holder?.classList.contains('is-scrolling')) {
            last = now;
            return;
          }
          const dt = Math.min((now - last) / 1000, 0.05);
          last = now;
          elapsed += dt;
          draw(elapsed, dt);
        };

        startScene = () => {
          if (running || reduceMotion) return;
          running = true;
          last = performance.now();
          frame = requestAnimationFrame(tick);
        };

        stopScene = () => {
          if (!running) return;
          running = false;
          cancelAnimationFrame(frame);
        };

        resizeScene = () => {
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
          renderer.setSize(width, height, false);
          if (!running) draw(elapsed, 0);
        };

        disposeScene = () => {
          stopScene();
          scene.clear();
          gridGeo.dispose();
          gridMat.dispose();
          for (const field of fields) {
            field.geo.dispose();
            field.mat.dispose();
          }
          crispSprite.dispose();
          softSprite.dispose();
          renderer.dispose();
        };

        // The first frame paints even for reduced-motion visitors, who keep it.
        draw(0, 0);
        if (live) startScene();
      })
      .catch(() => {
        // No WebGL, or the chunk failed to load — the CSS orbs and spotlight
        // still carry the section, so fall back to them silently.
      });

    /* ── VISIBILITY / RESIZE ── */
    const setLive = (next: boolean) => {
      if (next === live) return;
      live = next;
      if (next) {
        startScene();
        if (!reduceMotion && !spotFrame) spotFrame = requestAnimationFrame(tickSpotlight);
      } else {
        stopScene();
        cancelAnimationFrame(spotFrame);
        spotFrame = 0;
      }
    };

    const io = new IntersectionObserver(
      ([entry]) => setLive(entry.isIntersecting && !document.hidden),
      { threshold: 0 },
    );
    io.observe(root);

    const onVisibility = () => {
      setLive(!document.hidden && root.getBoundingClientRect().bottom > 0);
    };
    document.addEventListener('visibilitychange', onVisibility);

    const ro = new ResizeObserver(() => {
      width = root.clientWidth || 1;
      height = root.clientHeight || 1;
      measureTop();
      resizeScene();
    });
    ro.observe(root);
    window.addEventListener('resize', measureTop);

    return () => {
      disposed = true;
      cancelAnimationFrame(spotFrame);
      io.disconnect();
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', measureTop);
      disposeScene();
    };
  }, []);

  return (
    <div className="lp-hero-fx" ref={rootRef} aria-hidden="true">
      <canvas className="lp-hero-fx-canvas" ref={canvasRef} />
      <div className="lp-hero-orb lp-hero-orb-1" />
      <div className="lp-hero-orb lp-hero-orb-2" />
      <div className="lp-hero-orb lp-hero-orb-3" />
      <div className="lp-hero-spotlight" ref={spotRef} />
    </div>
  );
}
