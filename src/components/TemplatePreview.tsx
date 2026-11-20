/**
 * TemplatePreview — a template card's preview, drawn by the editor's own
 * caption renderers (<CaptionOverlay> or <KineticCaptionLayer>) inside a
 * miniature 9:16 frame, so a card can only show what the editor preview and
 * the export produce — never a hand-drawn mock of it.
 *
 * Both renderers read time from a <video>; here a tiny stand-in clock feeds
 * them. Paused (the default) it holds a settled frame of the first caption;
 * `playing` loops the sample captions. It renders nothing until the card is
 * near the viewport, and never plays under prefers-reduced-motion.
 */
import { memo, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { CaptionOverlay, LEAD } from './CaptionOverlay';
import KineticCaptionLayer from './KineticCaptionLayer';
import type { Caption } from '../stores/captionStore';
import { deriveDisplayCaptions } from '../lib/displayCaptions';
import { isKineticTemplate, type KineticTemplateId } from '../lib/kinetic/engine';
import { styleWithTemplate } from '../lib/templateApply';
import type { UnifiedTemplate } from '../lib/templateCatalog';

/** The miniature frame the renderers lay out in (9:16, like the editor's default). */
const FRAME_W = 270;
const FRAME_H = 480;

const WORD_SEC = 0.34;
function sample(text: string, start: number, seq: number, hero: number): Caption {
  const words = text.split(' ');
  return {
    _id: `tpl-sample-${seq}`,
    sequence: seq,
    start,
    end: Number((start + words.length * WORD_SEC).toFixed(3)),
    text,
    words: words.map((word, i) => ({
      word,
      start: Number((start + i * WORD_SEC).toFixed(3)),
      end: Number((start + (i + 1) * WORD_SEC).toFixed(3)),
    })),
    emphasis: words.map((_, i) => (i === hero ? 'hero' : 'auto')),
  };
}

/** Two short lines: one long enough to wrap and build, one short punch. */
const SAMPLE: Caption[] = [sample('this is how you stand out', 0.15, 1, 4), sample('every single time', 2.35, 2, 1)];
const LOOP_SEC = 3.9;

const noop = () => undefined;

function usePrefersReducedMotion() {
  const [reduce, setReduce] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    const on = () => setReduce(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduce;
}

export const TemplatePreview = memo(function TemplatePreview({
  card,
  playing = false,
}: {
  card: UnifiedTemplate;
  /** Loop the sample captions (hover / focus / the details view). */
  playing?: boolean;
}) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [scale, setScale] = useState(0);
  /** Extra zoom-out (≤ 1) so a tall or wide caption fits the card instead of being cropped. */
  const [fit, setFit] = useState(1);
  const reduce = usePrefersReducedMotion();
  const play = playing && !reduce && near;

  // Mount the renderer only while the card is on (or near) screen.
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setNear(e.isIntersecting), { rootMargin: '160px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // The 270×480 frame is scaled to the card's width.
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(el.clientWidth / FRAME_W));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The stand-in <video>: only `currentTime` is read by the renderers.
  const clock = useRef({ t0: 0, playing: false, still: 1 });
  clock.current.playing = play;
  const video = useMemo(() => {
    const v = {
      get currentTime() {
        const c = clock.current;
        return c.playing ? ((performance.now() - c.t0) / 1000) % LOOP_SEC : c.still;
      },
      paused: true,
    };
    return { current: v as unknown as HTMLVideoElement } as RefObject<HTMLVideoElement | null>;
  }, []);
  useEffect(() => {
    if (play) clock.current.t0 = performance.now();
  }, [play]);

  const style = useMemo(
    () =>
      styleWithTemplate(
        { position: 'center' as const, offsetX: 50, offsetY: 50 },
        card,
      ),
    [card],
  );
  const display = useMemo(
    () => deriveDisplayCaptions(SAMPLE, style.displayMode as never, style.displayWords),
    [style.displayMode, style.displayWords],
  );
  const kinetic = isKineticTemplate(style.template);

  // Fit the held caption inside the card (layout sizes, so animations don't
  // matter), once its fonts are in. The loop keeps the same zoom — no jumping.
  useEffect(() => {
    if (!near || !scale || kinetic) return;
    let cancelled = false;
    const measure = () => {
      const host = hostRef.current;
      const o = frameRef.current?.querySelector<HTMLElement>('.caption-overlay');
      if (cancelled || !host || !o || !o.offsetHeight) return;
      const k = Math.min(1, (host.clientHeight * 0.9) / (o.offsetHeight * scale), (host.clientWidth * 0.94) / (o.offsetWidth * scale));
      setFit((prev) => (Math.abs(prev - k) > 0.01 ? k : prev));
    };
    // The caption appears on the renderer's next frames and fonts may still be
    // arriving, so measure a few times early on.
    const timers = [120, 450, 1200].map((ms) => window.setTimeout(() => void document.fonts.ready.then(measure), ms));
    return () => {
      cancelled = true;
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [near, scale, kinetic, card]);
  // Held frame: the fullest on-screen chunk of the first line, fully built and
  // before its exit (renderers look LEAD seconds ahead of currentTime).
  clock.current.still = useMemo(() => {
    const first = display.filter((c) => c.start < SAMPLE[0].end);
    const best = first.reduce((a, c) => (c.text.split(/\s+/).length > a.text.split(/\s+/).length ? c : a), first[0] ?? display[0]);
    return best ? Math.max(best.start, best.end - 0.12) - LEAD : 1;
  }, [display]);

  return (
    <span ref={hostRef} className="tpl-preview" aria-hidden="true">
      {near && scale > 0 && (
        <div
          ref={frameRef}
          inert
          className="tpl-preview-frame"
          style={{ width: FRAME_W, height: FRAME_H, transform: `translate(-50%, -50%) scale(${scale * fit})` }}
        >
          {kinetic ? (
            <KineticCaptionLayer
              captions={display}
              videoRef={video}
              template={style.template as KineticTemplateId}
              color={style.color}
              highlightColor={style.highlightColor}
              fontSize={style.fontSize}
            />
          ) : (
            <CaptionOverlay
              captions={display}
              videoRef={video}
              wrapRef={frameRef}
              style={style as never}
              displayMode={style.displayMode as never}
              selectedCaptionId={null}
              selectedWordIdx={null}
              onWordSelect={noop}
              onWordDelete={noop}
              onSaveText={noop}
              onChunkStyleCommit={noop}
              onChunkDelete={noop}
            />
          )}
        </div>
      )}
    </span>
  );
});
