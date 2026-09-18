/**
 * Template picker cards (moved out of EditorPage.tsx). Each card draws its own
 * preview so its purpose is obvious at a glance.
 */
import { KineticThumb } from './KineticThumb';
import type { KineticTemplateId } from '../lib/kinetic/engine';
import { TEMPLATE_BACKDROPS } from '../lib/templateBackdrops.generated';
import { pickerTemplates, type UnifiedTemplate } from '../lib/templateCatalog';

/**
 * The line each Living card draws. Five layouts of the same idea, so each gets
 * its own copy — chosen to split lead-in / one word / two words the way the
 * design's own "it should be / LIVING / INSIDE IT" does (splitLivingWords).
 */
const LIVING_CARD_COPY: Record<string, string> = {
  livingBlue: 'it should be living inside it',
  livingTeal: 'this is the new standard',
  livingOrange: 'and then it all fell apart',
  livingRed: 'the story behind the story',
  livingPurple: 'nothing is what it seems',
};

/** Per-template card preview — unique look so purpose is obvious at a glance. */
function UnifiedPreview({ t }: { t: UnifiedTemplate }) {
  const hl = t.preset.highlightColor || '#FFC43D';
  switch (t.key) {
    case 'beat-karaoke':
      return (
        <span className="uprev uprev-karaoke">
          <span className="uprev-dim">The Quick</span>{' '}
          <span className="uprev-hl" style={{ color: hl }}>
            BROWN
          </span>{' '}
          <span className="uprev-dim">fox jumps</span>
        </span>
      );
    case 'hero-punch':
      return (
        <span className="uprev uprev-hero">
          <span className="uprev-tiny">The</span>
          <span className="uprev-tiny">Quick</span>
          <span className="uprev-hero-word" style={{ color: hl, textShadow: 'none' }}>
            BROWN
          </span>
          <span className="uprev-tiny">fox</span>
          <span className="uprev-tiny">jumps</span>
        </span>
      );
    case 'word-blast':
      return (
        <span className="uprev uprev-blast">
          <span className="uprev-blast-word">BROWN</span>
        </span>
      );
    case 'soft-flicker':
      return (
        <span className="uprev uprev-flicker">
          <span className="uprev-flicker-word">brown</span>
        </span>
      );
    case 'marker-pen':
      return (
        <span className="uprev uprev-marker">
          The Quick <mark style={{ background: hl }}>BROWN</mark> fox
        </span>
      );
    case 'stack-verse':
      return (
        <span className="uprev uprev-stack">
          <span className="uprev-stack-0">the</span>
          <span className="uprev-stack-1">quick</span>
          <span className="uprev-stack-2">brown</span>
          <span className="uprev-stack-3" style={{ color: hl }}>
            FOX
          </span>
        </span>
      );
    case 'clean-phrase':
      return (
        <span className="uprev uprev-clean">
          The quick brown fox
        </span>
      );
    case 'full-sentence':
      return (
        <span className="uprev uprev-sentence">
          The quick brown fox jumps over the lazy dog.
        </span>
      );
    case 'live-feed':
      return (
        <span className="uprev uprev-live">
          <span className="uprev-live-old">the quick brown</span>
          <span className="uprev-live-new">fox jumps over</span>
        </span>
      );
    case 'word-reveal':
      return (
        <span className="uprev uprev-reveal">
          <span>the</span> <span>quick</span>{' '}
          <span className="uprev-reveal-on" style={{ color: hl }}>
            brown
          </span>{' '}
          <span className="uprev-reveal-off">fox</span>
        </span>
      );
    case 'typewriter':
      return (
        <span className="uprev uprev-type">
          the quick bro<span className="uprev-caret" style={{ background: hl }} />
        </span>
      );
    case 'tiktok-classic':
      return (
        <span className="uprev uprev-tiktok">
          THE QUICK{' '}
          <span className="uprev-hl" style={{ color: hl }}>
            BROWN
          </span>{' '}
          FOX
        </span>
      );
    case 'roboto-word':
      return (
        <span className="uprev uprev-blast">
          <span className="uprev-blast-word">BROWN</span>
        </span>
      );
    case 'tiktok-pill':
      return (
        <span className="uprev uprev-pillbox">
          the quick brown fox
        </span>
      );
    case 'clean-white':
      return <span className="uprev uprev-clean">the quick brown fox</span>;
    case 'poppins-bold':
      return (
        <span className="uprev uprev-karaoke">
          <span className="uprev-dim">The quick</span>{' '}
          <span className="uprev-hl" style={{ color: hl }}>
            brown
          </span>{' '}
          <span className="uprev-dim">fox</span>
        </span>
      );
    case 'industrial':
      return (
        <span className="uprev uprev-industrial">
          THE QUICK{' '}
          <span className="uprev-hl" style={{ color: hl }}>
            BROWN
          </span>
        </span>
      );
    case 'hero-word':
      return (
        <span className="uprev uprev-heroword">
          <span className="uprev-hw-n">the</span>{' '}
          <span className="uprev-hw-n">quick</span>{' '}
          <span className="uprev-hw-h" style={{ color: hl }}>
            BROWN
          </span>{' '}
          <span className="uprev-hw-s">fox</span>
        </span>
      );
    case 'mixed-styles-2':
      return (
        <span className="uprev uprev-mixed">
          <span className="uprev-mx2-0">Modern</span>
          <span className="uprev-mx2-1">Quiet</span>
          <span className="uprev-mx2-2">GOLD</span>
        </span>
      );
    case 'creator-yellow-box':
      return (
        <span
          className="uprev-box"
          style={{
            background: t.preset.backgroundColor,
            color: t.preset.color,
            fontFamily: t.preset.fontFamily,
            fontWeight: 800,
            textTransform: 'uppercase',
          }}
        >
          the quick brown fox
        </span>
      );
    case 'cinematic-subtitle':
      return (
        <span
          className="uprev-box"
          style={{
            background: t.preset.backgroundColor,
            color: t.preset.color,
            fontFamily: t.preset.fontFamily,
            fontWeight: 500,
          }}
        >
          the quick brown fox
        </span>
      );
    case 'bubble-candy':
      return (
        <span
          className="uprev-box"
          style={{
            background: t.preset.backgroundColor,
            color: t.preset.color,
            fontFamily: t.preset.fontFamily,
          }}
        >
          the quick brown fox
        </span>
      );
    case 'editor-masala':
      return (
        <span className="uprev" style={{ display: 'grid', justifyItems: 'center', lineHeight: 0.95 }}>
          <span style={{ fontFamily: 'Archivo, sans-serif', fontWeight: 700, fontSize: '0.55em' }}>
            trust the
          </span>
          <span
            style={{ fontFamily: 'Anton, sans-serif', fontSize: '1.4em', color: hl, textTransform: 'uppercase' }}
          >
            process
          </span>
        </span>
      );
    case 'aura':
      return (
        <span className="uprev" style={{ display: 'grid', justifyItems: 'center', lineHeight: 1 }}>
          <span style={{ fontFamily: 'Archivo, sans-serif', fontWeight: 900, fontSize: '1.15em', color: hl, textTransform: 'uppercase' }}>
            forget
          </span>
          <span style={{ fontFamily: "'Playfair Display', serif", fontStyle: 'italic', fontWeight: 900, fontSize: '1.1em' }}>
            status
          </span>
        </span>
      );
    case 'swiss':
      return (
        <span className="uprev" style={{ display: 'grid', justifyItems: 'center', lineHeight: 0.9 }}>
          <span style={{ fontFamily: 'Archivo, sans-serif', fontWeight: 900, fontSize: '1.15em', textTransform: 'uppercase' }}>
            focus
          </span>
          <span style={{ fontFamily: 'Archivo, sans-serif', fontWeight: 900, fontSize: '1.15em', color: hl, textTransform: 'uppercase' }}>
            deeply
          </span>
        </span>
      );
    case 'the-big-red':
      return (
        <span className="uprev-box" style={{ background: 'transparent', position: 'relative', padding: '0.4em 0' }}>
          <span style={{ fontFamily: "'Playfair Display', serif", fontWeight: 900, fontSize: '1.5em', color: hl, textTransform: 'uppercase' }}>
            second
          </span>
        </span>
      );
    case 'scribble':
      return (
        <span className="uprev" style={{ fontFamily: 'Caveat, cursive', fontWeight: 700, fontSize: '1.3em' }}>
          the <mark style={{ background: hl, color: '#0b0b0d' }}>little</mark> things
        </span>
      );
    case 'archives':
      return (
        <span className="uprev" style={{ fontFamily: "'Dancing Script', cursive", fontWeight: 700, fontSize: '1.2em' }}>
          Your <span style={{ fontStyle: 'italic', textDecoration: 'underline' }}>Style</span> is it
        </span>
      );
    // The two canvas templates draw their own thumbnail with the real engine,
    // so the card can never drift from the preview/export.
    case 'anime-edit':
      return (
        <KineticThumb
          template="animeEdit"
          text="the quick brown fox"
          accent={hl}
          base={t.preset.color || '#FFFFFF'}
        />
      );
    case 'blockbuster':
      return (
        <KineticThumb
          template="blockbuster"
          text="this is the next big thing"
          accent={hl}
          base={t.preset.color || '#FFFFFF'}
          fontScale={1.5}
        />
      );
    case 'livingBlue':
    case 'livingTeal':
    case 'livingOrange':
    case 'livingRed':
    case 'livingPurple':
      // The card key IS the template id for these five, so one arm covers all.
      return (
        <KineticThumb
          template={t.preset.template as KineticTemplateId}
          text={LIVING_CARD_COPY[t.key] ?? 'it should be living inside it'}
          accent={hl}
          base={t.preset.color || '#FFFFFF'}
        />
      );
    default:
      return <span className="uprev">The Quick BROWN fox</span>;
  }
}

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
      {pickerTemplates(null).filter((t) => !keys || keys.has(t.key)).map((t) => (
        <aside key={t.key} className="studio-panel" style={{ width }}>
          <div className="templates-list">
            <TemplateCard t={t} isActive={false} onApply={() => undefined} />
          </div>
        </aside>
      ))}
    </div>
  );
}

