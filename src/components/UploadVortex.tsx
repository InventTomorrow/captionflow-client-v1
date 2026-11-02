/** What the vortex is doing. The drop zone owns this; the vortex only reacts. */
export type VortexState = 'idle' | 'dragging' | 'uploading' | 'complete' | 'error';

/* The whole vortex is drawn in one 600×470 user-space box, so the art scales
   with the stage and its size is never buried in a camera constant.
   Everything below is in those units.

   Proportions come off the reference: the energy spans ~580 across and ~415
   down, so the rings are flattened to ry ≈ 0.78·rx rather than circular. */
const CX = 300;
const CY = 235;
/** Dark core — 300×244, the hole the copy is read in. */
const CORE_RX = 150;
const CORE_RY = 122;

/**
 * The energy streaks.
 *
 * Deliberately not concentric: each is a differently-proportioned ellipse at
 * its own angle, so where they cross reads as turbulence rather than as a set
 * of rings. `pathLength` normalises every one to 1000 units, so a dash pattern
 * means the same fraction of arc on all of them whatever their real
 * circumference — which is what lets one keyframe drive all of them.
 */
const STREAKS = [
  { rx: 288, ry: 224, rot: -14, w: 1.4, o: 0.5, dash: '150 850', dur: 26, delay: 0 },
  { rx: 276, ry: 218, rot: 26, w: 2.8, o: 0.88, dash: '320 680', dur: 19, delay: -4 },
  { rx: 264, ry: 202, rot: 58, w: 1.8, o: 0.62, dash: '210 790', dur: 31, delay: -11 },
  { rx: 250, ry: 198, rot: -38, w: 3.8, o: 0.95, dash: '400 600', dur: 22, delay: -7 },
  { rx: 236, ry: 180, rot: 12, w: 1.2, o: 0.46, dash: '120 880', dur: 35, delay: -2 },
  { rx: 222, ry: 176, rot: 74, w: 2.6, o: 0.82, dash: '280 720', dur: 17, delay: -9 },
  { rx: 208, ry: 158, rot: -62, w: 1.6, o: 0.56, dash: '180 820', dur: 28, delay: -15 },
  { rx: 194, ry: 154, rot: 40, w: 3.2, o: 0.92, dash: '350 650', dur: 15, delay: -3 },
  { rx: 180, ry: 138, rot: -20, w: 1.3, o: 0.5, dash: '140 860', dur: 24, delay: -18 },
  { rx: 168, ry: 134, rot: 86, w: 2.2, o: 0.78, dash: '300 700', dur: 13, delay: -6 },
  { rx: 158, ry: 126, rot: 8, w: 1.5, o: 0.6, dash: '190 810', dur: 21, delay: -13 },
];

/**
 * The glow: the same shapes again, far thicker and blurred.
 *
 * Duplicated strokes rather than a filter over the animated group — a blur
 * across content whose dash offset changes must be recomputed every frame,
 * whereas this layer only rotates, so the browser caches it and composites.
 */
const HAZE = [
  { rx: 276, ry: 218, rot: 26, w: 18, o: 0.26, dur: 44 },
  { rx: 250, ry: 198, rot: -38, w: 26, o: 0.3, dur: 60 },
  { rx: 222, ry: 176, rot: 74, w: 16, o: 0.22, dur: 52 },
  { rx: 194, ry: 154, rot: 40, w: 20, o: 0.26, dur: 38 },
];

/** Thin paths the vortex sits inside. Two pass behind it, one across the front.
 *  `nodes` are parametric angles on the ellipse, so a glowing dot can sit
 *  anywhere along a path rather than only at its widest point. */
const ORBITS = [
  { rx: 392, ry: 118, rot: -13, o: 0.3, nodes: [Math.PI, 0.35], dur: 90 },
  { rx: 318, ry: 96, rot: 34, o: 0.2, nodes: [2.2], dur: 124 },
  { rx: 448, ry: 140, rot: 7, o: 0.24, nodes: [0, 3.6, 4.9], dur: 104 },
];

