import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

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
      .then((r) => setProjects(r.data.projects))
      .catch(() => setError('Failed to load projects'));
  }, []);

  async function remove(id: string) {
    if (!confirm('Delete this project and its files?')) return;
    await api.delete(`/projects/${id}`);
    setProjects((p) => p.filter((x) => x._id !== id));
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Projects</h1>
          <p className="muted">Upload up to 5GB and generate timed captions</p>
        </div>
        <Link className="btn primary" to="/upload">
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
