/**
 * FramingEditor — "Adjust framing": the clip's whole source frame with a box
 * per region of the layout (Speaker A / Speaker B, or Gameplay / Facecam).
 * Drag a box to move it, a corner to resize it (a Fill box keeps its panel's
 * shape, so the box is exactly what the panel shows), or use the arrow keys.
 * Changes draw live (onDraft) and save once, on release (onCommit). The live
 * 9:16 result is the clip page's preview; on narrow screens a small copy is
 * shown here too, drawn by the same layout function.
 */
import { ArrowCounterClockwise, ArrowsDownUp } from '@phosphor-icons/react';
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import {
  MIN_REGION,
  clampRect,
  coverRatio,
  layoutRegions,
  normalizeFraming,
  panelAspect,
  regionFit,
  regionLabel,
  splitOf,
  type ClipFramingV1,
  type FramingRect,
  type RegionKey,
} from '../../lib/clips/framing';
import { drawLayout, hasBars, type LayoutContext } from '../../lib/clips/layout';
import type { SourceFrame } from '../../lib/clips/thumbs';

type Corner = 'nw' | 'ne' | 'sw' | 'se';
const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se'];
const PIP_MARGIN = 0.04;

interface Drag {
  key: RegionKey;
  mode: 'move' | Corner;
  px: number;
  py: number;
  rect: FramingRect;
  box: DOMRect;
}

/** Resize from a corner, the opposite corner fixed; `ratio` (normalised w/h) locks the shape. */
function resizeRect(r: FramingRect, corner: Corner, dx: number, dy: number, ratio: number | null): FramingRect {
  const sx = corner === 'ne' || corner === 'se' ? 1 : -1;
  const sy = corner === 'sw' || corner === 'se' ? 1 : -1;
  const ax = sx > 0 ? r.x : r.x + r.w;
  const ay = sy > 0 ? r.y : r.y + r.h;
  const maxW = sx > 0 ? 1 - ax : ax;
  const maxH = sy > 0 ? 1 - ay : ay;
  let w = Math.min(maxW, Math.max(MIN_REGION, r.w + sx * dx));
  let h = Math.min(maxH, Math.max(MIN_REGION, r.h + sy * dy));
  if (ratio) {
    // Follow whichever side moved more, then fit the shape inside the room there is.
    if (w / r.w > h / r.h) h = w / ratio;
    else w = h * ratio;
    if (w > maxW) {
      w = maxW;
      h = w / ratio;
    }
    if (h > maxH) {
      h = maxH;
      w = h * ratio;
    }
  }
  return { x: sx > 0 ? ax : ax - w, y: sy > 0 ? ay : ay - h, w, h };
}

/** Region size as a share of the largest box of its shape (0..1). */
function sizeOf(r: FramingRect): number {
  const ratio = r.w / r.h;
  const maxW = Math.min(1, ratio);
  return Math.min(1, r.w / maxW);
}

/** The region at size `s` (share of the largest box of its shape), same centre. */
function withSize(r: FramingRect, s: number): FramingRect {
  const ratio = r.w / r.h;
  const maxW = Math.min(1, ratio);
  const maxH = maxW / ratio;
  const w = Math.max(MIN_REGION, maxW * s);
  const h = Math.max(MIN_REGION, maxH * s);
  return clampRect({ x: r.x + r.w / 2 - w / 2, y: r.y + r.h / 2 - h / 2, w, h });
}

interface FramingEditorProps {
  framing: ClipFramingV1;
  srcW: number;
  srcH: number;
  /** Still frame for the source view when the video can't be drawn yet. */
  frame: SourceFrame | null;
  /** The clip's playing video (the preview's), drawn live into the source view. */
  videoRef?: RefObject<HTMLVideoElement | null>;
  /** Caption centre, 0..1 down the frame — the PiP box shouldn't cover it. */
  captionY?: number;
  disabled?: boolean;
  onDraft(f: ClipFramingV1): void;
  onCommit(f: ClipFramingV1): void;
  onReset(): void;
}

