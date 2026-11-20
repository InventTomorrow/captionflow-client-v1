/**
 * Template picker cards. The preview is drawn by the editor's own caption
 * renderers (TemplatePreview), so a card shows exactly the look the editor
 * preview and the export produce. Used by the editor's Templates panel
 * (TemplateGallery), the admin Templates page and the dev-only gallery.
 *
 * A card with a painted backdrop (public/template-bg/<key>.webp, listed in
 * templateBackdrops.generated.ts) shows it behind the preview; the rest keep
 * the plain stage. The content hash in the URL means a repainted image is
 * never served from cache.
 */
import { memo } from 'react';
import { Check } from '@phosphor-icons/react';
import { TEMPLATE_BACKDROPS } from '../lib/templateBackdrops.generated';
import { pickerTemplates, templateCategory, type UnifiedTemplate } from '../lib/templateCatalog';
import { TemplatePreview } from './TemplatePreview';

/**
 * Every picker card, each inside the editor's own panel classes at `width` px.
 * Dev-only: pages/TemplateGalleryPage.tsx renders this for
 * server/scripts/template-bg/shoot.mjs (the default picker cards).
 */
export function TemplateCardGallery({ only, width }: { only?: string[] | null; width: number }) {
  const keys = only?.length ? new Set(only) : null;
  return (
    <div
      className="template-gallery"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fill, ${width}px)`,
        gap: 16,
        alignItems: 'start',
      }}
    >
      {pickerTemplates(null)
        .filter((t) => !keys || keys.has(t.key))
        .map((t) => (
          <aside key={t.key} className="studio-panel" style={{ width }}>
            <div className="templates-grid">
              <TemplateCard t={t} isActive={false} onApply={() => undefined} />
            </div>
          </aside>
        ))}
    </div>
  );
}

export const TemplateCard = memo(function TemplateCard({
  t,
  isActive,
  onApply,
  playing = false,
  onPreview,
  showCategory = true,
}: {
  t: UnifiedTemplate;
  /** This card's look is the one on the video right now. */
  isActive: boolean;
  onApply: () => void;
  /** Loop the preview (the gallery plays one card at a time: hovered or focused). */
  playing?: boolean;
  /** Hover / focus in (true) and out (false), so the gallery can pick the card to play. */
  onPreview?: (key: string, on: boolean) => void;
  showCategory?: boolean;
}) {
  const backdrop = TEMPLATE_BACKDROPS[t.key];
  return (
    <button
      type="button"
      data-key={t.key}
      className={`display-card tpl-card${isActive ? ' active' : ''}`}
      aria-pressed={isActive}
      aria-label={isActive ? `${t.name}, applied` : `Apply ${t.name}`}
      onClick={onApply}
      onMouseEnter={() => onPreview?.(t.key, true)}
      onMouseLeave={() => onPreview?.(t.key, false)}
      onFocus={() => onPreview?.(t.key, true)}
      onBlur={() => onPreview?.(t.key, false)}
    >
      <span
        className={`display-stage tpl-stage${backdrop ? ' has-bg' : ''}`}
        style={backdrop ? { ['--stage-img' as string]: `url("/template-bg/${t.key}.webp?v=${backdrop}")` } : undefined}
      >
        <TemplatePreview card={t} playing={playing} />
        {isActive && (
          <span className="tpl-check" aria-hidden="true">
            <Check size={11} weight="bold" />
          </span>
        )}
      </span>
      <span className="tpl-meta">
        <span className="tpl-name" title={t.name}>
          {t.name}
        </span>
        {isActive ? (
          <span className="tpl-state">Applied</span>
        ) : (
          showCategory && <span className="tpl-cat">{templateCategory(t.key)}</span>
        )}
      </span>
    </button>
  );
});
