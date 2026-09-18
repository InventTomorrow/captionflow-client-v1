/**
 * export/layout/compile.tsx — measure the live preview's caption layout.
 *
 * Renders each display caption through the editor's own <CaptionWords>
 * (components/CaptionOverlay.tsx) inside the same `.caption-overlay` shell,
 * off-screen, at a reference frame size, and records what the browser laid
 * out: text runs with their baselines and computed paint, boxes, and the
 * animated groups they belong to. The export worker then paints that
 * (painter.ts) — so line breaks, spacing, boxes and fonts are the preview's,
 * not an approximation of it.
 *
 * Main thread only (needs the DOM and index.css).
 *
 * Two style passes per caption state:
 *   A. as rendered — read each element's CSS animation (name/duration/delay…)
 *   B. `.cf-layout-static` — animations, transitions and descendant transforms
 *      switched off, so every rect is the element's resting, untransformed box.
 */

import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { Variants } from 'framer-motion';
import type { Caption } from '../../../stores/captionStore';
import {
  CaptionWords,
  countShown,
  makeBlockVariants,
  makeWordVariants,
  wordBehavior,
  wordTimings,
  type CaptionTemplate,
} from '../../../components/CaptionOverlay';
import { resolveCaptionAnchor } from '../../captionPosition';
import { deriveDisplayCaptions, type DisplayCaption, type DisplayMode } from '../../displayCaptions';
import {
  colorAlpha,
  normalizeColor,
  parseBlurFilter,
  parseDropShadow,
  parseLinearGradient,
  parseShadows,
  px,
} from './cssValues';
import {
  REF_LONG_EDGE,
  type BoxItem,
  type GroupMotion,
  type KeyframeStop,
  type LayoutCaption,
  type LayoutGroup,
  type LayoutLayer,
  type LayoutState,
  type LayoutTrack,
  type Rect,
  type Shadow,
  type TextItem,
  type VariantValues,
} from './types';

/** The style fields the preview overlay reads (a subset of the editor's StyleState). */
export interface LayoutStyle {
  template: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  color: string;
  backgroundColor: string;
  highlightColor: string;
  activeFill?: string;
  textTransform?: string;
  position: string;
  offsetX: number | null;
  offsetY: number | null;
  animation: string;
  displayMode: DisplayMode;
  displayWords: number;
}

export interface CompileOptions {
  captions: Caption[];
  style: LayoutStyle;
  /** Export frame size — only its aspect ratio matters here. */
  width: number;
  height: number;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

const noop = () => {};

function hasBackgroundBox(bg: string | undefined): boolean {
  // Same test as CaptionOverlay's `hasBox`.
  return !!bg && bg !== 'transparent' && !/rgba?\([^)]*,\s*0\s*\)/i.test(bg);
}

