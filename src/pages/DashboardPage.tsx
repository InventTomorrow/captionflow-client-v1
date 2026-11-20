import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowSquareOut, ClosedCaptioning, FilmStrip, FolderOpen, Plus, Scissors, SquaresFour, Trash } from '@phosphor-icons/react';
import { api } from '../lib/api';
import { deleteAllForProject, listAllProjectIds } from '../lib/captionDb';
import { deleteSource, listExports } from '../lib/media/localMedia';

interface ProjectRow {
  _id: string;
  name: string;
  status: string;
  kind?: 'captions' | 'clips' | 'clip';
  video?: { duration?: number };
  updatedAt: string;
}

export function DashboardPage() {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'captions' | 'clips'>('all');
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});

  useEffect(() => {
    void listExports().then((exports) => {
      const images: Record<string, string> = {};
      for (const item of exports) {
        if (item.thumbnailDataUrl && !images[item.projectId]) images[item.projectId] = item.thumbnailDataUrl;
      }
      setThumbnails(images);
    }).catch(() => undefined);
    void api
      .get('/projects')
      .then(async (r) => {
        const rows: ProjectRow[] = r.data.projects || [];
        setProjects(rows);
        // Best-effort cleanup, kept in its own try/catch: this used to run
        // un-isolated, so an IndexedDB failure here (private browsing,
        // quota, a browser quirk) hit the SAME .catch() below and showed
        // "Failed to load projects" even though the list above had already
        // rendered successfully — misleading the user into thinking nothing
        // loaded.
        try {
          // Prune IndexedDB captions for projects that no longer exist
          // server-side (e.g. deleted from another device) — captions are
          // the only thing stored locally, this just prevents them piling
          // up forever.
          const liveIds = new Set(rows.map((p) => p._id));
          const localIds = await listAllProjectIds();
          await Promise.all(
            localIds.filter((pid) => !liveIds.has(pid)).map((pid) => deleteAllForProject(pid)),
          );
        } catch (err) {
          console.error('Local caption cache cleanup failed', err);
        }
      })
      .catch(() => setError('Failed to load projects'))
      .finally(() => setLoading(false));
  }, []);

  async function remove(id: string) {
    if (!confirm('Delete this project and its files?')) return;
    try {
      await api.delete(`/projects/${id}`);
    } catch (err) {
      console.error('Failed to delete project', err);
      setError('Failed to delete project');
      return;
    }
    // Server delete is the source of truth and already succeeded — the
    // local IndexedDB cleanup is best-effort tidying, not something that
    // should leave the just-deleted project stuck visible in the list if it
    // happens to fail.
    await deleteAllForProject(id).catch((err) => console.error('Local caption cleanup failed', err));
    await deleteSource(id).catch((err) => console.error('Local source cleanup failed', err));
    setProjects((p) => p.filter((x) => x._id !== id));
  }

  const visible = projects.filter((p) => filter === 'all' || (filter === 'clips' ? p.kind === 'clips' : p.kind !== 'clips'));
  return <div className="page creation-projects">
    <div className="page-header"><div><h1>Projects</h1><p className="muted">Your captions and short clips in one place.</p></div><Link className="btn primary" to="/create"><Plus size={16} weight="bold" aria-hidden="true" />New project</Link></div>
    <div className="creation-filters" role="group" aria-label="Filter projects">
      {([['all', 'All', SquaresFour], ['captions', 'Captions', ClosedCaptioning], ['clips', 'Short Clips', FilmStrip]] as const).map(([value, label, Icon]) =>
        <button key={value} type="button" aria-pressed={filter === value} className={filter === value ? 'is-active' : ''} onClick={() => setFilter(value)}><Icon size={16} weight={filter === value ? 'fill' : 'duotone'} aria-hidden="true" />{label}</button>)}
    </div>
    {error && <div className="error-banner" role="alert">{error}</div>}
    {loading ? <p className="muted">Loading projects…</p> : visible.length === 0 ? <div className="creation-project-empty"><FolderOpen size={36} aria-hidden="true" /><p>{filter === 'all' ? 'No projects yet.' : `No ${filter === 'clips' ? 'short clips' : 'caption'} projects yet.`}</p><Link to="/create">Create a project</Link></div> :
      <div className="creation-project-list">{visible.map((p) => {
        const isClips = p.kind === 'clips';
        const href = isClips ? `/clips/${p._id}` : `/projects/${p._id}/editor`;
        return <article className="creation-project-row" key={p._id}>
          <div className="creation-project-thumb" aria-hidden="true">{thumbnails[p._id] ? <img src={thumbnails[p._id]} alt="" /> : isClips ? <Scissors size={22} /> : <ClosedCaptioning size={22} />}</div>
          <div className="creation-project-info"><Link to={href} title={p.name}>{p.name}</Link><span>{isClips ? 'Short Clips' : 'Captions'} · {p.status.replace(/_/g, ' ')}{p.video?.duration ? ` · ${Math.round(p.video.duration / 60)} min` : ''} · {new Date(p.updatedAt).toLocaleDateString()}</span></div>
          <div className="creation-project-actions"><Link to={href} aria-label={`Open ${p.name}`}><ArrowSquareOut size={16} aria-hidden="true" />Open</Link><button type="button" aria-label={`Delete ${p.name}`} onClick={() => void remove(p._id)}><Trash size={16} aria-hidden="true" />Delete</button></div>
        </article>;
      })}</div>}
    {projects.some((p) => p.kind === 'clips') && <p className="creation-library-link"><Link to="/clips/library">Browse individual clips</Link></p>}
  </div>;
}
