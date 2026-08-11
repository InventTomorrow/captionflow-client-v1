import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

type Sub = {
  _id: string;
  status: string;
  billingInterval: string;
  currentPeriodEnd: string;
  source: string;
  userId?: { name?: string; email?: string };
  planId?: { name?: string; slug?: string; priceMonthlyPkr?: number };
};

export function AdminSubscriptionsPage() {
  const [subs, setSubs] = useState<Sub[]>([]);
  const [status, setStatus] = useState('');
  const [expiring, setExpiring] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setError('');
    try {
      const { data } = await api.get('/admin/subscriptions', {
        params: {
          status: status || undefined,
          expiring: expiring ? 1 : undefined,
          limit: 50,
        },
      });
      setSubs(data.subscriptions);
    } catch (e: unknown) {
      setError((e as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed');
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function setSubStatus(id: string, next: string) {
    await api.patch(`/admin/subscriptions/${id}`, { status: next });
    await load();
  }

  return (
    <div className="admin-page">
      <h1>Subscriptions</h1>
      <p className="muted">Manual and checkout-backed subscriptions</p>
      <div className="admin-toolbar">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option>
          <option value="active">Active</option>
          <option value="past_due">Past due</option>
          <option value="canceled">Canceled</option>
          <option value="expired">Expired</option>
        </select>
        <label className="admin-check">
          <input type="checkbox" checked={expiring} onChange={(e) => setExpiring(e.target.checked)} />
          Expiring in 7 days
        </label>
        <button type="button" className="btn primary" onClick={() => void load()}>
          Filter
        </button>
      </div>
      {error && <div className="error-banner">{error}</div>}
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Plan</th>
              <th>Status</th>
              <th>Interval</th>
              <th>Period end</th>
              <th>Source</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {subs.map((s) => (
              <tr key={s._id}>
                <td>
                  {s.userId?.name}
                  <div className="muted" style={{ fontSize: '0.75rem' }}>
                    {s.userId?.email}
                  </div>
                </td>
                <td>{s.planId?.name || '—'}</td>
                <td>
                  <span className={`admin-badge ${s.status}`}>{s.status}</span>
                </td>
                <td>{s.billingInterval}</td>
                <td>{s.currentPeriodEnd ? new Date(s.currentPeriodEnd).toLocaleDateString() : '—'}</td>
                <td>{s.source}</td>
                <td className="admin-actions">
                  {s.status === 'active' && (
                    <button type="button" className="btn ghost" onClick={() => void setSubStatus(s._id, 'canceled')}>
                      Cancel
                    </button>
                  )}
                  {s.status !== 'active' && (
                    <button type="button" className="btn ghost" onClick={() => void setSubStatus(s._id, 'active')}>
                      Activate
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