/** The `.caption-overlay` shell exactly as CaptionOverlay renders it (minus editor chrome). */
function MeasureOverlay({
  caption,
  prev,
  style,
  refHeight,
  visibleCount,
  variants,
}: {
  caption: DisplayCaption;
  prev?: DisplayCaption;
  style: LayoutStyle;
  refHeight: number;
  visibleCount: number;
  variants: Variants;
}) {
  const hasBox = hasBackgroundBox(style.backgroundColor);
  const anchor = resolveCaptionAnchor({
    position: style.position,
    offsetX: caption.offsetX ?? style.offsetX,
    offsetY: caption.offsetY ?? style.offsetY,
  });
  const fontPx = Math.max(9, (style.fontSize * ((caption.sizeScale ?? 100) / 100) * refHeight) / 1080);
  return (
    <div
      className={`caption-overlay draggable tpl-${style.template} mode-${style.displayMode}`}
      style={{
        fontFamily: style.fontFamily,
        fontSize: `${fontPx}px`,
        fontWeight: style.fontWeight,
        color: style.color,
        textTransform:
          style.textTransform && style.textTransform !== 'none'
            ? (style.textTransform as 'uppercase' | 'lowercase')
            : undefined,
        ['--cap-hl' as string]: style.highlightColor || '#FFC43D',
        ['--cap-active-fill' as string]:
          style.activeFill && style.activeFill !== 'transparent' ? style.activeFill : 'transparent',
        padding: hasBox ? 0 : undefined,
        borderRadius: hasBox ? 16 : undefined,
        top: `${anchor.offsetY}%`,
        left: `${anchor.offsetX}%`,
        bottom: 'auto',
        right: 'auto',
        transform: 'translate(-50%, -50%)',
      }}
    >
      <div
        className="cap-box"
        style={
          hasBox
            ? {
                display: 'inline-table',
                position: 'relative',
                background: style.backgroundColor,
                borderRadius: 16,
                padding: '0.45em 0.85em',
              }
            : { display: 'contents' }
        }
      >
        <div data-cf="fade">
          {prev && (
            <div className="cap-roll-prev" data-cf="roll">
              {prev.text}
            </div>
          )}
          <div className="cap-block">
            <CaptionWords
              caption={caption}
              template={style.template as CaptionTemplate}
              behavior={wordBehavior(style.displayMode)}
              visibleCount={visibleCount}
              charsShown={null}
              variants={variants}
              selectedWord={null}
              onWordClick={noop}
              onWordDelete={noop}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- style helpers */

function seconds(value: string): number {
  const first = value.split(',')[0].trim();
  if (first.endsWith('ms')) return parseFloat(first) / 1000;
  return parseFloat(first) || 0;
}

function variantValues(v: unknown): VariantValues {
  const o = (v ?? {}) as Record<string, unknown>;
  const out: VariantValues = {};
  if (typeof o.opacity === 'number') out.opacity = o.opacity;
  if (typeof o.y === 'number') out.y = o.y;
  if (typeof o.scale === 'number' || Array.isArray(o.scale)) out.scale = o.scale as number | number[];
  const tr = o.transition as Record<string, unknown> | undefined;
  if (tr) {
    out.transition = {
      duration: typeof tr.duration === 'number' ? tr.duration : 0.3,
      ease: typeof tr.ease === 'string' ? tr.ease : 'easeOut',
      ...(Array.isArray(tr.times) ? { times: tr.times as number[] } : {}),
    };
  }
  return out;
}

function collectKeyframes(names: Set<string>): Record<string, KeyframeStop[]> {
  const out: Record<string, KeyframeStop[]> = {};
  const visit = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSKeyframesRule) {
        if (!names.has(rule.name) || out[rule.name]) continue;
        const stops: KeyframeStop[] = [];
        for (const kf of Array.from(rule.cssRules) as CSSKeyframeRule[]) {
          const st = kf.style;
          const base: Omit<KeyframeStop, 'offset'> = {};
          const opacity = st.getPropertyValue('opacity');
          if (opacity) base.opacity = Number(opacity);
          const transform = st.getPropertyValue('transform');
          if (transform) base.transform = transform;
          const filter = st.getPropertyValue('filter');
          if (filter) base.filter = filter;
          const easing = st.getPropertyValue('animation-timing-function');
          if (easing) base.easing = easing;
          for (const key of kf.keyText.split(',')) {
            const k = key.trim();
            const offset = k === 'from' ? 0 : k === 'to' ? 1 : parseFloat(k) / 100;
            stops.push({ offset, ...base });
          }
        }
        out[rule.name] = stops.sort((a, b) => a.offset - b.offset);
      } else if ('cssRules' in rule) {
        try {
          visit((rule as CSSGroupingRule).cssRules);
        } catch {
          /* cross-origin */
        }
      }
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      visit(sheet.cssRules);
    } catch {
      /* cross-origin stylesheet (Google Fonts) — no keyframes there */
    }
  }
  return out;
}

interface CssAnim {
  name: string;
  duration: number;
  delay: number;
  easing: string;
  fill: string;
}

/* ----------------------------------------------------------------- compiler */

