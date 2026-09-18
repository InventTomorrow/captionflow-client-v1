import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { AdminSelect } from '../../components/admin/AdminSelect';
import { Pager } from '../../components/admin/Pager';

type Sub = {
  _id: string;
  status: string;
  billingInterval: string;
  currentPeriodEnd: string;
  source: string;
  userId?: { _id?: string; name?: string; email?: string };
  planId?: { name?: string; slug?: string; priceMonthlyPkr?: number };
};

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'expired', label: 'Expired' },
  { value: 'canceled', label: 'Canceled' },
  { value: 'past_due', label: 'Past due' },
];

const INTERVAL_LABELS: Record<string, string> = { monthly: 'Monthly', yearly: 'Yearly', manual: 'Plan length' };
const SOURCE_LABELS: Record<string, string> = {
  admin: 'Given by admin',
  checkout: 'Checkout',
  webhook: 'Payment',
  migration: 'Sign-up',
};

const PAGE_SIZE = 50;

export function AdminSubscriptionsPage() {
  const [subs, setSubs] = useState<Sub[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('active');
  const [expiring, setExpiring] = useState(false);
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api
      .get('/admin/subscriptions', {
        params: { status: status || undefined, expiring: expiring ? 1 : undefined, page, limit: PAGE_SIZE },
      })
      .then(({ data }) => {
        if (cancelled) return;
        setSubs(data.subscriptions);
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
  }, [status, expiring, page, reloadKey]);

  async function setSubStatus(id: string, next: string) {
    await api.patch(`/admin/subscriptions/${id}`, { status: next });
    setReloadKey((k) => k + 1);
  }

  return (
    <div className="admin-page">
      <h1>Subscriptions</h1>
      <p className="muted">
        Plans people bought or were given - {total.toLocaleString()} {total === 1 ? 'plan' : 'plans'}. Free trials are
        not plans and are not listed.
      </p>
      <div className="admin-toolbar">
        <AdminSelect
          ariaLabel="Status"
          value={expiring ? 'active' : status}
          options={STATUS_OPTIONS}
          disabled={expiring}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
        />
        <label className="admin-check">
          <input
            type="checkbox"
            checked={expiring}
            onChange={(e) => {
              setExpiring(e.target.checked);
              setPage(1);
            }}
          />
          Ending in 7 days
        </label>
      </div>
      {error && <div className="error-banner">{error}</div>}
      <div className={`admin-table-wrap${loading ? ' is-loading' : ''}`}>
        <table className="admin-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Plan</th>
              <th>Status</th>
              <th>Billing</th>
              <th>Period end</th>
              <th>Source</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {subs.map((s) => (
              <tr key={s._id}>
                <td>
                  {s.userId?._id ? <Link to={`/admin/users/${s.userId._id}`}>{s.userId?.name}</Link> : s.userId?.name}
                  <div className="muted" style={{ fontSize: '0.75rem' }}>
                    {s.userId?.email}
                  </div>
                </td>
                <td>{s.planId?.name || '-'}</td>
                <td>
                  <span className={`admin-badge ${s.status}`}>{s.status.replace('_', ' ')}</span>
                </td>
                <td>{INTERVAL_LABELS[s.billingInterval] ?? s.billingInterval}</td>
                <td>{s.currentPeriodEnd ? new Date(s.currentPeriodEnd).toLocaleDateString() : '-'}</td>
                <td>{SOURCE_LABELS[s.source] ?? s.source}</td>
                <td className="admin-actions">
                  {s.status === 'active' && (
                    <button type="button" className="btn ghost" onClick={() => void setSubStatus(s._id, 'canceled')}>
                      Cancel
                    </button>
                  )}
                  {s.status === 'canceled' && (
                    <button type="button" className="btn ghost" onClick={() => void setSubStatus(s._id, 'active')}>
                      Activate
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!loading && !subs.length && (
              <tr>
                <td colSpan={7} className="admin-empty">
                  No plans match these filters.
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
