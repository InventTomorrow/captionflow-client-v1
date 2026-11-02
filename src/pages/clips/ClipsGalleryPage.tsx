/**
 * /clips — every clip of the user, across projects: best-scored first (or
 * newest), filterable to rendered ones, loaded a page at a time as the user
 * scrolls. Hover/tap a card to watch it with captions; Edit opens the clip.
 * Select picks clips (any videos) for one caption template or a delete.
 */
import { ArrowRight, Check, Clock3, Film, ListChecks, Play, Sparkles, Trophy, UploadCloud } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ClipBulkBar } from '../../components/clips/ClipBulkBar';
import { ClipGrid } from '../../components/clips/ClipGrid';
import { ClipStyleSheet } from '../../components/clips/ClipStyleSheet';
import { useOpenInEditor } from '../../lib/clips/useOpenInEditor';
import { usePreviewableProjects } from '../../lib/clips/useClipMedia';
import { errorMessage } from '../../lib/api';
import { downloadLocalFile, exportFileName } from '../../lib/export/clientExport';
import { latestExportForClip } from '../../lib/media/localMedia';
import { useClipsStore } from '../../stores/clipsStore';
import type { Clip, ClipLookPatch } from '../../lib/clips/api';

export function ClipsGalleryPage() {
  const navigate = useNavigate();
  const feed = useClipsStore((s) => s.feed);
  const live = useClipsStore((s) => s.live);
  const renders = useClipsStore((s) => s.renders);
  const loadFeed = useClipsStore((s) => s.loadFeed);
  const setFeedFilter = useClipsStore((s) => s.setFeedFilter);
  const removeClip = useClipsStore((s) => s.removeClip);
  const styleClips = useClipsStore((s) => s.styleClips);
  const removeClips = useClipsStore((s) => s.removeClips);
  const [error, setError] = useState('');
  /** Selection mode: the picked clip ids; null = not selecting. */
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [styling, setStyling] = useState(false);
  const [styleBusy, setStyleBusy] = useState(false);
  const [styleError, setStyleError] = useState('');
  const sentinel = useRef<HTMLDivElement | null>(null);
  const openEditor = useOpenInEditor();
  // Only clips this device can preview (its original here, or streamed by the server).
  const previewable = usePreviewableProjects(feed.items);
  const items = feed.items.filter((c) => previewable[c.projectId]);

  useEffect(() => {
    void loadFeed(true).catch((e) => setError(errorMessage(e, 'Couldn’t load your clips')));
  }, [loadFeed]);

  // Infinite scroll: the next page loads as the end of the grid comes near.
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadFeed().catch(() => undefined);
      },
      { rootMargin: '600px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [loadFeed]);

  const working = Object.entries(live).filter(([, v]) => v && (v.status === 'queued' || v.status === 'analyzing'));

  async function download(clip: Clip) {
    const rec = await latestExportForClip(clip.projectId, clip._id);
    if (!rec) {
      setError('That render isn’t available here — open the clip and render it again.');
      return;
    }
    await downloadLocalFile(rec.opfsPath, exportFileName(clip.title || 'clip', rec.quality, rec.format));
  }

  // Selection only holds clips still in the list (filters, deletes).
  useEffect(() => {
    setSelected((cur) => {
      if (!cur) return cur;
      const live = new Set(items.map((c) => c._id));
      const next = new Set([...cur].filter((id) => live.has(id)));
      return next.size === cur.size ? cur : next;
    });
  }, [items]);

  function toggleSelect(id: string) {
    setSelected((cur) => {
      const next = new Set(cur ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function applyStyle(look: ClipLookPatch) {
    if (!selected?.size) return;
    setStyleBusy(true);
    setStyleError('');
    try {
      await styleClips([...selected], look);
      setStyling(false);
    } catch (err) {
      setStyleError(errorMessage(err, 'Couldn’t apply that style'));
    } finally {
      setStyleBusy(false);
    }
  }

  async function deleteSelected() {
    if (!selected?.size) return;
    if (!window.confirm(`Delete ${selected.size} clip${selected.size === 1 ? '' : 's'}?`)) return;
    try {
      await removeClips([...selected]);
      setSelected(new Set());
    } catch (err) {
      setError(errorMessage(err, 'Couldn’t delete those clips'));
    }
  }

  async function remove(clip: Clip) {
    if (!window.confirm(`Delete “${clip.title || 'this clip'}”?`)) return;
    await removeClip(clip._id).catch((e) => setError(errorMessage(e, 'Couldn’t delete the clip')));
  }

  return (
    <div className="clips-page clips-library-page">
      <div className="clips-library-glow clips-library-glow-a" aria-hidden="true" />
      <div className="clips-library-glow clips-library-glow-b" aria-hidden="true" />

      <header className="clips-library-hero">
        <div className="clips-library-hero-copy">
          <div className="clips-library-kicker"><Sparkles size={14} aria-hidden="true" /> Content library</div>
          <h1>Viral Clips</h1>
          <p>Find, refine, and publish the strongest moments from every long-form video.</p>
          <div className="clips-library-benefits" aria-label="Viral Clips benefits">
            <span><Check size={13} /> AI-ranked highlights</span>
            <span><Check size={13} /> Caption-ready</span>
            <span><Check size={13} /> Built for every platform</span>
          </div>
        </div>
        <Link to="/clips" className="btn primary clips-library-create">
          <Sparkles size={17} aria-hidden="true" />
          Create Viral Clips
          <ArrowRight size={17} aria-hidden="true" />
        </Link>
      </header>

      <section className="clips-library-toolbar" aria-label="Clip library controls">
        <div className="clips-library-sort">
          <span className="clips-library-control-label">Sort by</span>
          <div className="clip-seg" role="radiogroup" aria-label="Sort clips">
            <button
              type="button"
              role="radio"
              aria-checked={feed.sort === 'score'}
              className={`clip-seg-btn${feed.sort === 'score' ? ' is-on' : ''}`}
              onClick={() => setFeedFilter({ sort: 'score' })}
            >
              <Trophy size={15} aria-hidden="true" /> Best moments
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={feed.sort === 'recent'}
              className={`clip-seg-btn${feed.sort === 'recent' ? ' is-on' : ''}`}
              onClick={() => setFeedFilter({ sort: 'recent' })}
            >
              <Clock3 size={15} aria-hidden="true" /> Newest
            </button>
          </div>
        </div>
        <div className="clips-library-toolbar-end">
          <label className="clips-library-rendered">
            <input
              type="checkbox"
              checked={feed.rendered}
              onChange={(e) => setFeedFilter({ rendered: e.target.checked })}
            />
            <span className="clips-library-switch" aria-hidden="true"><span /></span>
            <span><strong>Rendered only</strong><small>Ready to download</small></span>
          </label>
          {items.length > 0 && !selected && (
            <button type="button" className="btn ghost clips-head-btn" onClick={() => setSelected(new Set())}>
              <ListChecks size={16} aria-hidden="true" />
              Select clips
            </button>
          )}
        </div>
      </section>

      {selected && (
        <ClipBulkBar
          total={items.length}
          selectedCount={selected.size}
          onToggleAll={() =>
            setSelected(selected.size === items.length ? new Set() : new Set(items.map((c) => c._id)))
          }
          onStyle={() => setStyling(true)}
          onDelete={() => void deleteSelected()}
          onDone={() => setSelected(null)}
        />
      )}

      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}

      {working.length > 0 && (
        <div className="clips-working clips-library-working" role="status">
          {working.map(([pid, v]) => (
            <Link key={pid} to={`/clips/${pid}`} className="clips-working-item">
              <span className="clips-spinner" aria-hidden="true" />
              {v?.message || 'Finding clips…'} {v?.percent ? `${Math.round(v.percent)}%` : ''}
            </Link>
          ))}
        </div>
      )}

      {items.length > 0 ? (
        <section className="clips-library-results" aria-label="Your Viral Clips">
          <header>
            <div>
              <h2>Your clips</h2>
              <p>{items.length} {items.length === 1 ? 'moment' : 'moments'} ready to review</p>
            </div>
            <span>{feed.sort === 'score' ? 'Strongest first' : 'Newest first'}</span>
          </header>
          <ClipGrid
            clips={items}
            showProject
            renders={renders}
            selected={selected ?? undefined}
            onToggleSelect={(c) => toggleSelect(c._id)}
            onOpen={(c) => navigate(`/clips/${c.projectId}/${c._id}`)}
            onEditCaptions={(c) => openEditor.open(c.projectId, c)}
            onDownload={(c) => void download(c)}
            onDelete={(c) => void remove(c)}
          />
        </section>
      ) : (
        !feed.loading && (
          <section className="clips-library-empty">
            <div className="clips-library-empty-copy">
              <span className="clips-library-empty-label"><Film size={14} /> Your clip library</span>
              <h2>{feed.rendered ? 'Nothing rendered yet.' : 'Your best moments are waiting.'}</h2>
              <p>
                {feed.rendered
                  ? 'Your clips are still here. Show the full library, then render any moment when it is ready to publish.'
                  : 'Bring a podcast, interview, stream, or vlog. Viral Clips finds the hooks, reframes the speaker, and styles the captions for you.'}
              </p>
              <div className="clips-library-empty-actions">
                {feed.rendered ? (
                  <button type="button" className="btn primary" onClick={() => setFeedFilter({ rendered: false })}>
                    Show all clips <ArrowRight size={16} aria-hidden="true" />
                  </button>
                ) : (
                  <Link to="/clips" className="btn primary">
                    <UploadCloud size={17} aria-hidden="true" /> Create your first clips
                  </Link>
                )}
                <Link to="/projects/upload" className="btn ghost">Open caption editor</Link>
              </div>
              <div className="clips-library-empty-note">
                <Check size={14} aria-hidden="true" /> Works best with videos that have at least one minute of speech.
              </div>
            </div>

            <div className="clips-library-preview" aria-hidden="true">
              <div className="clips-library-preview-card clips-library-preview-back-a">
                <img src="/media/virsl-creator-man.jpg" alt="" loading="lazy" />
                <span>00:28</span>
              </div>
              <div className="clips-library-preview-card clips-library-preview-back-b">
                <img src="/media/virsl-creator-woman.jpg" alt="" loading="lazy" />
                <span>00:41</span>
              </div>
              <div className="clips-library-preview-card clips-library-preview-main">
                <img src="/media/virsl-creator-woman.jpg" alt="" loading="eager" />
                <div className="clips-library-preview-top">
                  <span><Sparkles size={12} /> 94 score</span>
                  <span>9:16</span>
                </div>
                <div className="clips-library-preview-caption">
                  Turn one long story into<br /><strong>moments people remember.</strong>
                </div>
                <span className="clips-library-preview-play"><Play size={18} fill="currentColor" /></span>
                <div className="clips-library-preview-wave">
                  {[12, 22, 15, 31, 20, 36, 18, 27, 14, 23, 10, 19].map((height, index) => (
                    <span key={index} style={{ height }} />
                  ))}
                </div>
              </div>
              <div className="clips-library-preview-chip"><Sparkles size={13} /> AI finds the hook</div>
            </div>
          </section>
        )
      )}
      {styling && selected && (
        <ClipStyleSheet
          title={`Style & format ${selected.size} clip${selected.size === 1 ? '' : 's'}`}
          note="The selected clips get what you pick. You can still change one clip on its own page."
          count={selected.size}
          busy={styleBusy}
          error={styleError}
          onApply={(look) => void applyStyle(look)}
          onClose={() => {
            setStyling(false);
            setStyleError('');
          }}
        />
      )}
      <div ref={sentinel} className="clips-sentinel" aria-hidden="true" />
      {feed.loading && <p className="clips-loading">Loading…</p>}
      {openEditor.dialog}
    </div>
  );
}