export async function compileLayoutTrack(opts: CompileOptions): Promise<LayoutTrack> {
  const { style } = opts;
  const long = Math.max(opts.width, opts.height);
  const scale = REF_LONG_EDGE / long;
  const refWidth = opts.width * scale;
  const refHeight = opts.height * scale;

  const display = deriveDisplayCaptions(opts.captions, style.displayMode, style.displayWords);
  const behavior = wordBehavior(style.displayMode);
  const wordVariantsRaw = makeWordVariants(style.animation);
  const blockVariantsRaw = makeBlockVariants(style.animation);

  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText =
    `position:fixed;left:-${Math.ceil(refWidth) + 20000}px;top:0;width:${refWidth}px;height:${refHeight}px;` +
    'overflow:hidden;pointer-events:none;';
  const mount = document.createElement('div');
  mount.style.cssText = 'position:absolute;inset:0;';
  host.appendChild(mount);
  const staticRule = document.createElement('style');
  staticRule.textContent =
    '.cf-layout-static .caption-overlay * { animation: none !important; transition: none !important; transform: none !important; }';
  document.head.appendChild(staticRule);
  document.body.appendChild(host);
  const root = createRoot(mount);

  const measureCanvas = document.createElement('canvas').getContext('2d');
  const metricsCache = new Map<string, { baseline: number; ascent: number; descent: number }>();
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;left:0;top:0;white-space:nowrap;line-height:normal;visibility:hidden;';
  host.appendChild(probe);

  const fontUses = new Map<string, { fontStyle: string; fontWeight: string; fontFamily: string; chars: Set<string> }>();
  const animationNames = new Set<string>();

  const fontMetrics = (cs: CSSStyleDeclaration) => {
    const key = `${cs.fontStyle}|${cs.fontWeight}|${cs.fontSize}|${cs.fontFamily}`;
    const hit = metricsCache.get(key);
    if (hit) return hit;
    probe.style.fontStyle = cs.fontStyle;
    probe.style.fontWeight = cs.fontWeight;
    probe.style.fontSize = cs.fontSize;
    probe.style.fontFamily = cs.fontFamily;
    probe.textContent = '';
    const text = document.createTextNode('Hxgé');
    const marker = document.createElement('span');
    marker.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline;';
    probe.append(text, marker);
    const range = document.createRange();
    range.selectNodeContents(text);
    const textTop = range.getBoundingClientRect().top;
    const baseline = marker.getBoundingClientRect().top - textTop;
    let ascent = baseline;
    let descent = px(cs.fontSize) * 0.25;
    if (measureCanvas) {
      measureCanvas.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const m = measureCanvas.measureText('Hxgé');
      ascent = m.fontBoundingBoxAscent || m.actualBoundingBoxAscent || ascent;
      descent = m.fontBoundingBoxDescent || m.actualBoundingBoxDescent || descent;
    }
    const out = { baseline, ascent, descent };
    metricsCache.set(key, out);
    return out;
  };

  // Characters already requested per font. document.fonts.check() can't be
  // trusted here: Chrome answers true while a stylesheet's matching faces are
  // still unloaded, which laid captions out in a fallback face.
  const requested = new Map<string, Set<string>>();
  const ensureFonts = async (overlay: Element) => {
    const pending: Array<Promise<unknown>> = [];
    const walker = document.createTreeWalker(overlay, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = (n as Text).data.trim();
      const parent = (n as Text).parentElement;
      if (!text || !parent) continue;
      const cs = getComputedStyle(parent);
      const font = `${cs.fontStyle} ${cs.fontWeight} 16px ${cs.fontFamily}`;
      const variants =
        cs.textTransform === 'uppercase' ? text.toUpperCase() : cs.textTransform === 'lowercase' ? text.toLowerCase() : text;
      let chars = requested.get(font);
      if (!chars) {
        chars = new Set();
        requested.set(font, chars);
      }
      let fresh = '';
      for (const ch of text + variants) {
        if (!chars.has(ch)) {
          chars.add(ch);
          fresh += ch;
        }
      }
      if (fresh) pending.push(document.fonts.load(font, fresh).catch(() => null));
    }
    if (pending.length) {
      await Promise.all(pending);
      metricsCache.clear();
    }
  };

  const measureState = (overlay: HTMLElement, animSpecs: Map<Element, CssAnim>): LayoutState => {
    const hostRect = host.getBoundingClientRect();
    const rel = (r: DOMRect): Rect => ({ x: r.left - hostRect.left, y: r.top - hostRect.top, w: r.width, h: r.height });
    const groups: LayoutGroup[] = [];
    const layers: LayoutLayer[] = [];
    let dropShadow: Shadow | undefined;

    const addGroup = (el: HTMLElement, cs: CSSStyleDeclaration, parent: number, motion: GroupMotion) => {
      const rects = Array.from(el.getClientRects());
      let box: Rect = rel(el.getBoundingClientRect());
      if (rects.length > 1) {
        const xs = rects.map((r) => r.left);
        const ys = rects.map((r) => r.top);
        const x2 = rects.map((r) => r.right);
        const y2 = rects.map((r) => r.bottom);
        box = rel(new DOMRect(Math.min(...xs), Math.min(...ys), Math.max(...x2) - Math.min(...xs), Math.max(...y2) - Math.min(...ys)));
      }
      const [ox, oy] = cs.transformOrigin.split(/\s+/).map(px);
      groups.push({
        parent,
        motion,
        box,
        originX: box.x + (Number.isFinite(ox) ? ox : box.w / 2),
        originY: box.y + (Number.isFinite(oy) ? oy : box.h / 2),
        opacity: Number(cs.opacity) || 0,
        transformable: cs.display !== 'inline' && cs.display !== 'contents',
      });
      return groups.length - 1;
    };

    const push = (group: number, item: TextItem | BoxItem, own = false) => {
      const last = layers[layers.length - 1];
      const lastIsBackdrop = last?.items.length === 1 && last.items[0].type === 'box' && !!last.items[0].backdropBlur;
      if (!own && last && last.group === group && !lastIsBackdrop) last.items.push(item);
      else layers.push({ group, items: [item] });
    };

    const clipTextOwner = (el: HTMLElement): { el: HTMLElement; cs: CSSStyleDeclaration } | null => {
      for (let cur: HTMLElement | null = el; cur && cur !== overlay.parentElement; cur = cur.parentElement) {
        const cs = getComputedStyle(cur);
        const clip = cs.backgroundClip || (cs as unknown as { webkitBackgroundClip?: string }).webkitBackgroundClip;
        if (clip === 'text' && cs.backgroundImage && cs.backgroundImage !== 'none') return { el: cur, cs };
        if (cur === overlay) break;
      }
      return null;
    };

    const emitBoxes = (el: HTMLElement, cs: CSSStyleDeclaration, group: number) => {
      const clip = cs.backgroundClip || (cs as unknown as { webkitBackgroundClip?: string }).webkitBackgroundClip;
      const clipsToText = clip === 'text';
      const bg = normalizeColor(cs.backgroundColor);
      const borderW = cs.borderTopStyle !== 'none' ? px(cs.borderTopWidth) : 0;
      const borderColor = normalizeColor(cs.borderTopColor);
      const shadows = parseShadows(cs.boxShadow, cs.color);
      const backdrop = parseBlurFilter(
        cs.backdropFilter || (cs as unknown as { webkitBackdropFilter?: string }).webkitBackdropFilter,
      );
      const hasGradient = !clipsToText && cs.backgroundImage && cs.backgroundImage !== 'none';
      const hasFill = !clipsToText && (hasGradient || colorAlpha(bg) > 0);
      const hasBorder = borderW > 0 && colorAlpha(borderColor) > 0;
      if (!hasFill && !hasBorder && !shadows.length && !backdrop) return;
      const rects = cs.display === 'inline' ? Array.from(el.getClientRects()) : [el.getBoundingClientRect()];
      for (const r of rects) {
        if (r.width <= 0 || r.height <= 0) continue;
        const rect = rel(r);
        const item: BoxItem = {
          type: 'box',
          rect,
          radii: [
            px(cs.borderTopLeftRadius),
            px(cs.borderTopRightRadius),
            px(cs.borderBottomRightRadius),
            px(cs.borderBottomLeftRadius),
          ],
        };
        if (hasFill) {
          const gradient = hasGradient ? parseLinearGradient(cs.backgroundImage, rect) : null;
          item.fill = gradient ?? { type: 'color', color: bg as string };
        }
        if (hasBorder) item.border = { width: borderW, color: borderColor as string };
        if (shadows.length) item.shadows = shadows;
        if (backdrop) {
          // The blur is its own layer (it samples what is already painted).
          push(group, { type: 'box', rect, radii: item.radii, backdropBlur: backdrop }, true);
        }
        if (hasFill || hasBorder || shadows.length) push(group, item);
      }
    };

    const emitText = (node: Text, el: HTMLElement, cs: CSSStyleDeclaration, group: number) => {
      if (cs.visibility !== 'visible') return;
      const raw = node.data;
      if (!raw.trim()) return;
      const metrics = fontMetrics(cs);
      const owner = clipTextOwner(el);
      const color = normalizeColor(cs.color) ?? 'rgba(255, 255, 255, 1)';
      const shadows = parseShadows(cs.textShadow, cs.color);
      const strokeW = px((cs as unknown as { webkitTextStrokeWidth?: string }).webkitTextStrokeWidth);
      const strokeColor = normalizeColor((cs as unknown as { webkitTextStrokeColor?: string }).webkitTextStrokeColor);
      const underline = cs.textDecorationLine.includes('underline');
      const letterSpacing = cs.letterSpacing === 'normal' ? 0 : px(cs.letterSpacing);
      const transform = cs.textTransform;
      const wordEl = el.closest('[data-wi]');
      const wordIndex = wordEl && overlay.contains(wordEl) ? Number(wordEl.getAttribute('data-wi')) : undefined;
      const useKey = `${cs.fontStyle}|${cs.fontWeight}|${cs.fontFamily}`;
      let use = fontUses.get(useKey);
      if (!use) {
        use = { fontStyle: cs.fontStyle, fontWeight: cs.fontWeight, fontFamily: cs.fontFamily, chars: new Set() };
        fontUses.set(useKey, use);
      }
      const range = document.createRange();
      const re = /\S+/g;
      let m: RegExpExecArray | null;
      let charOffset = 0;
      while ((m = re.exec(raw))) {
        range.setStart(node, m.index);
        range.setEnd(node, m.index + m[0].length);
        const rects = range.getClientRects();
        if (!rects.length) continue;
        const r = rects[0];
        let text = m[0];
        if (transform === 'uppercase') text = text.toUpperCase();
        else if (transform === 'lowercase') text = text.toLowerCase();
        else if (transform === 'capitalize') text = text.charAt(0).toUpperCase() + text.slice(1);
        for (const ch of text) use.chars.add(ch);
        const box = rel(r);
        const item: TextItem = {
          type: 'text',
          x: box.x,
          y: box.y + metrics.baseline,
          text,
          fontStyle: cs.fontStyle,
          fontWeight: cs.fontWeight,
          fontSize: px(cs.fontSize),
          fontFamily: cs.fontFamily,
          letterSpacing,
          width: box.w,
          ascent: metrics.ascent,
          descent: metrics.descent,
          fill: owner
            ? (parseLinearGradient(owner.cs.backgroundImage, rel(owner.el.getBoundingClientRect())) ?? {
                type: 'color',
                color,
              })
            : { type: 'color', color },
          shadows,
        };
        if (strokeW > 0 && colorAlpha(strokeColor) > 0) {
          item.stroke = {
            width: strokeW,
            color: strokeColor as string,
            first: (cs.paintOrder || '').startsWith('stroke'),
          };
        }
        if (dropShadow) item.dropShadow = dropShadow;
        if (underline) {
          const thickness = cs.textDecorationThickness;
          item.decoration = {
            style: cs.textDecorationStyle === 'wavy' ? 'wavy' : 'solid',
            color: normalizeColor(cs.textDecorationColor) ?? color,
            thickness: /px$/.test(thickness) ? px(thickness) : 0,
            offset: cs.textUnderlineOffset === 'auto' ? null : px(cs.textUnderlineOffset),
          };
        }
        if (wordIndex !== undefined) {
          item.wordIndex = wordIndex;
          item.charOffset = charOffset;
        }
        charOffset += m[0].length;
        push(group, item);
      }
    };

    const SKIP = ['caption-resize', 'caption-resize-confirm', 'capw-delete'];

    const walk = (el: HTMLElement, parentGroup: number) => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none') return;
      if (SKIP.some((c) => el.classList.contains(c))) return;

      let group = parentGroup;
      let motion: GroupMotion | null = null;
      const anim = animSpecs.get(el);
      if (el.dataset.cf === 'fade') motion = { kind: 'overlay' };
      else if (el.dataset.cf === 'roll') motion = { kind: 'rollPrev' };
      else if (el.classList.contains('cap-block')) motion = { kind: 'block' };
      else if (el.hasAttribute('data-wi')) motion = { kind: 'word', wordIndex: Number(el.getAttribute('data-wi')) };
      else if (anim) motion = { kind: 'css', ...anim };
      else if (Number(cs.opacity) < 0.999) motion = { kind: 'static' };
      if (motion) group = addGroup(el, cs, parentGroup, motion);

      const outerDrop = dropShadow;
      const ds = parseDropShadow(cs.filter);
      if (ds) dropShadow = ds;
      if (cs.display !== 'contents') emitBoxes(el, cs, group);
      for (const child of Array.from(el.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) emitText(child as Text, el, cs, group);
        else if (child.nodeType === Node.ELEMENT_NODE) walk(child as HTMLElement, group);
      }
      dropShadow = outerDrop;
    };

    const rootCs = getComputedStyle(overlay);
    const rootGroup = addGroup(overlay, rootCs, -1, { kind: 'static' });
    groups[rootGroup].opacity = 1;
    const outerDrop = parseDropShadow(rootCs.filter);
    if (outerDrop) dropShadow = outerDrop;
    emitBoxes(overlay, rootCs, rootGroup);
    for (const child of Array.from(overlay.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) emitText(child as Text, overlay, rootCs, rootGroup);
      else if (child.nodeType === Node.ELEMENT_NODE) walk(child as HTMLElement, rootGroup);
    }
    return { groups, layers };
  };

  const renderState = async (caption: DisplayCaption, prev: DisplayCaption | undefined, visibleCount: number) => {
    flushSync(() =>
      root.render(
        <MeasureOverlay
          caption={caption}
          prev={prev}
          style={style}
          refHeight={refHeight}
          visibleCount={visibleCount}
          variants={wordVariantsRaw}
        />,
      ),
    );
    const overlay = mount.querySelector('.caption-overlay') as HTMLElement | null;
    if (!overlay) throw new Error('caption layout: overlay did not render');
    await ensureFonts(overlay);
    // Pass A: CSS animations as authored.
    const animSpecs = new Map<Element, CssAnim>();
    for (const el of Array.from(overlay.querySelectorAll('*'))) {
      const cs = getComputedStyle(el);
      const name = cs.animationName.split(',')[0].trim();
      if (!name || name === 'none') continue;
      animationNames.add(name);
      animSpecs.set(el, {
        name,
        duration: seconds(cs.animationDuration),
        delay: seconds(cs.animationDelay),
        easing: cs.animationTimingFunction.split(/,(?![^(]*\))/)[0].trim(),
        fill: cs.animationFillMode.split(',')[0].trim(),
      });
    }
    // Pass B: resting, untransformed geometry.
    host.classList.add('cf-layout-static');
    try {
      return measureState(overlay, animSpecs);
    } finally {
      host.classList.remove('cf-layout-static');
    }
  };

  const captions: LayoutCaption[] = [];
  try {
    for (let ci = 0; ci < display.length; ci++) {
      if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const cap = display[ci];
      const words = cap.text.split(/\s+/).filter(Boolean);
      const timings = wordTimings(cap);
      const prevCap = ci > 0 ? display[ci - 1] : undefined;
      const nextCap = ci + 1 < display.length ? display[ci + 1] : undefined;
      const rollPrev = style.displayMode === 'rolling' ? prevCap : undefined;

      const counts =
        behavior === 'karaoke'
          ? Array.from(
              { length: words.length - countShown(timings, cap.start) + 1 },
              (_, i) => countShown(timings, cap.start) + i,
            )
          : [words.length];
      const states: LayoutState[] = [];
      for (const count of counts) states.push(await renderState(cap, rollPrev, count));
      const stateTimes = counts.map((count, i) => (i === 0 ? cap.start : timings[count - 1]));

      captions.push({
        start: cap.start,
        end: cap.end,
        fadeIn: !prevCap || cap.start - prevCap.end > 1e-3,
        fadeOut: !nextCap || nextCap.start - cap.end > 1e-3,
        states,
        stateTimes,
        reveal: behavior === 'paint' ? timings.map((t) => (t > cap.start ? t : null)) : null,
        typewriter:
          style.displayMode === 'typewriter'
            ? { starts: timings, lengths: words.map((w) => w.length), end: cap.end }
            : null,
      });

      opts.onProgress?.(ci + 1, display.length);
      if (ci % 12 === 11) await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    root.unmount();
    host.remove();
    staticRule.remove();
  }

  return {
    version: 1,
    refWidth,
    refHeight,
    captions,
    wordVariants: {
      hidden: variantValues(wordVariantsRaw.hidden),
      shown: variantValues(wordVariantsRaw.shown),
    },
    blockVariants: {
      hidden: variantValues(blockVariantsRaw.hidden),
      enter: variantValues(blockVariantsRaw.enter),
    },
    keyframes: collectKeyframes(animationNames),
    fontUses: [...fontUses.values()].map((u) => ({
      fontStyle: u.fontStyle,
      fontWeight: u.fontWeight,
      fontFamily: u.fontFamily,
      text: [...u.chars].join(''),
    })),
  };
}
