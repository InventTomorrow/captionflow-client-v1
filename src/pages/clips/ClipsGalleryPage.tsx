/**
 * /clips — every clip of the user, across projects: best-scored first (or
 * newest), filterable to rendered ones, loaded a page at a time as the user
 * scrolls. Hover/tap a card to watch it with captions; Edit opens the clip.
 * Select picks clips (any videos) for one caption template or a delete.
 */
import { ListChecks } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ClipBulkBar } from '../../components/clips/ClipBulkBar';
import { ClipGrid } from '../../components/clips/ClipGrid';
import { ClipStyleSheet } from '../../components/clips/ClipStyleSheet';
import { clipEditorUrl } from '../../lib/clips/clipMode';
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
  const styleClips = useClipsStore((s) => s.styleClips);
  const removeClips = useClipsStore((s) => s.removeClips);
  const [error, setError] = useState('');
  /** Selection mode: the picked clip ids; null = not selecting. */
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [styling, setStyling] = useState(false);
  const [styleBusy, setStyleBusy] = useState(false);
  const [styleError, setStyleError] = useState('');
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

  // Selection only holds clips still in the list (filters, deletes).
  useEffect(() => {
    setSelected((cur) => {
      if (!cur) return cur;
      const live = new Set(feed.items.map((c) => c._id));
      const next = new Set([...cur].filter((id) => live.has(id)));
      return next.size === cur.size ? cur : next;
    });
  }, [feed.items]);

  function toggleSelect(id: string) {
    setSelected((cur) => {
      const next = new Set(cur ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function applyStyle(templateKey: string | null) {
    if (!selected?.size) return;
    setStyleBusy(true);
    setStyleError('');
    try {
      await styleClips([...selected], { templateKey });
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
        {feed.items.length > 0 && !selected && (
          <button type="button" className="btn ghost clips-head-btn" onClick={() => setSelected(new Set())}>
            <ListChecks size={16} aria-hidden="true" />
            Select
          </button>
        )}
      </div>

      {selected && (
        <ClipBulkBar
          total={feed.items.length}
          selectedCount={selected.size}
          onToggleAll={() =>
            setSelected(selected.size === feed.items.length ? new Set() : new Set(feed.items.map((c) => c._id)))
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
          selected={selected ?? undefined}
          onToggleSelect={(c) => toggleSelect(c._id)}
          onOpen={(c) => navigate(`/clips/${c.projectId}/${c._id}`)}
          onEditCaptions={(c) => navigate(clipEditorUrl(c.projectId, c._id))}
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
      {styling && selected && (
        <ClipStyleSheet
          title={`Style ${selected.size} clip${selected.size === 1 ? '' : 's'}`}
          note="The selected clips get this caption template. You can still change one clip on its own page."
          initialKey={null}
          applyLabel={`Apply to ${selected.size} clip${selected.size === 1 ? '' : 's'}`}
          busy={styleBusy}
          error={styleError}
          onApply={(k) => void applyStyle(k)}
          onClose={() => {
            setStyling(false);
            setStyleError('');
          }}
        />
      )}
      <div ref={sentinel} className="clips-sentinel" aria-hidden="true" />
      {feed.loading && <p className="clips-loading">Loading…</p>}
    </div>
  );
}
