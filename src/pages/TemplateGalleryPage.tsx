/**
 * TemplateGalleryPage.tsx — dev-only route (/dev/template-cards).
 *
 * Every template picker card on one page, drawn by the editor's own
 * TemplateCard inside the same panel classes and at the side panel's width,
 * so a screenshot of a card here is a screenshot of the card in the editor.
 * server/scripts/template-bg/shoot.mjs is what reads it.
 *
 *   ?only=a,b   just these card keys
 *   ?w=294      panel width in px (default: the editor's open side panel)
 *
 * Sets window.__templateGalleryReady once fonts are loaded, every backdrop
 * image has decoded and every engine-drawn thumbnail has painted, and lists
 * cards whose backdrop failed to load in window.__templateGalleryMissing.
 */
import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { TemplateCardGallery } from '../components/TemplateCard';

declare global {
  interface Window {
    __templateGalleryReady?: boolean;
    __templateGalleryMissing?: string[];
  }
}

/**
 * The open template drawer is min(360px, 38vw) including its 64px icon rail
 * and 1px borders (.studio-drawer in index.css), which leaves 294px for the
 * panel on any screen wide enough to show the editor comfortably.
 */
const PANEL_WIDTH = 294;

/** Resolves with the card key when its backdrop fails to load, null otherwise. */
function loadBackdrop(stage: HTMLElement): Promise<string | null> {
  const key = stage.closest<HTMLElement>('.display-card')?.dataset.key ?? '?';
  const match = /url\(\s*["']?([^"')]+)["']?\s*\)/.exec(stage.style.getPropertyValue('--stage-img'));
  if (!match) return Promise.resolve(key);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      img.decode().then(
        () => resolve(null),
        () => resolve(key),
      );
    };
    img.onerror = () => resolve(key);
    img.src = match[1];
  });
}

function thumbnailsPainted(): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      const canvases = Array.from(document.querySelectorAll<HTMLCanvasElement>('canvas.kinetic-thumb'));
      if (canvases.every((c) => Boolean(c.dataset.painted))) resolve();
      else window.setTimeout(check, 100);
    };
    check();
  });
}

export function TemplateGalleryPage() {
  const [params] = useSearchParams();
  const onlyParam = params.get('only') ?? '';
  const width = Number(params.get('w')) || PANEL_WIDTH;

  useEffect(() => {
    let cancelled = false;
    window.__templateGalleryReady = false;
    void (async () => {
      await document.fonts.ready;
      const stages = Array.from(document.querySelectorAll<HTMLElement>('.display-stage.has-bg'));
      const missing = (await Promise.all(stages.map(loadBackdrop))).filter((k): k is string => Boolean(k));
      await thumbnailsPainted();
      // Two frames, so layout and the decoded backgrounds are on screen.
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      if (cancelled) return;
      window.__templateGalleryMissing = missing;
      window.__templateGalleryReady = true;
    })();
    return () => {
      cancelled = true;
    };
  }, [onlyParam, width]);

  return (
    <div style={{ padding: 24, background: 'var(--cf-bg)', minHeight: '100vh' }}>
      <TemplateCardGallery only={onlyParam ? onlyParam.split(',').filter(Boolean) : null} width={width} />
    </div>
  );
}
