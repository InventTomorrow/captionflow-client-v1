/**
 * /clips — every clip of the user, across projects: best-scored first (or
 * newest), filterable to rendered ones, loaded a page at a time as the user
 * scrolls. Hover/tap a card to watch it with captions; Edit opens the clip.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ClipGrid } from '../../components/clips/ClipGrid';
import { errorMessage } from '../../lib/api';
import { downloadLocalFile, exportFileName } from '../../lib/export/clientExport';
import { latestExportForClip } from '../../lib/media/localMedia';
import { useClipsStore } from '../../stores/clipsStore';
import type { Clip } from '../../lib/clips/api';

export function ClipsGalleryPage() {
  const navigate = useNavigate();
  const feed = useClipsStore((s) => s.feed);
  const live = useClipsStore((s) => s.live);
  const renders = useClipsStore((s) => s.renders);
  const loadFeed = useClipsStore((s) => s.loadFeed);
  const setFeedFilter = useClipsStore((s) => s.setFeedFilter);
  const removeClip = useClipsStore((s) => s.removeClip);
  const [error, setError] = useState('');
  const sentinel = useRef<HTMLDivElement | null>(null);

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
      setError('That render isn’t on this device — open the clip and render it here.');
      return;
    }
    await downloadLocalFile(rec.opfsPath, exportFileName(clip.title || 'clip', rec.quality, rec.format));
  }

  async function remove(clip: Clip) {
    if (!window.confirm(`Delete “${clip.title || 'this clip'}”?`)) return;
    await removeClip(clip._id).catch((e) => setError(errorMessage(e, 'Couldn’t delete the clip')));
  }

  return (
    <div className="clips-page">
      <header className="clips-head">
        <div>
          <h1>Clips</h1>
          <p className="clips-sub">Short vertical moments picked from your videos, ready to post.</p>
        </div>
        <Link to="/clips/new" className="btn primary clips-cta">
          New clips
        </Link>
      </header>

      <div className="clips-filters" role="toolbar" aria-label="Filter clips">
        <div className="clip-seg" role="radiogroup" aria-label="Sort">
          {(['score', 'recent'] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={feed.sort === s}
              className={`clip-seg-btn${feed.sort === s ? ' is-on' : ''}`}
              onClick={() => setFeedFilter({ sort: s })}
            >
              {s === 'score' ? 'Best' : 'Newest'}
            </button>
          ))}
        </div>
        <label className="clips-check">
          <input type="checkbox" checked={feed.rendered} onChange={(e) => setFeedFilter({ rendered: e.target.checked })} />
          Rendered only
        </label>
      </div>

      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}

      {working.length > 0 && (
        <div className="clips-working" role="status">
          {working.map(([pid, v]) => (
            <Link key={pid} to={`/clips/${pid}`} className="clips-working-item">
              <span className="clips-spinner" aria-hidden="true" />
              {v?.message || 'Finding clips…'} {v?.percent ? `${Math.round(v.percent)}%` : ''}
            </Link>
          ))}
        </div>
      )}

      {feed.items.length > 0 ? (
        <ClipGrid
          clips={feed.items}
          showProject
          renders={renders}
          onOpen={(c) => navigate(`/clips/${c.projectId}/${c._id}`)}
          onDownload={(c) => void download(c)}
          onDelete={(c) => void remove(c)}
        />
      ) : (
        !feed.loading && (
          <div className="clips-empty">
            <p>{feed.rendered ? 'No rendered clips yet.' : 'No clips yet.'}</p>
            <p className="clips-sub">
              Upload a long video, or open a captioned video and choose <strong>Find clips</strong>.
            </p>
            <Link to="/clips/new" className="btn primary">
              Upload a video
            </Link>
          </div>
        )
      )}
      <div ref={sentinel} className="clips-sentinel" aria-hidden="true" />
      {feed.loading && <p className="clips-loading">Loading…</p>}
    </div>
  );
}
