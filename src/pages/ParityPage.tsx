/**
 * ParityPage.tsx — test-only route (/parity) used by server/src/scripts/
 * parity-check.ts. Renders a kinetic composition with the REAL browser code
 * path (same engine, same font loading, same canvas setup as the editor's
 * preview layer) and hands the frames back as PNG data URLs, so the script can
 * compare them pixel-for-pixel with the server's @napi-rs/canvas render.
 *
 * Only registered when import.meta.env.DEV or VITE_ENABLE_PARITY=1 — see App.tsx.
 *
 * Fixture (base64 of UTF-8 JSON in `?fixture=`):
 *   { template, captions, style: { color, highlightColor, fontSize, kinetic? },
 *     w, h, times: number[], background? }
 */

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  KINETIC_BASE_FONT_SIZE,
  KINETIC_FACES,
  buildKineticComposition,
  facesForTemplate,
  renderKineticFrame,
  type KineticCaptionInput,
  type KineticFace,
  type KineticParams,
  type KineticTemplateId,
  type Metrics,
} from '../lib/kinetic/engine';
import { createBrowserMetrics, loadKineticFonts, setupKineticCanvas } from '../lib/kinetic/browser';

export interface ParityFixture {
  template: KineticTemplateId;
  captions: KineticCaptionInput[];
  style: { color: string; highlightColor: string; fontSize: number; kinetic?: KineticParams };
  w: number;
  h: number;
  times: number[];
  background?: string;
  /**
   * When set, the faces are loaded as `${fontsBase}/<file>` — the very TTFs
   * the server registers (served by parity-check.ts) — under private family
   * names, so the test compares the same font bytes on both sides and never
   * depends on Google Fonts being reachable. Omitted = the editor's normal
   * loading path (loadKineticFonts).
   */
  fontsBase?: string;
}

interface FaceSet {
  fontFor: (face: KineticFace) => { family: string; weight: number };
  metricsFor: (face: KineticFace) => Metrics;
}

async function loadFacesFrom(base: string, template: KineticTemplateId): Promise<FaceSet> {
  const faces = facesForTemplate(template);
  await Promise.all(
    faces.map(async (face) => {
      const spec = KINETIC_FACES[face];
      const ff = new FontFace(`Parity-${face}`, `url(${base}/${spec.file})`, {
        weight: String(spec.weight),
      });
      document.fonts.add(await ff.load());
    }),
  );
  const fontFor = (face: KineticFace) => ({
    family: `"Parity-${face}"`,
    weight: KINETIC_FACES[face].weight,
  });
  const cache = new Map<KineticFace, Metrics>();
  const metricsFor = (face: KineticFace) => {
    let m = cache.get(face);
    if (!m) {
      const f = fontFor(face);
      m = createBrowserMetrics(f.family, f.weight);
      cache.set(face, m);
    }
    return m;
  };
  return { fontFor, metricsFor };
}

declare global {
  interface Window {
    __parityFrames?: string[];
    __parityFingerprints?: Record<string, number>;
    __parityError?: string;
  }
}

function decodeFixture(raw: string): ParityFixture {
  // atob yields a binary string; rebuild the UTF-8 bytes so non-ASCII captions
  // (Urdu, accents) round-trip exactly.
  const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as ParityFixture;
}

export function ParityPage() {
  const [params] = useSearchParams();
  const [status, setStatus] = useState('rendering…');
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const raw = params.get('fixture');
    let cancelled = false;
    void (async () => {
      try {
        if (!raw) throw new Error('missing ?fixture=<base64 json>');
        const fx = decodeFixture(raw);
        let fonts: FaceSet;
        if (fx.fontsBase) {
          fonts = await loadFacesFrom(fx.fontsBase, fx.template);
        } else {
          const set = await loadKineticFonts(fx.template);
          if (!set.ok) throw new Error(`fonts not loaded: ${JSON.stringify(set.statuses)}`);
          fonts = set;
        }
        if (cancelled) return;

        const canvas = canvasRef.current;
        if (!canvas) throw new Error('canvas missing');
        const frame = { W: fx.w, H: fx.h };
        // renderScale 1: the backing store IS the export resolution.
        const ctx = setupKineticCanvas(canvas, frame, 1);
        const raw2d = canvas.getContext('2d');
        if (!raw2d) throw new Error('2D context unavailable');

        const comp = buildKineticComposition({
          template: fx.template,
          captions: fx.captions,
          accentColor: fx.style.highlightColor,
          baseColor: fx.style.color,
          frame,
          metricsFor: fonts.metricsFor,
          fontFor: fonts.fontFor,
          fontScale: (fx.style.fontSize || KINETIC_BASE_FONT_SIZE) / KINETIC_BASE_FONT_SIZE,
          params: fx.style.kinetic,
        });

        const frames: string[] = [];
        for (const t of fx.times) {
          raw2d.setTransform(1, 0, 0, 1, 0, 0);
          raw2d.fillStyle = fx.background ?? '#202020';
          raw2d.fillRect(0, 0, fx.w, fx.h);
          renderKineticFrame(ctx, comp, { timeSec: t, clear: false });
          frames.push(canvas.toDataURL('image/png'));
        }

        window.__parityFrames = frames;
        window.__parityFingerprints = comp.fingerprints as Record<string, number>;
        document.title = 'parity-ready';
        setStatus(`ready - ${frames.length} frame(s), fingerprints ${JSON.stringify(comp.fingerprints)}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        window.__parityError = message;
        document.title = 'parity-error';
        setStatus(`error: ${message}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params]);

  return (
    <div style={{ padding: 16, minHeight: '100vh', background: '#111', color: '#eee', fontFamily: 'monospace' }}>
      <p>{status}</p>
      <canvas ref={canvasRef} style={{ maxWidth: '100%', display: 'block' }} />
    </div>
  );
}
