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

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { ChunkSizeToolbar, clampChunkScale } from './ChunkSizeToolbar';

import type { DisplayCaption } from '../lib/displayCaptions';
import type {
  KineticCaptionInput,
  KineticComposition,
  KineticParams,
  KineticTemplateId,
} from '../lib/kinetic/engine';
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
// The segmenter module (MediaPipe) is imported only once text behind person is on.
import type { PersonSegmenter } from '../lib/kinetic/segmenter';

/** Same lead the DOM overlay uses, so kinetic captions land on the same beat. */
const LEAD = 0.09;

interface Props {
  captions: DisplayCaption[];
  videoRef: RefObject<HTMLVideoElement | null>;
  /** style.template — which kinetic template's looks to draw. */
  template: KineticTemplateId;
  /** style.color — the plain letter colour. */
  color: string;
  /** style.highlightColor — the accent. */
  highlightColor: string;
  /** style.fontSize — interpreted relative to KINETIC_BASE_FONT_SIZE. */
  fontSize: number;
  /** style.kinetic — the Text panel's per-template knobs (Blockbuster). */
  params?: KineticParams;
  /**
   * style.behindPerson — cut the person out of the footage (MediaPipe, an
   * approximation of the export's matte) and draw them back over the captions.
   * Needs the <video> to be CORS-readable (crossOrigin="use-credentials").
   *
   * This is the project DEFAULT. Any caption may override it with its own
   * `behindPerson`, so the cut-out is gated per chunk, matching the `enable=`
   * windows the export builds (behindPersonRanges in export.service.ts).
   */
  behindPerson?: boolean;
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
  /** Delete the selected caption chunk (the Size bar's delete button). */
  onChunkDelete?: (caption: DisplayCaption) => void;
}

