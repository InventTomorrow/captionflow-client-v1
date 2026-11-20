/**
 * /dev/caption-layout — preview vs on-device export, side by side.
 *
 * Left: the editor's real <CaptionOverlay> at time t. Right: the same captions
 * compiled by lib/export/layout/compile.tsx and drawn by painter.ts — what the
 * export worker burns into the video. Both at the reference frame size, so a
 * pixel diff between them is the export's fidelity to the preview.
 *
 * Query: ?card=<template card key>&aspect=9:16&at=0.6&seq=1
 *   at  = position inside the chosen caption (0..1)
 *   seq = which caption of the fixture (1-based) to show
 * Automation: document.title → 'layout-ready' | 'layout-error';
 *   window.__layoutParity = { card, t, width, height, ms, error? }.
 * Dev builds only (App.tsx).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Caption } from '../stores/captionStore';
import { CaptionOverlay, LEAD, type OverlayStyle } from '../components/CaptionOverlay';
import { TEMPLATE_CATALOG } from '../lib/templateCatalog';
import { styleWithTemplate } from '../lib/templateApply';
import { deriveDisplayCaptions, type DisplayMode } from '../lib/displayCaptions';
import { isKineticTemplate } from '../lib/kinetic/engine';
import { compileLayoutTrack, type LayoutStyle } from '../lib/export/layout/compile';
import { createLayoutPainter } from '../lib/export/layout/painter';
import { REF_LONG_EDGE } from '../lib/export/layout/types';

declare global {
  interface Window {
    __layoutParity?: { card: string; t: number; width: number; height: number; ms: number; error?: string };
    __layoutCards?: string[];
  }
}

const BASE: LayoutStyle & { aspectRatio: string } = {
  template: 'classic',
  fontFamily: 'Montserrat',
  fontSize: 48,
  fontWeight: 700,
  color: '#FFFFFF',
  backgroundColor: 'rgba(0,0,0,0)',
  highlightColor: '#FFC43D',
  activeFill: 'transparent',
  textTransform: 'none',
  position: 'center',
  offsetX: 50,
  offsetY: 50,
  animation: 'fade',
  displayMode: 'karaoke',
  displayWords: 5,
  aspectRatio: '9:16',
};

/** Legacy looks no card offers any more, still rendered for older projects. */
const LEGACY_CARDS: Array<{ key: string; preset: Partial<LayoutStyle> }> = [
  { key: 'mixed-styles', preset: { displayMode: 'phrase', template: 'mixed', animation: 'fade' } },
  { key: 'rolling-classic', preset: { displayMode: 'rolling', template: 'classic', fontFamily: 'Poppins', fontWeight: 700, animation: 'fade' } },
];

/** Every non-kinetic catalog card (shown or hidden), as the editor applies it, plus the legacy looks. */
function allCards(): Array<{ key: string; style: LayoutStyle }> {
  const fromCatalog = TEMPLATE_CATALOG.map((c) => ({ key: c.key, style: { ...BASE, ...styleWithTemplate(BASE, c) } as LayoutStyle }));
  const legacy = LEGACY_CARDS.map((c) => ({
    key: c.key,
    style: { ...BASE, ...styleWithTemplate(BASE, { key: c.key, name: c.key, purpose: '', desc: '', preset: c.preset as never }) } as LayoutStyle,
  }));
  return [...fromCatalog, ...legacy].filter((c) => !isKineticTemplate(c.style.template));
}

const LINES = [
  'nobody tells you this part of the story',
  'we are finally back together tonight',
  'everything changes when you keep going',
  'this is the moment',
  'hard work beats talent every single time',
  'stay hungry and humble',
  'the best is yet to come my friend',
  'never give up on your dreams',
];

function fixtureCaptions(): Caption[] {
  const out: Caption[] = [];
  let t = 0.5;
  LINES.forEach((text, i) => {
    const words = text.split(' ');
    const dur = 0.42 * words.length;
    out.push({
      _id: `fx-${i}`,
      sequence: i + 1,
      start: Number(t.toFixed(3)),
      end: Number((t + dur).toFixed(3)),
      text,
      words: words.map((w, k) => ({
        word: w,
        start: Number((t + k * 0.42).toFixed(3)),
        end: Number((t + (k + 1) * 0.42).toFixed(3)),
      })),
      emphasis: words.map((_, k) => (k === 2 ? 'hero' : k === 4 ? 'small' : 'auto')),
    });
    t += dur + 0.05;
  });
  return out;
}

const noop = () => {};

