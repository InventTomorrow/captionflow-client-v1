import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { KpiCard } from '../../components/admin/KpiCard';

type Overview = {
  totalUsers: number;
  activeUsers: number;
  suspendedUsers: number;
  activeSubscriptions: number;
  activePaidSubscriptions: number;
  mrrPkr: number;
  minutesProcessedCurrentPeriods: number;
  uploadsToday: number;
  failedJobs30d: number;
  queueBacklog: number;
};

export function AdminDashboardPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    void api
      .get('/admin/stats/overview')
      .then((r) => setData(r.data))
      .catch((e) => setError(e?.response?.data?.message || 'Failed to load stats'));
  }, []);

  if (error) return <div className="error-banner">{error}</div>;
  if (!data) return <div className="center">Loading dashboard…</div>;

  return (
    <div className="admin-page">
      <h1>Dashboard</h1>
      <p className="muted">Live ops snapshot for Asaan Caption</p>
      <div className="admin-kpi-grid">
        <KpiCard label="Total users" value={data.totalUsers} hint={`${data.activeUsers} active`} />
        <KpiCard label="Active subscriptions" value={data.activeSubscriptions} />
        <KpiCard label="MRR (PKR)" value={data.mrrPkr.toLocaleString()} hint={`${data.activePaidSubscriptions} paid`} />
        <KpiCard label="Minutes (current periods)" value={data.minutesProcessedCurrentPeriods} />
        <KpiCard label="Uploads today" value={data.uploadsToday} />
        <KpiCard label="Failed jobs (30d)" value={data.failedJobs30d} />
        <KpiCard label="Queue backlog" value={data.queueBacklog} />
        <KpiCard label="Suspended" value={data.suspendedUsers} />
      </div>
    </div>
  );
}