/** A dot sitting on an ellipse at parameter `t`. */
const onEllipse = (rx: number, ry: number, t: number) => ({
  cx: CX + rx * Math.cos(t),
  cy: CY + ry * Math.sin(t),
});

/* Particles: support, not substance — 70 of them around the rim, built once at
   module scope so a re-render never reshuffles the field. */
const PARTICLES = Array.from({ length: 70 }, () => {
  const a = Math.random() * Math.PI * 2;
  const t = Math.random();
  const rx = CORE_RX + 12 + t * 140;
  return {
    cx: CX + Math.cos(a) * rx,
    cy: CY + Math.sin(a) * (rx * 0.78),
    r: 0.8 + Math.random() * 2.3,
    o: 0.3 + Math.random() * 0.7,
    delay: -(Math.random() * 16),
    dur: 8 + Math.random() * 12,
    /** A third ride the faster counter-rotating group, for parallax. */
    fast: Math.random() > 0.64,
  };
});

/* Wireframe globes. Positions are measured off the reference, relative to the
   vortex centre, so they sit outside the 600x470 box -- .up-vx-svg is
   overflow:visible, which is what lets them render out there. */
const GLOBES = [
  { cx: -262, cy: 288, r: 68, o: 0.5, lat: 5, lon: 7 },
  { cx: 806, cy: 190, r: 32, o: 0.42, lat: 4, lon: 6 },
  { cx: 688, cy: 346, r: 13, o: 0.46, lat: 3, lon: 5 },
];

/* The starfield the vortex sits in. Spread far wider than the stage -- in the
   reference these reach the page edges, which is most of what makes the hero
   feel like space rather than a graphic on a panel. Built once at module
   scope so a re-render never reshuffles it. */
const STARS = Array.from({ length: 90 }, () => {
  const x = -330 + Math.random() * 1260;
  const y = -90 + Math.random() * 650;
  // Thinned out near the middle, where the vortex already supplies detail.
  const dx = (x - CX) / 300;
  const dy = (y - CY) / 235;
  const near = Math.sqrt(dx * dx + dy * dy) < 1.05;
  return {
    x,
    y,
    r: near ? 0.5 + Math.random() * 0.7 : 0.7 + Math.random() * 1.6,
    o: (near ? 0.12 : 0.22) + Math.random() * 0.5,
    dur: 5 + Math.random() * 11,
    delay: -(Math.random() * 14),
  };
});

/**
 * A wireframe globe: latitudes are ellipses flattened toward the poles,
 * longitudes share the full height and vary in width. Drawn rather than
 * modelled -- there is no lighting here, only the silhouette, so a dozen
 * ellipses read the same as a sphere mesh at a fraction of the cost.
 */
function Globe({ cx, cy, r, o, lat, lon }: (typeof GLOBES)[number]) {
  const lats = [];
  for (let i = 1; i <= lat; i++) {
    const t = i / (lat + 1);
    const off = (t * 2 - 1) * r;
    const rx = Math.sqrt(Math.max(0, r * r - off * off));
    lats.push(<ellipse key={`la${i}`} cx={cx} cy={cy + off} rx={rx} ry={rx * 0.26} />);
  }
  const lons = [];
  for (let i = 0; i < lon; i++) {
    const rx = Math.abs(Math.cos((i / lon) * Math.PI)) * r;
    lons.push(<ellipse key={`lo${i}`} cx={cx} cy={cy} rx={rx} ry={r} />);
  }
  return (
    <g className="up-vx-globe" opacity={o}>
      <circle cx={cx} cy={cy} r={r} />
      {lats}
      {lons}
    </g>
  );
}

/** A ring that spins on its own clock, with its fixed tilt baked into the child. */
function Spin({
  dur,
  reverse,
  className,
  children,
}: {
  dur: number;
  reverse?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <g
      className={`up-vx-spin ${className ?? ''}`}
      style={{
        animationDuration: `${dur}s`,
        animationDirection: reverse ? 'reverse' : 'normal',
      }}
    >
      {children}
    </g>
  );
}

