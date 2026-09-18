/**
 * RecentVideos — the user's exported videos, on the upload page.
 *
 * Cards come from the browser's own export store (lib/media/localMedia): the
 * rendered file plus its thumbnail, template, quality and caption language.
 * Clicking a card reopens the project; the menu downloads or deletes the file.
 * Deleting a project's last video also deletes its captions; everything is
 * kept for at most 30 days (lib/media/retention.ts).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { listExports, markExportDownloaded, type LocalExportRecord } from '../lib/media/localMedia';
import { deleteVideo, expireOldLocalMedia, isLastVideoOfProject } from '../lib/media/retention';
import { downloadLocalFile, exportFileName } from '../lib/export/clientExport';

const PREVIEW_COUNT = 8;

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** "Sep 12, 2025 • 2:14 PM" */
function formatWhen(ms: number): string {
  const d = new Date(ms);
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${date} • ${time}`;
}

function displayTitle(title: string): string {
  return title.replace(/\.(mp4|m4v|mov|webm|mkv|avi|flv)$/i, '') || title;
}

function PlayCircleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="m10 8 6 4-6 4Z" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

function DotsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="5" r="1.9" />
      <circle cx="12" cy="12" r="1.9" />
      <circle cx="12" cy="19" r="1.9" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </svg>
  );
}

function VideoCard({
  item,
  busy,
  onDownload,
  onDelete,
}: {
  item: LocalExportRecord;
  busy: boolean;
  onDownload: () => void;
  onDelete: () => void;
}) {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const title = displayTitle(item.title);
  const editorUrl = `/projects/${item.projectId}/editor`;

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  return (
    <li className="rv-card">
      <Link to={editorUrl} className="rv-thumb" aria-label={`Open ${title}`}>
        {item.thumbnailDataUrl ? <img src={item.thumbnailDataUrl} alt="" loading="lazy" /> : null}
        <span className="rv-duration">{formatClock(item.duration)}</span>
      </Link>
      <div className="rv-body">
        <div className="rv-title-row">
          <Link to={editorUrl} className="rv-title" title={title}>
            {title}
          </Link>
          <div className="rv-menu-wrap" ref={menuRef}>
            <button
              type="button"
              className="rv-menu-btn"
              aria-label={`More actions for ${title}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              disabled={busy}
              onClick={() => setMenuOpen((o) => !o)}
            >
              <DotsIcon />
            </button>
            {menuOpen && (
              <div className="rv-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onDownload();
                  }}
                >
                  Download
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    navigate(editorUrl);
                  }}
                >
                  Open in editor
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="danger"
                  onClick={() => {
                    setMenuOpen(false);
                    onDelete();
                  }}
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        </div>
        <p className="rv-date">{formatWhen(item.exportedAt)}</p>
        {item.downloadedAs && (
          <p className="rv-saved" title={`Downloads/${item.downloadedAs}`}>
            <FolderIcon />
            <span>
              Downloads › {item.downloadedAs}
            </span>
          </p>
        )}
      </div>
    </li>
  );
}

export function RecentVideos() {
  const [items, setItems] = useState<LocalExportRecord[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [showAll, setShowAll] = useState(false);

  const refresh = useCallback(async () => {
    try {
      // Videos and captions are kept for at most 30 days (lib/media/retention.ts).
      await expireOldLocalMedia().catch(() => 0);
      setItems(await listExports());
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function download(item: LocalExportRecord) {
    setBusyId(item.id);
    setError('');
    const fileName = exportFileName(item.title, item.quality, item.format);
    try {
      await downloadLocalFile(item.opfsPath, fileName);
      await markExportDownloaded(item.id, fileName).catch(() => undefined);
      setItems((prev) =>
        prev ? prev.map((x) => (x.id === item.id ? { ...x, downloadedAs: fileName, downloadedAt: Date.now() } : x)) : prev,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed');
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function remove(item: LocalExportRecord) {
    const last = await isLastVideoOfProject(item).catch(() => false);
    const question = last
      ? `Delete “${displayTitle(item.title)}” (${item.quality})? Its captions will be deleted too.`
      : `Delete “${displayTitle(item.title)}” (${item.quality})?`;
    if (!window.confirm(question)) return;
    setBusyId(item.id);
    try {
      await deleteVideo(item);
      setItems((prev) => (prev ? prev.filter((x) => x.id !== item.id) : prev));
    } finally {
      setBusyId(null);
    }
  }

  if (items === null) return null;
  const visible = showAll ? items : items.slice(0, PREVIEW_COUNT);

  return (
    <section className="rv-panel" aria-labelledby="rv-title">
      <div className="rv-head">
        <span className="rv-head-icon">
          <PlayCircleIcon />
        </span>
        <div className="rv-head-text">
          <h2 id="rv-title">Recent Videos</h2>
          <p>Continue working on your latest projects</p>
        </div>
        {items.length > PREVIEW_COUNT && (
          <button type="button" className="rv-view-all" onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Show less' : 'View all'}
            <ArrowRightIcon />
          </button>
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}

      {items.length === 0 ? (
        <p className="rv-empty">Your exported videos will show up here.</p>
      ) : (
        <ul className="rv-grid">
          {visible.map((item) => (
            <VideoCard
              key={item.id}
              item={item}
              busy={busyId === item.id}
              onDownload={() => void download(item)}
              onDelete={() => void remove(item)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
