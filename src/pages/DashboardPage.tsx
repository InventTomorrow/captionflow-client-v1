import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { deleteAllForProject, listAllProjectIds } from '../lib/captionDb';

interface ProjectRow {
  _id: string;
  name: string;
  status: string;
  video?: { duration?: number };
  updatedAt: string;
}

export function DashboardPage() {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    void api
      .get('/projects')
      .then(async (r) => {
        const rows: ProjectRow[] = r.data.projects;
        setProjects(rows);
        // Prune IndexedDB captions for projects that no longer exist server-side
        // (e.g. deleted from another device) — captions are the only thing
        // stored locally, this just prevents them piling up forever.
        const liveIds = new Set(rows.map((p) => p._id));
        const localIds = await listAllProjectIds();
        await Promise.all(
          localIds.filter((pid) => !liveIds.has(pid)).map((pid) => deleteAllForProject(pid)),
        );
      })
      .catch(() => setError('Failed to load projects'));
  }, []);

  async function remove(id: string) {
    if (!confirm('Delete this project and its files?')) return;
    await api.delete(`/projects/${id}`);
    await deleteAllForProject(id);
    setProjects((p) => p.filter((x) => x._id !== id));
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Projects</h1>
          <p className="muted">Upload up to 1GB and generate timed captions</p>
        </div>
        <Link className="btn primary" to="/projects/upload">
          New upload
        </Link>
      </div>
      {error && <div className="error-banner">{error}</div>}
      <div className="project-list">
        {projects.length === 0 && <p className="muted">No projects yet.</p>}
        {projects.map((p) => (
          <div className="project-row" key={p._id}>
            <div>
              <strong>{p.name}</strong>
              <div className="muted">
                {p.status} · {p.video?.duration ? `${Math.round(p.video.duration / 60)} min` : '—'}
              </div>
            </div>
            <div className="row-actions">
              <Link to={`/projects/${p._id}/editor`}>
                {['ready', 'done', 'partial_error'].includes(p.status)
                  ? 'Editor'
                  : p.status === 'uploaded'
                    ? 'Transcribe'
                    : 'Progress'}
              </Link>
              <button type="button" className="btn ghost" onClick={() => void remove(p._id)}>
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