export function CaptionLayoutDevPage() {
  const [params] = useSearchParams();
  const cards = useMemo(allCards, []);
  const cardKey = params.get('card') ?? cards[0].key;
  const card = cards.find((c) => c.key === cardKey) ?? cards[0];
  const aspect = params.get('aspect') ?? '9:16';
  const at = Number(params.get('at') ?? '0.6');
  const seq = Math.max(1, Number(params.get('seq') ?? '1'));
  const [aw, ah] = aspect.split(':').map(Number);
  const width = aw >= ah ? REF_LONG_EDGE : (REF_LONG_EDGE * aw) / ah;
  const height = aw >= ah ? (REF_LONG_EDGE * ah) / aw : REF_LONG_EDGE;

  const style = card.style;
  // ?scale=145 — every caption carries that size override (Caption.sizeScale), as after "Apply to all chunks".
  const scale = Number(params.get('scale')) || null;
  const captions = useMemo(
    () => fixtureCaptions().map((c) => (scale ? { ...c, sizeScale: scale } : c)),
    [scale],
  );
  const display = useMemo(
    () => deriveDisplayCaptions(captions, style.displayMode as DisplayMode, style.displayWords),
    [captions, style],
  );
  const target = display[Math.min(display.length - 1, seq - 1)];
  // Nudged off word boundaries so paint/karaoke animations have settled —
  // the DOM preview mounts already-revealed words without animating them.
  // The DOM side is screenshotted after its wall-clock animations settle, so the
  // export is compared at an instant where no word is mid-entry: at least
  // SETTLE after the latest word start (entry animations last ≤ 0.3 s).
  const SETTLE = 0.4;
  const raw = Math.min(target.end - 0.05, target.start + (target.end - target.start) * at + 0.23);
  const wordStarts = captions.flatMap((c) => (c.words ?? []).map((w) => w.start)).filter((s) => s <= raw + LEAD);
  const lastStart = wordStarts.length ? Math.max(...wordStarts) : target.start;
  // Whole-caption entrances also settle: the editorial templates blur each word
  // in with a stagger of up to 0.14 s/word (CaptionOverlay `gap`) + ~0.6 s.
  const blockSettle = target.start + (target.text.split(/\s+/).length - 1) * 0.14 + 0.65;
  const settled = Math.max(raw + LEAD - lastStart < SETTLE ? lastStart + SETTLE - LEAD : raw, blockSettle - LEAD);
  const t = Math.min(target.end - 0.05, settled);

  const layerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef({ currentTime: t - LEAD } as unknown as HTMLVideoElement);
  videoRef.current = { currentTime: t - LEAD } as unknown as HTMLVideoElement;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState('compiling…');

  useEffect(() => {
    window.__layoutCards = cards.map((c) => c.key);
    let cancelled = false;
    const started = performance.now();
    document.title = 'layout-running';
    void (async () => {
      try {
        await document.fonts.ready;
        const track = await compileLayoutTrack({ captions, style, width, height });
        (window as unknown as { __layoutTrack?: unknown }).__layoutTrack = track;
        const painter = createLayoutPainter(track, width, height);
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) throw new Error('canvas missing');
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        painter.draw(ctx as unknown as OffscreenCanvasRenderingContext2D, t);
        // Let the DOM preview's entry animations (wall clock) settle.
        await new Promise((r) => setTimeout(r, 1600));
        if (cancelled) return;
        window.__layoutParity = { card: card.key, t, width, height, ms: Math.round(performance.now() - started) };
        setStatus(`ready · ${track.captions.length} captions`);
        document.title = 'layout-ready';
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        window.__layoutParity = { card: card.key, t, width, height, ms: 0, error: message };
        setStatus(`error: ${message}`);
        document.title = 'layout-error';
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [card, captions, style, width, height, t, cards]);

  const overlayStyle = style as unknown as OverlayStyle;

  return (
    <div className="cf-parity" style={{ padding: 16, color: '#ddd', fontFamily: 'system-ui', background: '#222', minHeight: '100vh' }}>
      <style>{'.cf-parity .caption-resize{display:none!important}'}</style>
      <div style={{ marginBottom: 8, fontSize: 13 }}>
        <b>{card.key}</b> · {style.template}/{style.displayMode}/{style.animation} · t={t.toFixed(2)} · {status}
      </div>
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div id="dom-frame" style={{ position: 'relative', width, height, background: '#000', overflow: 'hidden' }}>
          <div ref={layerRef} className="video-caption-layer">
            <CaptionOverlay
              captions={display}
              videoRef={videoRef}
              wrapRef={layerRef}
              style={overlayStyle}
              displayMode={style.displayMode as DisplayMode}
              selectedCaptionId={null}
              selectedWordIdx={null}
              onWordSelect={noop}
              onWordDelete={noop}
              onSaveText={noop}
              onChunkStyleCommit={noop}
              onChunkDelete={noop}
            />
          </div>
        </div>
        <canvas id="paint-frame" ref={canvasRef} width={width} height={height} style={{ width, height, background: '#000' }} />
      </div>
    </div>
  );
}
