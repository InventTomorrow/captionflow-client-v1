import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useAuthStore } from '../../stores/authStore';
import { AdminSelect } from '../../components/admin/AdminSelect';
import { Pager } from '../../components/admin/Pager';
import { useDebounced } from '../../lib/useDebounced';

type ProjectRow = {
  _id: string;
  name: string;
  status: string;
  errorMessage?: string;
  video?: { duration?: number };
  ownerId?: { name?: string; email?: string };
  updatedAt?: string;
};

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'error', label: 'Error' },
  { value: 'partial_error', label: 'Partly failed' },
  { value: 'uploaded', label: 'Uploaded' },
  { value: 'processing', label: 'Processing' },
  { value: 'ready', label: 'Ready' },
  { value: 'exporting', label: 'Exporting' },
  { value: 'done', label: 'Exported' },
];

const PAGE_SIZE = 50;

export function AdminProjectsPage() {
  const isAdmin = useAuthStore((s) => s.user?.role) === 'admin';
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const search = useDebounced(q.trim());
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api
      .get('/admin/projects', {
        params: { status: status || undefined, q: search || undefined, page, limit: PAGE_SIZE },
      })
      .then(({ data }) => {
        if (cancelled) return;
        setProjects(data.projects);
        setTotal(data.total);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.response?.data?.message || 'Failed');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [status, search, page, reloadKey]);

  async function retry(id: string) {
    await api.post(`/admin/projects/${id}/retry`);
    setReloadKey((k) => k + 1);
  }

  async function remove(id: string) {
    if (!confirm('Delete this project?')) return;
    await api.delete(`/admin/projects/${id}`);
    setReloadKey((k) => k + 1);
  }

  return (
    <div className="admin-page">
      <h1>Jobs / Projects</h1>
      <p className="muted">Cross-user project operations - {total.toLocaleString()} projects</p>
      <div className="admin-toolbar">
        <input
          type="search"
          className="admin-search"
          placeholder="Search project name"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        <AdminSelect
          ariaLabel="Status"
          value={status}
          options={STATUS_OPTIONS}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
        />
        <button type="button" className="btn ghost" onClick={() => setReloadKey((k) => k + 1)}>
          Refresh
        </button>
      </div>
      {error && <div className="error-banner">{error}</div>}
      <div className={`admin-table-wrap${loading ? ' is-loading' : ''}`}>
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
                <td>
                  <span className={`admin-badge ${p.status}`}>{p.status.replace('_', ' ')}</span>
                </td>
                <td>{p.video?.duration ? `${Math.round(p.video.duration / 60)} min` : '-'}</td>
                <td className="muted" style={{ maxWidth: 220 }}>
                  {p.errorMessage || '-'}
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
            {!loading && !projects.length && (
              <tr>
                <td colSpan={6} className="admin-empty">
                  No projects match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pager page={page} pages={Math.max(1, Math.ceil(total / PAGE_SIZE))} onPage={setPage} />
    </div>
  );
}
