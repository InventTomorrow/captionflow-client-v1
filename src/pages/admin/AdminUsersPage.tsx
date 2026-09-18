import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { AdminSelect } from '../../components/admin/AdminSelect';
import { Pager } from '../../components/admin/Pager';
import { useDebounced } from '../../lib/useDebounced';

type Row = {
  id: string;
  name: string;
  email: string;
  /** "Free trial", or the plan's name. */
  planLabel?: string;
  planState?: 'trial' | 'active' | 'ended';
  status?: string;
  role?: string;
  projectsCount?: number;
  minutesUsed?: number;
  createdAt?: string;
};

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
];

const PLAN_OPTIONS = [
  { value: '', label: 'All plans' },
  { value: 'active', label: 'Active plan' },
  { value: 'ended', label: 'Plan ended' },
  { value: 'trial', label: 'Free trial' },
];

const PAGE_SIZE = 50;

export function AdminUsersPage() {
  const [q, setQ] = useState('');
  const search = useDebounced(q.trim());
  const [status, setStatus] = useState('');
  const [plan, setPlan] = useState('');
  const [page, setPage] = useState(1);
  const [users, setUsers] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api
      .get('/admin/users', {
        params: { q: search || undefined, status: status || undefined, plan: plan || undefined, page, limit: PAGE_SIZE },
      })
      .then(({ data }) => {
        if (cancelled) return;
        setUsers(data.users);
        setTotal(data.total);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError((e as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [search, status, plan, page]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Boolean(search || status || plan);

  return (
    <div className="admin-page">
      <h1>Users</h1>
      <p className="muted">
        {total.toLocaleString()} {filtered ? 'matching ' : ''}
        {total === 1 ? 'account' : 'accounts'}
      </p>
      <div className="admin-toolbar">
        <input
          type="search"
          className="admin-search"
          placeholder="Search name or email"
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
        <AdminSelect
          ariaLabel="Plan"
          value={plan}
          options={PLAN_OPTIONS}
          onChange={(v) => {
            setPlan(v);
            setPage(1);
          }}
        />
        {filtered && (
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              setQ('');
              setStatus('');
              setPlan('');
              setPage(1);
            }}
          >
            Clear filters
          </button>
        )}
      </div>
      {error && <div className="error-banner">{error}</div>}
      <div className={`admin-table-wrap${loading ? ' is-loading' : ''}`}>
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
                <td>
                  <span className={`admin-badge plan-${u.planState ?? 'trial'}`}>
                    {u.planLabel || 'Free trial'}
                    {u.planState === 'ended' ? ' (ended)' : ''}
                  </span>
                </td>
                <td>
                  <span className={`admin-badge ${u.status}`}>{u.status}</span>
                </td>
                <td>{u.role}</td>
                <td>{Number(u.minutesUsed ?? 0).toFixed(1)}</td>
                <td>{u.projectsCount ?? 0}</td>
              </tr>
            ))}
            {!loading && !users.length && (
              <tr>
                <td colSpan={7} className="admin-empty">
                  No users match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pager page={page} pages={pages} onPage={setPage} />
    </div>
  );
}