/**
 * The upload target: a layered energy vortex wrapped around a dark core.
 *
 * Drawn as SVG rather than WebGL. The art is a small number of deliberately
 * placed strokes — turbulent because the ellipses disagree with each other,
 * not because thousands of particles were averaged into a ring — and SVG keeps
 * every one addressable from CSS, so the stage's size is the only thing
 * setting the scale.
 *
 * Layers, back to front:
 *   0  starfield               STARS, drawn past the stage edges
 *   1  ambient glow            CSS radial gradients (.up-vx-amb)
 *   1b wireframe globes        GLOBES, dark bodies in the orbital system
 *   2  orbit paths             ORBITS, two behind the core
 *   3  blurred energy haze     HAZE, rotation only so the blur stays cached
 *   4  sharp energy streaks    STREAKS, dash offset animated
 *   5  particles               PARTICLES, two counter-rotating groups
 *   6  dark gravitational core over the streaks, so the energy wraps it
 *   7  front orbit path        the one that crosses the vortex
 *
 * All decoration: `pointer-events: none`, `aria-hidden`. The drop zone is a
 * plain DOM ellipse in UploadPage centred over this, so drag-and-drop, the
 * file picker and focus stay ordinary DOM behaviour.
 *
 * Every animation is CSS on transform, opacity or stroke-dashoffset. There is
 * no render loop, no WebGL context to lose and nothing to dispose.
 */
