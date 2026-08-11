import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';

type Row = {
  id: string;
  name: string;
  email: string;
  plan?: string;
  status?: string;
  role?: string;
  projectsCount?: number;
  minutesUsed?: number;
  createdAt?: string;
};

export function AdminUsersPage() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [users, setUsers] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/admin/users', {
        params: { q: q || undefined, status: status || undefined, limit: 50 },
      });
      setUsers(data.users);
      setTotal(data.total);
    } catch (e: unknown) {
      setError((e as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="admin-page">
      <h1>Users</h1>
      <p className="muted">{total} accounts</p>
      <div className="admin-toolbar">
        <input
          placeholder="Search name or email"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void load()}
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
        <button type="button" className="btn primary" onClick={() => void load()}>
          Search
        </button>
      </div>
      {error && <div className="error-banner">{error}</div>}
      {loading ? (
        <div className="center">Loading…</div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Plan</th>
                <th>Status</th>
                <th>Role</th>
                <th>Minutes</th>
                <th>Projects</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <Link to={`/admin/users/${u.id}`}>{u.name}</Link>
                  </td>
                  <td>{u.email}</td>
                  <td>{u.plan || '—'}</td>
                  <td>
                    <span className={`admin-badge ${u.status}`}>{u.status}</span>
                  </td>
                  <td>{u.role}</td>
                  <td>{u.minutesUsed?.toFixed?.(1) ?? u.minutesUsed ?? 0}</td>
                  <td>{u.projectsCount ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
