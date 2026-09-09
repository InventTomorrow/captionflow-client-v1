/**
 * KineticCaptionLayer.tsx — live preview for the Anime Edit template.
 *
 * One template, five internal looks (scatteredStack, neonDisappear,
 * letterChaos, impactSlam, glitchSplit) intercut per caption. The engine
 * decides which look each line gets; see lib/kinetic/engine.ts →
 * pickKineticLook, and KINETIC_TEMPLATES.md.
 *
 * This component owns no layout maths and no animation curves. All of that is
 * in lib/kinetic/engine.ts, which the export worker runs unchanged. What this
 * file owns is:
 *
 *   - gating the first draw on the real fonts being loaded
 *   - sizing the canvas for the display's pixel density
 *   - rebuilding the composition only when an input genuinely changed
 *   - a rAF loop that never touches React state
 *
 * Unlike the other templates, this draws on a canvas rather than DOM words,
 * because it positions every letter independently across the whole frame.
 * Consequences the editor has to live with, all deliberate:
 *   - no click-a-word-to-select and no per-word colour overrides — there are no
 *     word elements to click
 *   - style.fontFamily / fontSize / global position are ignored; faces are
 *     pinned per look (KINETIC_FONTS) and sizes come from the layout engine
 *
 * style.color and style.highlightColor ARE honoured, and a chunk CAN be dragged
 * to place it — that writes Caption.offsetX/offsetY, the same per-chunk
 * override the DOM templates use, so it persists and burns in identically.
 */

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';

import type { DisplayCaption } from '../lib/displayCaptions';
import type { KineticCaptionInput, KineticComposition } from '../lib/kinetic/engine';
import {
  KINETIC_BASE_FONT_SIZE,
  activeKineticScenes,
  buildKineticComposition,
  kineticSceneShift,
  renderKineticFrame,
} from '../lib/kinetic/engine';
import {
  MAX_KINETIC_RENDER_SCALE,
  loadKineticFonts,
  setupKineticCanvas,
  type KineticFontSet,
} from '../lib/kinetic/browser';

/** Same lead the DOM overlay uses, so kinetic captions land on the same beat. */
const LEAD = 0.09;

interface Props {
  captions: DisplayCaption[];
  videoRef: RefObject<HTMLVideoElement | null>;
  /** style.color — the plain letter colour. */
  color: string;
  /** style.highlightColor — the accent. */
  highlightColor: string;
  /** style.fontSize — interpreted relative to KINETIC_BASE_FONT_SIZE. */
  fontSize: number;
  /**
   * Persist a dragged chunk position. Same callback the DOM overlay uses, so a
   * kinetic caption's offsetX/offsetY travels the identical path to IndexedDB
   * and into the export payload.
   */
  onChunkStyleCommit?: (
    caption: DisplayCaption,
    patch: { sizeScale?: number; offsetX?: number; offsetY?: number },
    scope: 'chunk' | 'all',
  ) => void;
}

