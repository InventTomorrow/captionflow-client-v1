/**
 * TemplateGallery — the editor's Templates panel body: category filters, the
 * applied template's details, and a two-column grid of cards whose previews
 * are drawn by the real caption renderers. One card animates at a time (the
 * hovered or focused one); the rest hold a still frame.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { TEMPLATE_CATEGORIES, templateCategory, type TemplateCategory, type UnifiedTemplate } from '../lib/templateCatalog';
import { TemplateCard } from './TemplateCard';

type Filter = 'All' | TemplateCategory;

export function TemplateGallery({
  cards,
  appliedKey,
  onApply,
}: {
  cards: UnifiedTemplate[];
  /** The card on the video now (lib/templateApply appliedTemplateKey), or undefined for a custom look. */
  appliedKey: string | undefined;
  onApply: (card: UnifiedTemplate) => void;
}) {
  const [filter, setFilter] = useState<Filter>('All');
  const [previewKey, setPreviewKey] = useState<string | null>(null);

  // Stable per-card handlers, so a card only re-renders when its own state changes.
  const applyRef = useRef(onApply);
  applyRef.current = onApply;
  const handlers = useMemo(() => {
    const m = new Map<string, () => void>();
    for (const c of cards) m.set(c.key, () => applyRef.current(c));
    return m;
  }, [cards]);
  const onPreview = useCallback((key: string, on: boolean) => {
    setPreviewKey((cur) => (on ? key : cur === key ? null : cur));
  }, []);

  const groups = useMemo(() => {
    const present = new Set(cards.map((c) => templateCategory(c.key)));
    return TEMPLATE_CATEGORIES.filter((g) => present.has(g));
  }, [cards]);
  const shown = filter === 'All' ? cards : cards.filter((c) => templateCategory(c.key) === filter);
  const applied = appliedKey ? cards.find((c) => c.key === appliedKey) : undefined;

  return (
    <div className="tpl-gallery">
      <div className="tpl-filters" role="toolbar" aria-label="Filter templates">
        {(['All', ...groups] as Filter[]).map((g) => (
          <button
            key={g}
            type="button"
            className={`tpl-filter${filter === g ? ' is-on' : ''}`}
            aria-pressed={filter === g}
            onClick={() => setFilter(g)}
          >
            {g}
          </button>
        ))}
      </div>

      <div className="tpl-applied" aria-live="polite">
        {applied ? (
          <>
            <span className="tpl-applied-label">Applied</span>
            <strong className="tpl-applied-name">{applied.name}</strong>
            <span className="tpl-applied-desc">{applied.desc}</span>
          </>
        ) : (
          <>
            <span className="tpl-applied-label">Custom look</span>
            <span className="tpl-applied-desc">Your captions use their own style. Pick a template to replace it.</span>
          </>
        )}
      </div>

      <div className="templates-grid">
        {shown.map((t) => (
          <TemplateCard
            key={t.key}
            t={t}
            isActive={t.key === appliedKey}
            onApply={handlers.get(t.key)!}
            playing={previewKey === t.key}
            onPreview={onPreview}
            showCategory={filter === 'All'}
          />
        ))}
      </div>
    </div>
  );
}
