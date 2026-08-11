import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useAuthStore } from '../../stores/authStore';

type ProjectRow = {
  _id: string;
  name: string;
  status: string;
  errorMessage?: string;
  video?: { duration?: number };
  ownerId?: { name?: string; email?: string };
  updatedAt?: string;
};

export function AdminProjectsPage() {
  const isAdmin = useAuthStore((s) => s.user?.role) === 'admin';
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  async function load() {
    const { data } = await api.get('/admin/projects', {
      params: { status: status || undefined, limit: 50 },
    });
    setProjects(data.projects);
  }

  useEffect(() => {
    void load().catch((e) => setError(e?.response?.data?.message || 'Failed'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function retry(id: string) {
    await api.post(`/admin/projects/${id}/retry`);
    await load();
  }

  async function remove(id: string) {
    if (!confirm('Delete this project?')) return;
    await api.delete(`/admin/projects/${id}`);
    await load();
  }

  return (
    <div className="admin-page">
      <h1>Jobs / Projects</h1>
      <p className="muted">Cross-user project operations</p>
      <div className="admin-toolbar">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="error">Error</option>
          <option value="processing">Processing</option>
          <option value="ready">Ready</option>
          <option value="done">Done</option>
        </select>
        <button type="button" className="btn primary" onClick={() => void load()}>
          Refresh
        </button>
      </div>
      {error && <div className="error-banner">{error}</div>}
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Owner</th>
              <th>Status</th>
              <th>Duration</th>
              <th>Error</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p._id}>
                <td>{p.name}</td>
                <td>
                  {p.ownerId?.name}
                  <div className="muted" style={{ fontSize: '0.75rem' }}>
                    {p.ownerId?.email}
                  </div>
                </td>
                <td>{p.status}</td>
                <td>{p.video?.duration ? `${Math.round(p.video.duration / 60)} min` : '—'}</td>
                <td className="muted" style={{ maxWidth: 220 }}>
                  {p.errorMessage || '—'}
                </td>
                <td className="admin-actions">
                  {(p.status === 'error' || p.status === 'partial_error') && (
                    <button type="button" className="btn ghost" onClick={() => void retry(p._id)}>
                      Retry
                    </button>
                  )}
                  {isAdmin && (
                    <button type="button" className="btn ghost" onClick={() => void remove(p._id)}>
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