export default function KineticCaptionLayer({
  captions,
  videoRef,
  color,
  highlightColor,
  fontSize,
  onChunkStyleCommit,
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef(0);
  const compRef = useRef<KineticComposition | null>(null);

  const [fonts, setFonts] = useState<KineticFontSet | null>(null);
  const [renderScale, setRenderScale] = useState(1);
  const [frame, setFrame] = useState({ W: 1920, H: 1080 });

  /* -- 1. Font gate ------------------------------------------------------ *
   * Canvas will happily draw in a fallback face without telling you, and the
   * metrics cache would then be built from the wrong font. Nothing is measured
   * or drawn until every face the looks need is confirmed. */
  useEffect(() => {
    let cancelled = false;
    void loadKineticFonts().then((set) => {
      if (!cancelled) setFonts(set);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /* -- 2. Track the painted frame size ----------------------------------- *
   * Only the ASPECT of `frame` affects layout (the engine is normalised); the
   * pixel numbers just set the canvas resolution. */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    const update = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      const dpr = window.devicePixelRatio || 1;
      setFrame((prev) => (prev.W === w && prev.H === h ? prev : { W: w, H: h }));
      setRenderScale((prev) => {
        const next = Math.min(MAX_KINETIC_RENDER_SCALE, dpr);
        return Math.abs(prev - next) > 0.01 ? next : prev;
      });
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* -- 3. Build the composition ------------------------------------------ *
   * Keyed on content, not object identity: a fresh array literal from the
   * parent must not re-run the layout (that is what made the original
   * component re-randomise several times a second). */
  const captionsKey = useMemo(
    () =>
      captions
        .map(
          (c) =>
            `${c.sequence}:${c.start}:${c.end}:${c.text}:${(c.emphasis ?? []).join('')}` +
            `:${c.offsetX ?? ''}:${c.offsetY ?? ''}:${c.sizeScale ?? ''}`,
        )
        .join('|'),
    [captions],
  );

  useEffect(() => {
    if (!fonts) return;
    const input: KineticCaptionInput[] = captions.map((c, i) => ({
      sequence: c.sequence ?? i,
      start: c.start,
      end: c.end,
      text: c.text,
      emphasis: c.emphasis,
      offsetX: c.offsetX,
      offsetY: c.offsetY,
      sizeScale: c.sizeScale,
    }));

    try {
      compRef.current = buildKineticComposition({
        captions: input,
        accentColor: highlightColor || '#FFC43D',
        baseColor: color || '#FFFFFF',
        frame,
        metricsFor: fonts.metricsFor,
        fontFor: fonts.fontFor,
        fontScale: (fontSize || KINETIC_BASE_FONT_SIZE) / KINETIC_BASE_FONT_SIZE,
      });
    } catch (err) {
      console.error('[kinetic] build failed:', err);
      compRef.current = null;
    }
    // `captions` and `frame` are read but intentionally tracked by content /
    // aspect rather than identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fonts, captionsKey, color, highlightColor, fontSize, frame.W, frame.H]);

  /* -- 4. Draw loop ------------------------------------------------------ *
   * Reads video.currentTime directly every frame and never sets React state —
   * the same contract the DOM overlay's rAF loop keeps. */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !fonts) return;

    const ctx = setupKineticCanvas(canvas, frame, renderScale);

    const tick = () => {
      rafRef.current = requestAnimationFrame(tick);
      try {
        const comp = compRef.current;
        if (!comp) return;
        const t = (videoRef.current?.currentTime ?? 0) + LEAD;
        renderKineticFrame(ctx, comp, { timeSec: t });
      } catch {
        /* skip a bad frame rather than killing the loop */
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [fonts, frame, renderScale, videoRef]);

  /* -- 5. Drag a chunk to reposition it ---------------------------------- *
   * Whole-caption, not per-letter: the letters' relative arrangement IS the
   * look, so moving one alone would break it. Dragging writes the scene's
   * anchor directly (the engine applies it at draw time), so the seeded
   * scatter never re-runs under the cursor, and commits on release. */
  const dragRef = useRef<{
    scene: KineticComposition['scenes'][number];
    caption: DisplayCaption;
    grabX: number;
    grabY: number;
  } | null>(null);

  const sceneAt = (timeSec: number) => {
    const comp = compRef.current;
    if (!comp) return null;
    const active = activeKineticScenes(comp, timeSec);
    // Topmost = the newest caption, which is what the user sees and grabs.
    return active.length ? active[active.length - 1].scene : null;
  };

  const toNorm = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { nx: (e.clientX - r.left) / r.width, ny: (e.clientY - r.top) / r.height };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!onChunkStyleCommit) return;
    const t = (videoRef.current?.currentTime ?? 0) + LEAD;
    const scene = sceneAt(t);
    const caption = scene ? captions[scene.index] : null;
    if (!scene || !caption) return;

    const { nx, ny } = toNorm(e);
    // Grab offset from the caption's current centre, so it follows the cursor
    // from where it was picked up rather than snapping its centre under it.
    const curX = scene.anchorX ?? scene.centerX;
    const curY = scene.anchorY ?? scene.centerY;
    dragRef.current = { scene, caption, grabX: nx - curX, grabY: ny - curY };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.stopPropagation();
    e.preventDefault();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const { nx, ny } = toNorm(e);
    drag.scene.anchorX = nx - drag.grabX;
    drag.scene.anchorY = ny - drag.grabY;
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);

    // Persist the CLAMPED position, so what is stored is what is drawn.
    const shift = kineticSceneShift(drag.scene);
    const round = (v: number) => Math.round(v * 1000) / 10; // normalised -> %
    onChunkStyleCommit?.(
      drag.caption,
      {
        offsetX: round(drag.scene.centerX + shift.dx),
        offsetY: round(drag.scene.centerY + shift.dy),
      },
      'chunk',
    );
  };

  const missing = fonts?.statuses.filter((s) => !s.ok) ?? [];

  return (
    <div ref={wrapRef} className="kinetic-caption-layer">
      <canvas
        ref={canvasRef}
        className={`kinetic-caption-canvas${onChunkStyleCommit ? ' draggable' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      {missing.length > 0 && (
        <div className="kinetic-font-warning">
          {missing.map((s) => s.family).join(' and ')} did not load — the preview is drawing in a
          fallback face, so letter spacing will not match your export.
        </div>
      )}
    </div>
  );
}
