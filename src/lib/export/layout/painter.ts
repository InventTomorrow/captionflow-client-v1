/**
 * export/layout/painter.ts — paint a compiled caption track (compile.tsx) at
 * export resolution, one video frame at a time.
 *
 * Each layer of a caption's layout is rasterised once into a sprite (text with
 * its shadows/strokes/gradients, boxes with theirs) at the final pixel size,
 * then per frame drawn with its group's animated transform and opacity. So the
 * expensive parts — blurred text shadows especially — cost once per caption,
 * not once per frame.
 *
 * Runs in the export worker (OffscreenCanvas only); type-checks under both the
 * DOM and WebWorker libs.
 */

import {
  IDENTITY,
  easing,
  evalKeyframes,
  evalVariant,
  motionTransform,
  multiply,
  transformMatrix,
  translate,
  variantRest,
  type Matrix,
  type MotionValues,
} from './anim';
import {
  OVERLAY_FADE,
  type BoxItem,
  type LayoutCaption,
  type LayoutLayer,
  type LayoutState,
  type LayoutTrack,
  type Paint,
  type Rect,
  type TextItem,
} from './types';

type Ctx2D = OffscreenCanvasRenderingContext2D;

interface Sprite {
  canvas: OffscreenCanvas;
  /** Placement in reference units. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutPainter {
  /** Draw the captions for `timeSec` over whatever is already on `ctx`. */
  draw(ctx: Ctx2D, timeSec: number): void;
}

/** Shadows are drawn from glyphs pushed this far off-canvas, offset back in. */
const OFFSET = 30000;
const MAX_SPRITE_EDGE = 8192;
const SPRITE_CACHE = 64;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Typewriter: characters revealed at `t` (same maths as CaptionOverlay.charsShownAt). */
function charsShownAt(lengths: number[], starts: number[], capEnd: number, t: number): number {
  let n = 0;
  for (let i = 0; i < lengths.length; i++) {
    const s = starts[i];
    const e = i + 1 < starts.length ? Math.max(starts[i + 1], s + 0.05) : Math.max(capEnd, s + 0.05);
    const len = lengths[i];
    if (t >= e) {
      n += len;
      continue;
    }
    if (t <= s) break;
    n += Math.min(len, Math.floor(((t - s) / (e - s)) * (len + 1)));
    break;
  }
  return n;
}

function setLetterSpacing(ctx: Ctx2D, value: number): boolean {
  const c = ctx as unknown as { letterSpacing?: string };
  if (typeof c.letterSpacing !== 'string') return value === 0;
  c.letterSpacing = `${value}px`;
  return true;
}

function roundRectPath(path: Path2D, x: number, y: number, w: number, h: number, radii: number[]) {
  const max = Math.min(w, h) / 2;
  const [tl, tr, br, bl] = radii.map((r) => Math.max(0, Math.min(r, max)));
  path.moveTo(x + tl, y);
  path.lineTo(x + w - tr, y);
  if (tr) path.arcTo(x + w, y, x + w, y + tr, tr);
  else path.lineTo(x + w, y);
  path.lineTo(x + w, y + h - br);
  if (br) path.arcTo(x + w, y + h, x + w - br, y + h, br);
  else path.lineTo(x + w, y + h);
  path.lineTo(x + bl, y + h);
  if (bl) path.arcTo(x, y + h, x, y + h - bl, bl);
  else path.lineTo(x, y + h);
  path.lineTo(x, y + tl);
  if (tl) path.arcTo(x, y, x + tl, y, tl);
  else path.lineTo(x, y);
  path.closePath();
}