export function UploadVortex({ state }: { state: VortexState }) {
  return (
    <div className="up-vx" data-state={state} aria-hidden="true">
      <div className="up-vx-amb" />
      <div className="up-vx-amb up-vx-amb-2" />

      <svg className="up-vx-svg" viewBox="0 0 600 470" preserveAspectRatio="xMidYMid meet">
        <defs>
          {/* Green rim light falling through dark green to near-black, so the
              middle absorbs light rather than reading as a flat disc. */}
          <radialGradient id="up-core-g">
            <stop offset="0%" stopColor="#010304" />
            <stop offset="42%" stopColor="#030708" />
            <stop offset="74%" stopColor="#06100e" />
            <stop offset="92%" stopColor="#0a1a12" />
            <stop offset="100%" stopColor="#0e2716" />
          </radialGradient>
          {/* Over the core: clear until close to the edge, so only the rim
              picks up the surrounding energy. */}
          <radialGradient id="up-core-rim">
            <stop offset="0%" stopColor="rgba(137,233,0,0)" />
            <stop offset="76%" stopColor="rgba(137,233,0,0)" />
            <stop offset="93%" stopColor="rgba(137,233,0,0.18)" />
            <stop offset="100%" stopColor="rgba(198,255,130,0.4)" />
          </radialGradient>
        </defs>

        {/* 0 — starfield, furthest back */}
        <g className="up-vx-stars">
          {STARS.map((st, i) => (
            <circle
              key={i}
              cx={st.x}
              cy={st.y}
              r={st.r}
              opacity={st.o}
              style={{ animationDuration: `${st.dur}s`, animationDelay: `${st.delay}s` }}
            />
          ))}
        </g>

        {/* 1 — wireframe globes riding the orbital system */}
        {GLOBES.map((g, i) => (
          <Globe key={i} {...g} />
        ))}

        {/* 2 — orbits behind */}
        {ORBITS.slice(0, 2).map((o, i) => (
          <Spin key={i} dur={o.dur} className="up-vx-orbit">
            <ellipse
              cx={CX}
              cy={CY}
              rx={o.rx}
              ry={o.ry}
              opacity={o.o}
              transform={`rotate(${o.rot} ${CX} ${CY})`}
            />
            {o.nodes.map((t, n) => {
              const pt = onEllipse(o.rx, o.ry, t);
              return (
                <circle
                  key={n}
                  className="up-vx-node"
                  cx={pt.cx}
                  cy={pt.cy}
                  r={n === 0 ? 4.5 : 3}
                  transform={`rotate(${o.rot} ${CX} ${CY})`}
                />
              );
            })}
          </Spin>
        ))}

        {/* 3 — blurred haze */}
        <g className="up-vx-haze">
          {HAZE.map((h, i) => (
            <Spin key={i} dur={h.dur} reverse={i % 2 === 1}>
              <ellipse
                className="up-vx-haze-ring"
                cx={CX}
                cy={CY}
                rx={h.rx}
                ry={h.ry}
                strokeWidth={h.w}
                opacity={h.o}
                transform={`rotate(${h.rot} ${CX} ${CY})`}
              />
            </Spin>
          ))}
        </g>

        {/* 4 — sharp streaks */}
        <Spin dur={30} className="up-vx-streaks">
          {STREAKS.map((s, i) => (
            <ellipse
              key={i}
              className="up-vx-streak"
              cx={CX}
              cy={CY}
              rx={s.rx}
              ry={s.ry}
              pathLength={1000}
              strokeWidth={s.w}
              strokeDasharray={s.dash}
              opacity={s.o}
              transform={`rotate(${s.rot} ${CX} ${CY})`}
              style={{
                animationDuration: `${s.dur}s`,
                animationDelay: `${s.delay}s`,
                animationDirection: i % 3 === 1 ? 'reverse' : 'normal',
              }}
            />
          ))}
        </Spin>

        {/* 5 — particles */}
        <Spin dur={64} className="up-vx-dust">
          {PARTICLES.filter((p) => !p.fast).map((p, i) => (
            <circle
              key={i}
              cx={p.cx}
              cy={p.cy}
              r={p.r}
              opacity={p.o}
              style={{ animationDuration: `${p.dur}s`, animationDelay: `${p.delay}s` }}
            />
          ))}
        </Spin>
        <Spin dur={38} reverse className="up-vx-dust">
          {PARTICLES.filter((p) => p.fast).map((p, i) => (
            <circle
              key={i}
              cx={p.cx}
              cy={p.cy}
              r={p.r}
              opacity={p.o}
              style={{ animationDuration: `${p.dur}s`, animationDelay: `${p.delay}s` }}
            />
          ))}
        </Spin>

        {/* 6 — the core, over the streaks so the energy wraps it */}
        <ellipse
          className="up-vx-core"
          cx={CX}
          cy={CY}
          rx={CORE_RX}
          ry={CORE_RY}
          fill="url(#up-core-g)"
        />
        <ellipse
          className="up-vx-core-rim"
          cx={CX}
          cy={CY}
          rx={CORE_RX}
          ry={CORE_RY}
          fill="url(#up-core-rim)"
        />

        {/* 7 — the orbit that crosses in front */}
        <Spin dur={ORBITS[2].dur} className="up-vx-orbit up-vx-orbit-front">
          <ellipse
            cx={CX}
            cy={CY}
            rx={ORBITS[2].rx}
            ry={ORBITS[2].ry}
            opacity={ORBITS[2].o}
            transform={`rotate(${ORBITS[2].rot} ${CX} ${CY})`}
          />
          {ORBITS[2].nodes.map((t, n) => {
            const pt = onEllipse(ORBITS[2].rx, ORBITS[2].ry, t);
            return (
              <circle
                key={n}
                className="up-vx-node"
                cx={pt.cx}
                cy={pt.cy}
                r={n === 0 ? 5 : 3.2}
                transform={`rotate(${ORBITS[2].rot} ${CX} ${CY})`}
              />
            );
          })}
        </Spin>
      </svg>

      <span className="up-vx-chip up-vx-chip-1">
        <ChipIcon />
        MP4
      </span>
      <span className="up-vx-chip up-vx-chip-2">
        <ChipIcon />
        MOV
      </span>
      <span className="up-vx-chip up-vx-chip-3">
        <ChipIcon />
        WEBM
      </span>
    </div>
  );
}

function ChipIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="3" width="20" height="18" rx="2" />
      <path d="M7 3v18M17 3v18M2 9h5M2 15h5M17 9h5M17 15h5" />
    </svg>
  );
}
