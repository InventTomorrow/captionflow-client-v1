/**
 * KineticThumb.tsx — a template-picker card preview drawn by the REAL kinetic
 * engine, so the card can never drift from what the preview and the export
 * produce (the other cards mock their look in CSS; these two templates draw
 * every letter themselves, so a mock would be a third implementation).
 *
 * One caption, one settled frame (past every look's entry animation, before
 * any exit), on a transparent canvas so the card's own background shows.
 */

import { useEffect, useRef } from 'react';
import type { KineticTemplateId } from '../lib/kinetic/engine';
import { buildKineticComposition, renderKineticFrame } from '../lib/kinetic/engine';
import {
  MAX_KINETIC_RENDER_SCALE,
  loadKineticFonts,
  setupKineticCanvas,
} from '../lib/kinetic/browser';

/** 16:9 thumbnail frame, in layout units (the backing store is DPR-scaled). */
const THUMB_W = 320;
const THUMB_H = 180;
/** Settled moment: past the longest entry animation of any look. */
const THUMB_TIME_SEC = 2;

export function KineticThumb({
  template,
  text,
  accent,
  base,
  fontScale = 1,
}: {
  template: KineticTemplateId;
  /** The demo caption; a multi-slot look splits it exactly as it would a real caption. */
  text: string;
  /** style.highlightColor of the preset. */
  accent: string;
  /** style.color of the preset. */
  base: string;
  /** Relative to the authored size — the small frame can use a nudge up. */
  fontScale?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    void loadKineticFonts(template).then((fonts) => {
      const canvas = ref.current;
      if (cancelled || !canvas) return;
      try {
        const frame = { W: THUMB_W, H: THUMB_H };
        const scale = Math.min(MAX_KINETIC_RENDER_SCALE, window.devicePixelRatio || 1);
        const ctx = setupKineticCanvas(canvas, frame, scale);
        const comp = buildKineticComposition({
          template,
          captions: [{ sequence: 1, start: 0, end: 60, text, emphasis: [] }],
          accentColor: accent,
          baseColor: base,
          frame,
          metricsFor: fonts.metricsFor,
          fontFor: fonts.fontFor,
          fontScale,
        });
        renderKineticFrame(ctx, comp, { timeSec: THUMB_TIME_SEC });
        // Read by the template gallery's screenshot script, so a card is never
        // captured before its thumbnail has been drawn.
        canvas.dataset.painted = '1';
      } catch (err) {
        console.error('[kinetic] thumbnail failed:', err);
        canvas.dataset.painted = 'error';
      }
    });
    return () => {
      cancelled = true;
    };
  }, [template, text, accent, base, fontScale]);

  return <canvas ref={ref} className="kinetic-thumb" aria-hidden="true" />;
}