export function createLayoutPainter(track: LayoutTrack, width: number, height: number): LayoutPainter {
  const k = width / track.refWidth;
  void height;
  const sprites = new Map<string, Sprite | null>();
  let filterSupported: boolean | null = null;

  const supportsFilter = (ctx: Ctx2D) => {
    if (filterSupported === null) filterSupported = typeof (ctx as unknown as { filter?: string }).filter === 'string';
    return filterSupported;
  };

  /* ---------------------------------------------------------- paint helpers */

  const makePaint = (ctx: Ctx2D, paint: Paint, map: (x: number, y: number) => [number, number], scale: number) => {
    if (paint.type === 'color') return paint.color;
    const { box, angle } = paint;
    const rad = (angle * Math.PI) / 180;
    const dx = Math.sin(rad);
    const dy = -Math.cos(rad);
    const len = Math.abs(box.w * dx) + Math.abs(box.h * dy);
    const [cx, cy] = map(box.x + box.w / 2, box.y + box.h / 2);
    const half = (len * scale) / 2;
    const g = ctx.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half);
    for (const s of paint.stops) g.addColorStop(clamp01(s.offset), s.color);
    return g;
  };

  const drawGlyphs = (
    ctx: Ctx2D,
    text: string,
    x: number,
    y: number,
    letterSpacing: number,
    mode: 'fill' | 'stroke',
  ) => {
    if (setLetterSpacing(ctx, letterSpacing)) {
      if (mode === 'fill') ctx.fillText(text, x, y);
      else ctx.strokeText(text, x, y);
      return;
    }
    let cx = x;
    for (const ch of text) {
      if (mode === 'fill') ctx.fillText(ch, cx, y);
      else ctx.strokeText(ch, cx, y);
      cx += ctx.measureText(ch).width + letterSpacing;
    }
  };

  const drawText = (
    ctx: Ctx2D,
    item: TextItem,
    map: (x: number, y: number) => [number, number],
    scale: number,
    text: string,
  ) => {
    if (!text) return;
    const [x, y] = map(item.x, item.y);
    const ls = item.letterSpacing * scale;
    ctx.save();
    ctx.font = `${item.fontStyle} ${item.fontWeight} ${item.fontSize * scale}px ${item.fontFamily}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'miter';
    ctx.miterLimit = 4;

    const shadowPasses = [...item.shadows].reverse();
    // filter: drop-shadow's third value is a standard deviation; canvas and
    // text-shadow blur values are twice that.
    if (item.dropShadow) shadowPasses.unshift({ ...item.dropShadow, blur: item.dropShadow.blur * 2 });
    for (const sh of shadowPasses) {
      ctx.save();
      ctx.shadowColor = sh.color;
      ctx.shadowBlur = sh.blur * scale;
      ctx.shadowOffsetX = sh.x * scale + OFFSET;
      ctx.shadowOffsetY = sh.y * scale;
      ctx.fillStyle = '#000';
      drawGlyphs(ctx, text, x - OFFSET, y, ls, 'fill');
      if (item.stroke) {
        ctx.strokeStyle = '#000';
        ctx.lineWidth = item.stroke.width * scale;
        drawGlyphs(ctx, text, x - OFFSET, y, ls, 'stroke');
      }
      ctx.restore();
    }

    if (item.decoration) {
      const d = item.decoration;
      const thickness = (d.thickness || Math.max(1, item.fontSize / 14)) * scale;
      const offset = (d.offset ?? item.fontSize * 0.1) * scale;
      const lineY = y + offset + thickness / 2;
      const w = (item.width - item.letterSpacing) * scale;
      ctx.save();
      ctx.strokeStyle = d.color;
      ctx.lineWidth = thickness;
      ctx.beginPath();
      if (d.style === 'wavy') {
        // Chrome hangs the wave below the underline position: its crest sits
        // where a solid line would be.
        const wave = thickness * 5.2;
        const amp = thickness * 1.5;
        const waveY = lineY + amp;
        ctx.moveTo(x, waveY);
        for (let px = 0; px < w; px += wave / 2) {
          const dir = Math.round(px / (wave / 2)) % 2 === 0 ? -1 : 1;
          ctx.quadraticCurveTo(x + px + wave / 4, waveY + dir * amp * 2, x + Math.min(w, px + wave / 2), waveY);
        }
      } else {
        ctx.moveTo(x, lineY);
        ctx.lineTo(x + w, lineY);
      }
      ctx.stroke();
      ctx.restore();
    }

    const fillPaint = makePaint(ctx, item.fill, map, scale);
    const drawFill = () => {
      if (item.fill.type === 'color' && /,\s*0\)$/.test(item.fill.color)) return;
      ctx.fillStyle = fillPaint;
      drawGlyphs(ctx, text, x, y, ls, 'fill');
    };
    const drawStroke = () => {
      if (!item.stroke) return;
      ctx.strokeStyle = item.stroke.color;
      ctx.lineWidth = item.stroke.width * scale;
      drawGlyphs(ctx, text, x, y, ls, 'stroke');
    };
    if (item.stroke?.first) {
      drawStroke();
      drawFill();
    } else {
      drawFill();
      drawStroke();
    }
    ctx.restore();
  };

  const drawBox = (ctx: Ctx2D, item: BoxItem, map: (x: number, y: number) => [number, number], scale: number) => {
    const [x, y] = map(item.rect.x, item.rect.y);
    const w = item.rect.w * scale;
    const h = item.rect.h * scale;
    const radii = item.radii.map((r) => r * scale);
    const path = new Path2D();
    roundRectPath(path, x, y, w, h, radii);

    for (const sh of [...(item.shadows ?? [])].reverse()) {
      // box-shadow only paints OUTSIDE the border box, even under a
      // translucent fill.
      ctx.save();
      const outside = new Path2D();
      outside.rect(-OFFSET, -OFFSET, OFFSET * 3, OFFSET * 3);
      outside.addPath(path);
      ctx.clip(outside, 'evenodd');
      ctx.shadowColor = sh.color;
      ctx.shadowBlur = sh.blur * scale;
      ctx.shadowOffsetX = sh.x * scale + OFFSET;
      ctx.shadowOffsetY = sh.y * scale;
      ctx.translate(-OFFSET, 0);
      ctx.fillStyle = '#000';
      ctx.fill(path);
      ctx.restore();
    }
    if (item.fill) {
      ctx.fillStyle = makePaint(ctx, item.fill, map, scale);
      ctx.fill(path);
    }
    if (item.border) {
      const bw = item.border.width * scale;
      const inner = new Path2D();
      roundRectPath(inner, x + bw / 2, y + bw / 2, w - bw, h - bw, radii.map((r) => Math.max(0, r - bw / 2)));
      ctx.strokeStyle = item.border.color;
      ctx.lineWidth = bw;
      ctx.stroke(inner);
    }
  };

  const itemBounds = (item: TextItem | BoxItem): Rect => {
    if (item.type === 'box') {
      let ext = item.border?.width ?? 0;
      for (const s of item.shadows ?? []) ext = Math.max(ext, Math.max(Math.abs(s.x), Math.abs(s.y)) + s.blur * 1.5);
      return { x: item.rect.x - ext, y: item.rect.y - ext, w: item.rect.w + ext * 2, h: item.rect.h + ext * 2 };
    }
    let ext = item.stroke ? item.stroke.width : 0;
    for (const s of item.shadows) ext = Math.max(ext, Math.max(Math.abs(s.x), Math.abs(s.y)) + s.blur * 1.5);
    if (item.dropShadow) {
      const d = item.dropShadow;
      ext = Math.max(ext, Math.max(Math.abs(d.x), Math.abs(d.y)) + d.blur * 3);
    }
    const fs = item.fontSize;
    return {
      x: item.x - ext - fs * 0.25,
      y: item.y - item.ascent - ext - fs * 0.15,
      w: item.width + ext * 2 + fs * 0.6,
      h: item.ascent + item.descent + ext * 2 + fs * (item.decoration ? 0.6 : 0.3),
    };
  };

  const buildSprite = (layer: LayoutLayer, textFor: (item: TextItem) => string): Sprite | null => {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let drawable = 0;
    for (const item of layer.items) {
      if (item.type === 'text' && !textFor(item)) continue;
      drawable++;
      const b = itemBounds(item);
      x0 = Math.min(x0, b.x);
      y0 = Math.min(y0, b.y);
      x1 = Math.max(x1, b.x + b.w);
      y1 = Math.max(y1, b.y + b.h);
    }
    if (!drawable || !(x1 > x0) || !(y1 > y0)) return null;
    const w = x1 - x0;
    const h = y1 - y0;
    const scale = Math.min(k, MAX_SPRITE_EDGE / w, MAX_SPRITE_EDGE / h);
    const canvas = new OffscreenCanvas(Math.max(1, Math.ceil(w * scale)), Math.max(1, Math.ceil(h * scale)));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const map = (x: number, y: number): [number, number] => [(x - x0) * scale, (y - y0) * scale];
    for (const item of layer.items) {
      if (item.type === 'box') drawBox(ctx, item, map, scale);
      else drawText(ctx, item, map, scale, textFor(item));
    }
    return { canvas, x: x0, y: y0, w: canvas.width / scale, h: canvas.height / scale };
  };

  /* ------------------------------------------------------------- timeline */

  const captions = track.captions;

  const captionAt = (t: number): number => {
    let lo = 0;
    let hi = captions.length - 1;
    let best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (captions[mid].start <= t) {
        best = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (best < 0) return -1;
    const c = captions[best];
    if (t < c.end) return best;
    if (c.fadeOut && t < c.end + OVERLAY_FADE) return best;
    return -1;
  };

  const stateAt = (c: LayoutCaption, t: number) => {
    let i = 0;
    while (i + 1 < c.stateTimes.length && c.stateTimes[i + 1] <= t) i++;
    return i;
  };

  const ROLL_FROM = { opacity: 0, y: 12 };
  const ROLL_TO = { opacity: 0.45, y: 0, transition: { duration: 0.18, ease: 'easeOut' } };
  const FADE_FROM = { opacity: 0 };
  const FADE_TO = { opacity: 1, transition: { duration: OVERLAY_FADE, ease: 'easeOut' } };
  const exitEase = easing('easeOut');

  const evalGroups = (c: LayoutCaption, state: LayoutState, t: number) => {
    const n = state.groups.length;
    const mats: Matrix[] = new Array(n);
    const alphas: number[] = new Array(n);
    const blurs: number[] = new Array(n);
    const elapsed = t - c.start;
    for (let i = 0; i < n; i++) {
      const g = state.groups[i];
      let opacity = g.opacity;
      let fns: ReturnType<typeof motionTransform> = [];
      let blur = 0;
      const m = g.motion;
      const applyMotion = (mv: MotionValues) => {
        opacity = mv.opacity;
        fns = motionTransform(mv);
      };
      switch (m.kind) {
        case 'overlay': {
          opacity = c.fadeIn ? evalVariant(FADE_FROM, FADE_TO, elapsed).opacity : 1;
          if (c.fadeOut && t >= c.end) opacity *= 1 - exitEase(clamp01((t - c.end) / OVERLAY_FADE));
          break;
        }
        case 'block':
          applyMotion(evalVariant(track.blockVariants.hidden, track.blockVariants.enter, elapsed));
          break;
        case 'word': {
          const reveal = c.reveal?.[m.wordIndex];
          const { hidden, shown } = track.wordVariants;
          if (reveal == null) applyMotion(variantRest(shown));
          else if (t < reveal) applyMotion(variantRest(hidden));
          else applyMotion(evalVariant(hidden, shown, t - reveal));
          break;
        }
        case 'rollPrev':
          applyMotion(evalVariant(ROLL_FROM, ROLL_TO, elapsed));
          break;
        case 'css': {
          const v = evalKeyframes(track.keyframes[m.name] ?? [], elapsed, m, g.opacity);
          opacity = v.opacity;
          fns = v.transform;
          blur = v.blur;
          break;
        }
        default:
          break;
      }
      let local: Matrix = IDENTITY;
      if (g.transformable && fns.length) {
        local = multiply(
          multiply(translate(g.originX, g.originY), transformMatrix(fns, g.box.w, g.box.h)),
          translate(-g.originX, -g.originY),
        );
      }
      const parentM = g.parent >= 0 ? mats[g.parent] : IDENTITY;
      mats[i] = g.parent >= 0 ? multiply(parentM, local) : local;
      alphas[i] = (g.parent >= 0 ? alphas[g.parent] : 1) * opacity;
      blurs[i] = (g.parent >= 0 ? blurs[g.parent] : 0) + blur;
    }
    return { mats, alphas, blurs };
  };

  const remember = (key: string, sprite: Sprite | null) => {
    sprites.set(key, sprite);
    if (sprites.size > SPRITE_CACHE) {
      const first = sprites.keys().next().value;
      if (first !== undefined) sprites.delete(first);
    }
  };

  return {
    draw(ctx, t) {
      const ci = captionAt(t);
      if (ci < 0) return;
      const c = captions[ci];
      const si = stateAt(c, t);
      const state = c.states[si];
      if (!state) return;
      const { mats, alphas, blurs } = evalGroups(c, state, t);

      // Typewriter: characters shown per word right now.
      let shownPerWord: number[] | null = null;
      if (c.typewriter) {
        const total = charsShownAt(c.typewriter.lengths, c.typewriter.starts, c.typewriter.end, t);
        let acc = 0;
        shownPerWord = c.typewriter.lengths.map((len) => {
          const shown = Math.max(0, Math.min(len, total - acc));
          acc += len;
          return shown;
        });
      }
      const textFor = (item: TextItem) => {
        if (!shownPerWord || item.wordIndex === undefined) return item.text;
        const visible = (shownPerWord[item.wordIndex] ?? item.text.length) - (item.charOffset ?? 0);
        return visible <= 0 ? '' : item.text.slice(0, visible);
      };

      ctx.save();
      state.layers.forEach((layer, li) => {
        const alpha = alphas[layer.group];
        if (!(alpha > 0.003)) return;
        const M = mats[layer.group];
        const first = layer.items[0];

        if (layer.items.length === 1 && first.type === 'box' && first.backdropBlur) {
          if (!supportsFilter(ctx)) return;
          const [a, b, cc, d, e, f] = M;
          const corners = [
            [first.rect.x, first.rect.y],
            [first.rect.x + first.rect.w, first.rect.y],
            [first.rect.x, first.rect.y + first.rect.h],
            [first.rect.x + first.rect.w, first.rect.y + first.rect.h],
          ].map(([x, y]) => [k * (a * x + cc * y + e), k * (b * x + d * y + f)]);
          const xs = corners.map((p) => p[0]);
          const ys = corners.map((p) => p[1]);
          const bx = Math.min(...xs);
          const by = Math.min(...ys);
          const path = new Path2D();
          roundRectPath(path, bx, by, Math.max(...xs) - bx, Math.max(...ys) - by, first.radii.map((r) => r * k));
          ctx.save();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clip(path);
          (ctx as unknown as { filter: string }).filter = `blur(${first.backdropBlur * k}px)`;
          ctx.globalAlpha = Math.min(1, alpha);
          ctx.drawImage(ctx.canvas, 0, 0);
          ctx.restore();
          return;
        }

        let twKey = '';
        if (shownPerWord) {
          for (const item of layer.items) {
            if (item.type === 'text' && item.wordIndex !== undefined) twKey += `${shownPerWord[item.wordIndex]},`;
          }
        }
        const key = `${ci}|${si}|${li}|${twKey}`;
        let sprite = sprites.get(key);
        if (sprite === undefined) {
          sprite = buildSprite(layer, textFor);
          remember(key, sprite);
        }
        if (!sprite) return;

        ctx.setTransform(k * M[0], k * M[1], k * M[2], k * M[3], k * M[4], k * M[5]);
        ctx.globalAlpha = Math.min(1, alpha);
        const blur = blurs[layer.group];
        const useBlur = blur > 0.05 && supportsFilter(ctx);
        if (useBlur) (ctx as unknown as { filter: string }).filter = `blur(${blur * k}px)`;
        ctx.drawImage(sprite.canvas, sprite.x, sprite.y, sprite.w, sprite.h);
        if (useBlur) (ctx as unknown as { filter: string }).filter = 'none';
      });
      ctx.restore();
    },
  };
}