export default function KineticCaptionLayer({
  captions,
  videoRef,
  template,
  color,
  highlightColor,
  fontSize,
  params,
  behindPerson = false,
  onChunkStyleCommit,
  onChunkDelete,
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef(0);
  const compRef = useRef<KineticComposition | null>(null);

  const [fonts, setFonts] = useState<KineticFontSet | null>(null);
  const [renderScale, setRenderScale] = useState(1);
  const [frame, setFrame] = useState({ W: 1920, H: 1080 });

  /* -- 0. Person segmenter (text behind person) --------------------------- *
   * Loaded only once the toggle is on. Read through refs by the draw loop so
   * flipping the toggle never re-subscribes the rAF. */
  const [segmenter, setSegmenter] = useState<PersonSegmenter | null>(null);
  const [segmenterError, setSegmenterError] = useState<string | null>(null);
  const segmenterRef = useRef<PersonSegmenter | null>(null);
  const cutoutRef = useRef<HTMLCanvasElement | null>(null);

  // Any caption that resolves to "behind" means the effect is in use, even
  // when the project default is off — one opted-in chunk is enough to need
  // the segmenter loaded.
  const anyBehind = useMemo(
    () => captions.some((c) => (c.behindPerson ?? behindPerson) === true),
    [captions, behindPerson],
  );
  segmenterRef.current = anyBehind ? segmenter : null;

  /**
   * The windows where the speaker is drawn OVER the captions, mirroring the
   * export's `enable=` ranges. Padded the same way and for the same reason:
   * a chunk still fading out must not have the speaker pop in front of it.
   */
  const behindRangesRef = useRef<Array<[number, number]>>([]);
  behindRangesRef.current = useMemo(() => {
    const on = captions.filter((c) => (c.behindPerson ?? behindPerson) === true);
    if (on.length === captions.length && captions.length > 0) return [[-Infinity, Infinity]];
    return on.map((c) => [c.start - 0.25, c.end + 0.6] as [number, number]);
  }, [captions, behindPerson]);

  useEffect(() => {
    if (!anyBehind) return;
    let cancelled = false;
    setSegmenterError(null);
    void import('../lib/kinetic/segmenter')
      .then((m) => m.loadPersonSegmenter())
      .then((s) => {
        if (!cancelled) setSegmenter(s);
      })
      .catch((err) => {
        if (!cancelled) setSegmenterError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [anyBehind]);

  /* -- 1. Font gate ------------------------------------------------------ *
   * Canvas will happily draw in a fallback face without telling you, and the
   * metrics cache would then be built from the wrong font. Nothing is measured
   * or drawn until every face the looks need is confirmed. */
  useEffect(() => {
    let cancelled = false;
    setFonts(null);
    void loadKineticFonts(template).then((set) => {
      if (!cancelled) setFonts(set);
    });
    return () => {
      cancelled = true;
    };
  }, [template]);

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

  /* -- Selection: one chunk at a time, edited before it is saved ---------- *
   * Click a caption to select it (box, corner handles, Size bar). Size and a
   * drag are PENDING until "Apply to all chunks" / "Apply to this chunk";
   * Escape, clicking away or the caption ending discards them. */
  const [sel, setSel] = useState<number | null>(null);
  const [pendingScale, setPendingScale] = useState<number | null>(null);
  const [pendingPos, setPendingPos] = useState<{ offsetX: number; offsetY: number } | null>(null);
  /** Bumped when the selected scene's box moved (drag, rebuild), to re-render the box. */
  const [, setBoxTick] = useState(0);
  const selRef = useRef<number | null>(null);
  selRef.current = sel;
  const clearSelection = useCallback(() => {
    setSel(null);
    setPendingScale(null);
    setPendingPos(null);
  }, []);
  const editKey = sel == null ? '' : `${sel}:${pendingScale ?? ''}:${pendingPos?.offsetX ?? ''}:${pendingPos?.offsetY ?? ''}`;

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

  // Knobs are compared by value for the same reason as captions above.
  const paramsKey = JSON.stringify(params ?? {});

  useEffect(() => {
    // A font set belongs to one template; never lay out with another's faces.
    if (!fonts || fonts.template !== template) return;
    const input: KineticCaptionInput[] = captions.map((c, i) => {
      // The selected chunk is laid out with its unsaved size/position, so the
      // preview is exact while adjusting (the whole layout is rebuilt because
      // a look can depend on the captions before it).
      const edit = i === selRef.current;
      return {
        sequence: c.sequence ?? i,
        start: c.start,
        end: c.end,
        text: c.text,
        emphasis: c.emphasis,
        offsetX: edit && pendingPos ? pendingPos.offsetX : c.offsetX,
        offsetY: edit && pendingPos ? pendingPos.offsetY : c.offsetY,
        sizeScale: edit && pendingScale != null ? pendingScale : c.sizeScale,
      };
    });

    try {
      compRef.current = buildKineticComposition({
        template,
        captions: input,
        accentColor: highlightColor || '#FFC43D',
        baseColor: color || '#FFFFFF',
        frame,
        metricsFor: fonts.metricsFor,
        fontFor: fonts.fontFor,
        fontScale: (fontSize || KINETIC_BASE_FONT_SIZE) / KINETIC_BASE_FONT_SIZE,
        params,
      });
      if (import.meta.env.DEV) {
        // Compare with the server's "Kinetic frame source ready" log line:
        // equal per-face fingerprints prove both sides measured the same fonts.
        console.debug('[kinetic] fingerprints', template, compRef.current.fingerprints);
      }
      setBoxTick((n) => n + 1);
    } catch (err) {
      console.error('[kinetic] build failed:', err);
      compRef.current = null;
    }
    // `captions`, `params` and `frame` are read but intentionally tracked by
    // content / aspect rather than identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fonts, template, captionsKey, paramsKey, color, highlightColor, fontSize, frame.W, frame.H, editKey]);

  const clearSelectionRef = useRef(clearSelection);
  clearSelectionRef.current = clearSelection;

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
        const video = videoRef.current;
        const t = (video?.currentTime ?? 0) + LEAD;
        renderKineticFrame(ctx, comp, { timeSec: t });
        // The selected chunk left the screen: drop the selection and its unsaved change.
        if (selRef.current != null && !activeKineticScenes(comp, t).some((a) => a.scene.index === selRef.current)) {
          selRef.current = null;
          clearSelectionRef.current();
        }

        // Text behind person: the footage, kept only where the mask says
        // "person", drawn back on top of the captions. Same compositing the
        // export does with ffmpeg's alphamerge — only the mask's quality differs.
        const seg = segmenterRef.current;
        // Only inside this chunk's window — outside it the captions stay on
        // top, which is exactly what the export's `enable=` gate does.
        const behindNow =
          seg != null &&
          behindRangesRef.current.some(([a, b]) => t >= a && t <= b);
        if (seg && video && behindNow) {
          const mask = seg.maskFor(video);
          if (mask) {
            const cw = canvas.width;
            const ch = canvas.height;
            let cut = cutoutRef.current;
            if (!cut) {
              cut = document.createElement('canvas');
              cutoutRef.current = cut;
            }
            if (cut.width !== cw || cut.height !== ch) {
              cut.width = cw;
              cut.height = ch;
            }
            const cctx = cut.getContext('2d');
            if (cctx) {
              cctx.globalCompositeOperation = 'source-over';
              cctx.clearRect(0, 0, cw, ch);
              cctx.drawImage(video, 0, 0, cw, ch);
              cctx.globalCompositeOperation = 'destination-in';
              cctx.drawImage(mask, 0, 0, cw, ch);
              // The main context is scaled to frame units (setupKineticCanvas).
              (ctx as unknown as CanvasRenderingContext2D).drawImage(cut, 0, 0, frame.W, frame.H);
            }
          }
        }
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
    moved?: boolean;
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
    // Only a press on the caption itself picks it up (with a little slack).
    const b = sceneBox(scene);
    if (Math.abs(nx - b.cx) > b.hw + 0.03 || Math.abs(ny - b.cy) > b.hh + 0.03) {
      clearSelection();
      return;
    }
    if (sel !== scene.index) {
      setPendingScale(null);
      setPendingPos(null);
    }
    setSel(scene.index);
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
    drag.moved = true;
    setBoxTick((n) => n + 1);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);

    if (!drag.moved) return;
    // Keep the CLAMPED position, so what is saved is what is drawn. Saved only
    // when the user picks a scope in the Size bar.
    const shift = kineticSceneShift(drag.scene);
    const round = (v: number) => Math.round(v * 1000) / 10; // normalised -> %
    setPendingPos({ offsetX: round(drag.scene.centerX + shift.dx), offsetY: round(drag.scene.centerY + shift.dy) });
  };

  /** A scene's on-screen box (normalised), after its manual-position clamp. */
  function sceneBox(scene: KineticComposition['scenes'][number]) {
    const shift = kineticSceneShift(scene);
    return { cx: scene.centerX + shift.dx, cy: scene.centerY + shift.dy, hw: scene.halfW, hh: scene.halfH };
  }
  const selScene = sel != null ? compRef.current?.scenes.find((sc) => sc.index === sel) : undefined;
  const selCaption = sel != null ? captions[sel] : undefined;
  const box = selScene ? sceneBox(selScene) : null;

  useEffect(() => {
    if (sel == null) return;
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && e.target instanceof Node && wrapRef.current.contains(e.target)) return;
      clearSelection();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clearSelection();
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [sel, clearSelection]);

  // Corner handles: the size follows the pointer's distance from the box centre.
  const scaleRaf = useRef(0);
  const startResize = (e: React.PointerEvent) => {
    if (!box || !selCaption || !wrapRef.current) return;
    e.stopPropagation();
    e.preventDefault();
    const r = wrapRef.current.getBoundingClientRect();
    const cx = r.left + box.cx * r.width;
    const cy = r.top + box.cy * r.height;
    const startDist = Math.max(12, Math.hypot(e.clientX - cx, e.clientY - cy));
    const startScale = pendingScale ?? selCaption.sizeScale ?? 100;
    let next = startScale;
    const onMove = (ev: PointerEvent) => {
      next = clampChunkScale((startScale * Math.hypot(ev.clientX - cx, ev.clientY - cy)) / startDist);
      // At most one layout rebuild per frame while dragging.
      if (!scaleRaf.current) {
        scaleRaf.current = requestAnimationFrame(() => {
          scaleRaf.current = 0;
          setPendingScale(next);
        });
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setPendingScale(next);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
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
      {box && selCaption && onChunkStyleCommit && (
        <div
          className="kinetic-select-box"
          style={{
            left: `${(box.cx - box.hw) * 100}%`,
            top: `${(box.cy - box.hh) * 100}%`,
            width: `${box.hw * 200}%`,
            height: `${box.hh * 200}%`,
          }}
        >
          {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
            <span
              key={corner}
              className={`caption-resize caption-resize-${corner}`}
              title="Drag to resize the caption"
              onPointerDown={startResize}
            />
          ))}
          <ChunkSizeToolbar
            className={`kinetic-size-bar${box.cy - box.hh < 0.3 ? ' is-below' : ''}`}
            scale={pendingScale ?? selCaption.sizeScale ?? 100}
            pending={pendingScale != null || pendingPos != null}
            onScale={(v) => setPendingScale(v === (selCaption.sizeScale ?? 100) && !pendingPos ? null : v)}
            onApply={(scope) => {
              onChunkStyleCommit(
                selCaption,
                { ...(pendingScale != null ? { sizeScale: pendingScale } : {}), ...(pendingPos ?? {}) },
                scope,
              );
              setPendingScale(null);
              setPendingPos(null);
            }}
            onCancel={() => {
              setPendingScale(null);
              setPendingPos(null);
            }}
            onDelete={
              onChunkDelete
                ? () => {
                    onChunkDelete(selCaption);
                    clearSelection();
                  }
                : undefined
            }
          />
        </div>
      )}
      {missing.length > 0 && (
        <div className="kinetic-font-warning">
          {missing.map((s) => s.family).join(' and ')} did not load - the preview is drawing in a
          fallback face, so letter spacing will not match your export.
        </div>
      )}
      {anyBehind && !segmenter && !segmenterError && (
        <div className="kinetic-layer-note">Preparing preview mask…</div>
      )}
      {anyBehind && segmenterError && (
        <div className="kinetic-font-warning">
          Preview cut-out unavailable ({segmenterError}) - the export will still put the text
          behind the person.
        </div>
      )}
    </div>
  );
}