/**
 * One template picker card, as the editor draws it. Also used by the admin
 * Templates page and the dev-only gallery (pages/TemplateGalleryPage.tsx),
 * which screenshots cards exactly as the editor draws them.
 *
 * A card with a painted backdrop (public/template-bg/<key>.webp, listed in
 * templateBackdrops.generated.ts) shows it behind the preview; the rest keep
 * the plain stage. The content hash in the URL means a repainted image is
 * never served from cache.
 */
export function TemplateCard({
  t,
  isActive,
  onApply,
}: {
  t: UnifiedTemplate;
  isActive: boolean;
  onApply: () => void;
}) {
  const backdrop = TEMPLATE_BACKDROPS[t.key];
  return (
    <button
      type="button"
      data-key={t.key}
      className={`display-card ${isActive ? 'active' : ''}`}
      title={`${t.name} - ${t.purpose}`}
      onClick={onApply}
    >
      <span
        className={`display-stage${backdrop ? ' has-bg' : ''}`}
        style={{
          fontFamily: t.preset.fontFamily,
          ['--cap-hl' as string]: t.preset.highlightColor,
          ...(backdrop
            ? { ['--stage-img' as string]: `url("/template-bg/${t.key}.webp?v=${backdrop}")` }
            : {}),
        }}
      >
        {t.tag && <span className="display-badge">{t.tag}</span>}
        {isActive && (
          <span className="display-check" aria-hidden>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="11" fill="currentColor" />
              <path
                d="M7.5 12.5 10.5 15.5 16.5 9"
                stroke="#0B141E"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        )}
        <UnifiedPreview t={t} />
      </span>
      <span className="display-meta">
        <span className="display-name-block">
          <span className="display-name">{t.name}</span>
          <span className="display-purpose">{t.purpose}</span>
          {t.tags?.length ? (
            <span className="display-tags">
              {t.tags.map((tag) => (
                <span key={tag} className="display-pill">
                  {tag}
                </span>
              ))}
            </span>
          ) : null}
        </span>
        {isActive ? (
          <span className="template-active">Active</span>
        ) : (
          <span className="template-apply">Apply</span>
        )}
      </span>
      <span className="display-desc">{t.desc}</span>
    </button>
  );
}
