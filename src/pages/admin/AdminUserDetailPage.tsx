import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { AdminSelect } from '../../components/admin/AdminSelect';

/** Slug of the free trial's plan record (server TRIAL_PLAN_SLUG). The free trial is not a plan. */
const TRIAL_PLAN_SLUG = 'starter';

type Plan = {
  _id: string;
  name: string;
  slug: string;
  priceMonthlyPkr: number;
  isActive?: boolean;
  isOneTime?: boolean;
  durationDays?: number;
};

function planOptionLabel(p: Plan) {
  if (p.slug === TRIAL_PLAN_SLUG) return 'Free trial (ends their plan)';
  const price = `PKR ${p.priceMonthlyPkr.toLocaleString()}`;
  return p.isOneTime ? `${p.name} - ${price} (one-time, ${p.durationDays || '?'}d access)` : `${p.name} - ${price}/mo`;
}

export function AdminUserDetailPage() {
  const { id } = useParams();
  const [data, setData] = useState<{
    user: Record<string, unknown>;
    plan: Plan & { limits?: Record<string, unknown> };
    onTrial?: boolean;
    planActive?: boolean;
    planEndsAt?: string;
    usage: Record<string, unknown>;
    projects: Array<Record<string, unknown>>;
  } | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [planId, setPlanId] = useState('');
  const [bonus, setBonus] = useState('10');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  async function load() {
    const [userRes, plansRes] = await Promise.all([
      api.get(`/admin/users/${id}`),
      api.get('/admin/plans', { params: { all: 1 } }),
    ]);
    setData(userRes.data);
    // Plans that can be assigned; the free trial last (choosing it ends the plan).
    const assignable = (plansRes.data.plans as Plan[]).filter((p) => p.isActive !== false);
    const ordered = [
      ...assignable.filter((p) => p.slug !== TRIAL_PLAN_SLUG),
      ...assignable.filter((p) => p.slug === TRIAL_PLAN_SLUG),
    ];
    setPlans(ordered);
    setPlanId(String(userRes.data.user.planId || ordered[0]?._id || ''));
  }

  useEffect(() => {
    void load().catch((e) => setError(e?.response?.data?.message || 'Failed to load'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const selectedIsTrial = plans.find((p) => p._id === planId)?.slug === TRIAL_PLAN_SLUG;

  async function assign() {
    setMsg('');
    setError('');
    try {
      await api.post(`/admin/users/${id}/assign-plan`, { planId, billingInterval: 'manual' });
      setMsg(selectedIsTrial ? 'Moved to the free trial' : 'Plan assigned');
      await load();
    } catch (e: unknown) {
      setError((e as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed');
    }
  }

  async function toggleSuspend() {
    const suspend = data?.user.status !== 'suspended';
    await api.post(`/admin/users/${id}/suspend`, { suspend });
    setMsg(suspend ? 'User suspended' : 'User reactivated');
    await load();
  }

  async function grant() {
    await api.post(`/admin/users/${id}/grant-minutes`, { minutes: Number(bonus) });
    setMsg(`Granted ${bonus} bonus minutes`);
    await load();
  }

  async function forceLogout() {
    await api.post(`/admin/users/${id}/force-logout`);
    setMsg('Sessions cleared');
  }

  if (error && !data) return <div className="error-banner">{error}</div>;
  if (!data) return <div className="center">Loading…</div>;

  const u = data.user;

  return (
    <div className="admin-page">
      <p>
        <Link to="/admin/users">← Users</Link>
      </p>
      <h1>{String(u.name)}</h1>
      <p className="muted">{String(u.email)}</p>
      {msg && <div className="admin-success">{msg}</div>}
      {error && <div className="error-banner">{error}</div>}

      <div className="admin-cards">
        <section className="admin-card">
          <h2>Profile</h2>
          <dl className="admin-dl">
            <dt>Status</dt>
            <dd>
              <span className={`admin-badge ${String(u.status)}`}>{String(u.status)}</span>
            </dd>
            <dt>Role</dt>
            <dd>{String(u.role)}</dd>
            <dt>Plan</dt>
            <dd>
              {data.onTrial
                ? 'Free trial'
                : !data.planActive
                  ? `${data.plan?.name} - ended`
                  : data.planEndsAt
                    ? `${data.plan?.name} - until ${new Date(data.planEndsAt).toLocaleDateString()}`
                    : data.plan?.name}
            </dd>
            <dt>Usage</dt>
            <dd>
              {Number(data.usage.minutesUsed || 0).toFixed(1)} / {String(data.usage.limit)} min
              {Number(data.usage.bonusMinutes || 0) > 0
                ? ` (+${data.usage.bonusMinutes} bonus)`
                : ''}
            </dd>
          </dl>
          <div className="admin-actions">
            <button type="button" className="btn ghost" onClick={() => void toggleSuspend()}>
              {u.status === 'suspended' ? 'Reactivate' : 'Suspend'}
            </button>
            <button type="button" className="btn ghost" onClick={() => void forceLogout()}>
              Force logout
            </button>
          </div>
        </section>

        <section className="admin-card">
          <h2>Assign plan</h2>
          <AdminSelect
            ariaLabel="Plan to assign"
            value={planId}
            onChange={setPlanId}
            options={plans.map((p) => ({ value: p._id, label: planOptionLabel(p) }))}
          />
          <button type="button" className="btn primary" onClick={() => void assign()}>
            {selectedIsTrial ? 'Move to free trial' : 'Assign plan'}
          </button>
          <h3 style={{ marginTop: '1.5rem' }}>Grant bonus minutes</h3>
          <div className="admin-inline">
            <input type="number" value={bonus} onChange={(e) => setBonus(e.target.value)} min={1} />
            <button type="button" className="btn" onClick={() => void grant()}>
              Grant
            </button>
          </div>
        </section>
      </div>

      <section className="admin-card" style={{ marginTop: '1rem' }}>
        <h2>Recent projects</h2>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {data.projects.map((p) => (
                <tr key={String(p._id)}>
                  <td>{String(p.name)}</td>
                  <td>{String(p.status)}</td>
                  <td>
                    {p.video && typeof p.video === 'object' && 'duration' in p.video
                      ? `${Math.round(Number((p.video as { duration?: number }).duration || 0) / 60)} min`
                      : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
