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
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { TemplateCardGallery } from '../components/TemplateCard';
import { TemplateGallery } from '../components/TemplateGallery';
import { pickerTemplates } from '../lib/templateCatalog';

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
      // Every card preview has mounted its renderer (DOM overlay or kinetic canvas).
      // (Previews mount only near the viewport, so only those are waited for.)
      const previews = Array.from(document.querySelectorAll('.tpl-preview')).filter(
        (p) => p.getBoundingClientRect().top < window.innerHeight + 160,
      );
      if (previews.every((p) => p.querySelector('.caption-overlay, canvas'))) resolve();
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

  // ?panel=1 — the editor's Templates panel itself (TemplateGallery) in the widened drawer, for UI checks.
  const [applied, setApplied] = useState<string | undefined>(params.get('applied') ?? 'hero-word');
  if (params.get('panel') === '1') {
    const cards = pickerTemplates(null);
    return (
      <div className="shell-editor" style={{ display: 'flex', height: '100vh', padding: 12, background: 'var(--cf-bg)' }}>
        <div className="studio-drawer is-open is-wide">
          <aside className="studio-panel" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
            <div className="panel-header">
              <h3>Templates</h3>
              <span className="panel-count">{cards.length}</span>
            </div>
            <div className="panel-scroll">
              <TemplateGallery cards={cards} appliedKey={applied} onApply={(c) => setApplied(c.key)} />
            </div>
          </aside>
        </div>
        <div style={{ flex: 1 }} />
      </div>
    );
  }

  return (
    <div style={{ padding: 24, background: 'var(--cf-bg)', minHeight: '100vh' }}>
      <TemplateCardGallery only={onlyParam ? onlyParam.split(',').filter(Boolean) : null} width={width} />
    </div>
  );
}