export function FramingEditor({ framing, srcW, srcH, frame, videoRef, captionY, disabled, onDraft, onCommit, onReset }: FramingEditorProps) {
  const keys = layoutRegions(framing.layout);
  const [active, setActive] = useState<RegionKey>(keys[0] ?? 'a');
  const current = keys.includes(active) ? active : (keys[0] ?? 'a');
  const boxRef = useRef<HTMLDivElement | null>(null);
  const sourceCanvas = useRef<HTMLCanvasElement | null>(null);
  const outputCanvas = useRef<HTMLCanvasElement | null>(null);
  const drag = useRef<Drag | null>(null);
  const latest = useRef(framing);
  latest.current = framing;
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    setImage(null);
    if (!frame) return;
    let live = true;
    const img = new Image();
    img.onload = () => live && setImage(img);
    img.src = frame.url;
    return () => {
      live = false;
    };
  }, [frame]);

  // Source view + small output: the live video when it can be drawn, else the still frame.
  useEffect(() => {
    let raf = 0;
    let last = '';
    const tick = () => {
      const v = videoRef?.current;
      const live = v && v.videoWidth && v.readyState >= 2 ? v : null;
      const src: CanvasImageSource | null = live ?? image;
      const sw = live ? live.videoWidth : (frame?.width ?? 0);
      const sh = live ? live.videoHeight : (frame?.height ?? 0);
      // Redraw on a new frame, layout or canvas size (the small output appears only on narrow screens).
      const sizes = `${sourceCanvas.current?.clientWidth ?? 0}/${outputCanvas.current?.clientWidth ?? 0}`;
      const key = `${live ? live.currentTime : 'still'}|${sw}x${sh}|${sizes}|${JSON.stringify(latest.current)}`;
      if (src && sw && sh && key !== last) {
        last = key;
        const sc = sourceCanvas.current;
        if (sc) {
          const w = Math.max(2, Math.round(sc.clientWidth * Math.min(2, window.devicePixelRatio || 1)));
          const h = Math.max(2, Math.round((w * sh) / sw));
          if (sc.width !== w || sc.height !== h) {
            sc.width = w;
            sc.height = h;
          }
          sc.getContext('2d')?.drawImage(src, 0, 0, w, h);
        }
        const oc = outputCanvas.current;
        if (oc && oc.clientWidth) {
          const W = Math.round(oc.clientWidth * Math.min(2, window.devicePixelRatio || 1));
          const H = Math.round((W * 16) / 9);
          if (oc.width !== W || oc.height !== H) {
            oc.width = W;
            oc.height = H;
          }
          const ctx = oc.getContext('2d');
          if (ctx) {
            drawLayout(ctx as unknown as LayoutContext, W, H, latest.current, sw, sh, (c, sx, sy, sW, sH, dx, dy, dW, dH) =>
              (c as unknown as CanvasRenderingContext2D).drawImage(src, sx, sy, sW, sH, dx, dy, dW, dH),
            );
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [videoRef, image, frame]);

  const ratioFor = (f: ClipFramingV1, key: RegionKey) =>
    regionFit(f, key) === 'cover' ? coverRatio(panelAspect(f, key), srcW, srcH) : null;
  const withRegion = (key: RegionKey, rect: FramingRect): ClipFramingV1 => ({ ...latest.current, [key]: rect });

  function startDrag(e: PointerEvent<HTMLElement>, key: RegionKey, mode: Drag['mode']) {
    if (disabled || !boxRef.current) return;
    const rect = latest.current[key];
    if (!rect) return;
    e.preventDefault();
    e.stopPropagation();
    setActive(key);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { key, mode, px: e.clientX, py: e.clientY, rect, box: boxRef.current.getBoundingClientRect() };
  }

  function moveDrag(e: PointerEvent<HTMLElement>) {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.px) / d.box.width;
    const dy = (e.clientY - d.py) / d.box.height;
    const next =
      d.mode === 'move'
        ? clampRect({ ...d.rect, x: d.rect.x + dx, y: d.rect.y + dy })
        : resizeRect(d.rect, d.mode, dx, dy, ratioFor(latest.current, d.key));
    onDraft(withRegion(d.key, next));
  }

  function endDrag() {
    if (!drag.current) return;
    drag.current = null;
    onCommit(latest.current);
  }

  function onKey(e: KeyboardEvent<HTMLElement>, key: RegionKey) {
    const r = latest.current[key];
    if (!r || disabled) return;
    const step = e.shiftKey ? 0.05 : 0.01;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    if (moves[e.key]) {
      e.preventDefault();
      const [dx, dy] = moves[e.key];
      onDraft(withRegion(key, clampRect({ ...r, x: r.x + dx, y: r.y + dy })));
    } else if (e.key === '+' || e.key === '=' || e.key === '-') {
      e.preventDefault();
      onDraft(withRegion(key, withSize(r, Math.min(1, Math.max(0.05, sizeOf(r) + (e.key === '-' ? -step : step) * 2)))));
    }
  }
  const commitKey = (e: KeyboardEvent<HTMLElement>) => {
    if (/^Arrow|^[+=-]$/.test(e.key)) onCommit(latest.current);
  };

  const f = framing;
  const activeRect = f[current];
  const fit = keys.length ? regionFit(f, current) : 'contain';
  const split = splitOf(f);
  const barsPossible = f.layout === 'full' || keys.some((k) => regionFit(f, k) === 'contain');
  const showBg = barsPossible && (f.layout === 'full' || hasBars(f, 1080, 1920, srcW, srcH));
  // The caption anchor is the centre of the caption block: allow about half a caption's height around it.
  const CAPTION_HALF = 0.08;
  const pipOverCaption =
    f.layout === 'pip' &&
    f.pip &&
    captionY !== undefined &&
    captionY > f.pip.y - CAPTION_HALF &&
    captionY < f.pip.y + f.pip.h + CAPTION_HALF;

  const setPip = (pip: FramingRect) => onCommit(normalizeFraming({ ...f, pip: clampRect(pip) }, srcW, srcH));
  const corner = (c: Corner): FramingRect => {
    const p = f.pip ?? { x: 0.56, y: 0.05, w: 0.38, h: 0.2 };
    return {
      ...p,
      x: c === 'nw' || c === 'sw' ? PIP_MARGIN : 1 - PIP_MARGIN - p.w,
      y: c === 'nw' || c === 'ne' ? PIP_MARGIN : 1 - PIP_MARGIN - p.h,
    };
  };

  return (
    <div className={`framing-editor${disabled ? ' is-disabled' : ''}`}>
      <div className="framing-views">
        <div
          ref={boxRef}
          className="framing-source"
          style={{ aspectRatio: `${srcW} / ${srcH}` }}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <canvas ref={sourceCanvas} className="framing-source-canvas" aria-hidden="true" />
          {keys.map((key) => {
            const r = f[key];
            if (!r) return null;
            const label = regionLabel(f.layout, key);
            return (
              <div
                key={key}
                className={`framing-box${key === current ? ' is-active' : ''}${key === 'b' ? ' is-b' : ''}`}
                style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }}
                role="group"
                tabIndex={disabled ? -1 : 0}
                aria-label={`${label} region. Arrow keys move it, plus and minus resize it.`}
                onPointerDown={(e) => startDrag(e, key, 'move')}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onFocus={() => setActive(key)}
                onKeyDown={(e) => onKey(e, key)}
                onKeyUp={commitKey}
              >
                <span className="framing-box-label">{label}</span>
                {CORNERS.map((c) => (
                  <span
                    key={c}
                    className={`framing-handle is-${c}`}
                    aria-hidden="true"
                    onPointerDown={(e) => startDrag(e, key, c)}
                    onPointerMove={moveDrag}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                  />
                ))}
              </div>
            );
          })}
        </div>
        <canvas ref={outputCanvas} className="framing-output" aria-label="9:16 result" role="img" />
      </div>

      <div className="framing-controls">
        {keys.length > 1 && (
          <div className="clip-seg framing-regions" role="radiogroup" aria-label="Region">
            {keys.map((key) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={key === current}
                className={`clip-seg-btn${key === current ? ' is-on' : ''}`}
                onClick={() => setActive(key)}
              >
                {regionLabel(f.layout, key)}
              </button>
            ))}
          </div>
        )}

        {activeRect && (
          <div className="framing-row">
            <span className="framing-label">{keys.length > 1 ? regionLabel(f.layout, current) : 'Region'}</span>
            <div className="clip-seg" role="radiogroup" aria-label="Fit">
              {(['cover', 'contain'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={fit === mode}
                  className={`clip-seg-btn${fit === mode ? ' is-on' : ''}`}
                  disabled={disabled}
                  title={mode === 'cover' ? 'Fill the panel (crops to its shape)' : 'Show the whole box (bars where it does not fill)'}
                  onClick={() =>
                    fit !== mode &&
                    onCommit(normalizeFraming({ ...f, [current === 'a' ? 'fitA' : 'fitB']: mode }, srcW, srcH))
                  }
                >
                  {mode === 'cover' ? 'Fill' : 'Fit'}
                </button>
              ))}
            </div>
            <RangeControl
              label="Zoom"
              min={0.1}
              max={1}
              step={0.01}
              // A smaller box is a closer view.
              value={1 - sizeOf(activeRect) + 0.1}
              disabled={disabled}
              onInput={(v) => onDraft(withRegion(current, withSize(activeRect, Math.max(0.05, 1.1 - v))))}
              onCommit={() => onCommit(latest.current)}
            />
          </div>
        )}

        {(f.layout === 'dual' || f.layout === 'stacked') && (
          <div className="framing-row">
            <RangeControl
              label="Top panel"
              min={0.2}
              max={0.8}
              step={0.01}
              value={split}
              format={(v) => `${Math.round(v * 100)}%`}
              disabled={disabled}
              onInput={(v) => onDraft(normalizeFraming({ ...latest.current, split: v }, srcW, srcH))}
              onCommit={() => onCommit(latest.current)}
            />
            <button
              type="button"
              className="framing-btn"
              disabled={disabled}
              onClick={() => onCommit(normalizeFraming({ ...f, swap: !f.swap }, srcW, srcH))}
            >
              <ArrowsDownUp size={15} aria-hidden="true" />
              Swap
            </button>
          </div>
        )}

        {f.layout === 'pip' && f.pip && (
          <div className="framing-row">
            <span className="framing-label">Facecam box</span>
            <div className="clip-seg framing-corners" role="group" aria-label="Facecam corner">
              {CORNERS.map((c) => {
                const target = corner(c);
                const on = Math.abs(target.x - f.pip!.x) < 0.005 && Math.abs(target.y - f.pip!.y) < 0.005;
                const name = { nw: 'Top left', ne: 'Top right', sw: 'Bottom left', se: 'Bottom right' }[c];
                return (
                  <button
                    key={c}
                    type="button"
                    className={`clip-seg-btn framing-corner is-${c}${on ? ' is-on' : ''}`}
                    aria-label={name}
                    aria-pressed={on}
                    title={name}
                    disabled={disabled}
                    onClick={() => setPip(target)}
                  >
                    <span aria-hidden="true" />
                  </button>
                );
              })}
            </div>
            <RangeControl
              label="Size"
              min={0.2}
              max={0.7}
              step={0.01}
              value={f.pip.w}
              disabled={disabled}
              onInput={(v) => {
                const p = latest.current.pip!;
                const h = (p.h / p.w) * v;
                const right = p.x + p.w / 2 > 0.5;
                const bottom = p.y + p.h / 2 > 0.5;
                const pip = clampRect({ w: v, h, x: right ? p.x + p.w - v : p.x, y: bottom ? p.y + p.h - h : p.y });
                onDraft(normalizeFraming({ ...latest.current, pip }, srcW, srcH));
              }}
              onCommit={() => onCommit(latest.current)}
            />
          </div>
        )}

        {showBg && (
          <div className="framing-row">
            <span className="framing-label">Background</span>
            <div className="clip-seg" role="radiogroup" aria-label="Background">
              {(['blur', 'black'] as const).map((bg) => {
                const on = (f.bg ?? 'black') === bg;
                return (
                  <button
                    key={bg}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    className={`clip-seg-btn${on ? ' is-on' : ''}`}
                    disabled={disabled}
                    onClick={() => !on && onCommit({ ...f, bg })}
                  >
                    {bg === 'blur' ? 'Blurred' : 'Black'}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {pipOverCaption && <p className="framing-note is-warn">The facecam box covers your captions — move it to another corner.</p>}
        {(f.layout === 'stacked' || f.layout === 'pip') && (
          <p className="framing-note">
            Drag the Facecam box onto your webcam. A webcam that is part of the game picture also stays in the Gameplay view —
            move the Gameplay box to leave it out.
          </p>
        )}

        <div className="framing-row framing-foot">
          <button type="button" className="framing-btn" disabled={disabled} onClick={onReset}>
            <ArrowCounterClockwise size={15} aria-hidden="true" />
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}

/** A labelled slider that follows the hand (onInput) and saves once on release (onCommit). */
function RangeControl({
  label,
  min,
  max,
  step,
  value,
  format,
  disabled,
  onInput,
  onCommit,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format?: (v: number) => string;
  disabled?: boolean;
  onInput(v: number): void;
  onCommit(): void;
}) {
  const dirty = useRef(false);
  const commit = () => {
    if (!dirty.current) return;
    dirty.current = false;
    onCommit();
  };
  return (
    <label className="framing-range">
      <span className="framing-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          dirty.current = true;
          onInput(Number(e.target.value));
        }}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      {format && <span className="framing-range-value">{format(value)}</span>}
    </label>
  );
}
