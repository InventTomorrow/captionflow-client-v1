import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { KpiCard } from '../../components/admin/KpiCard';
import { AdminSelect } from '../../components/admin/AdminSelect';
import { BarList, SplitBar, TimeChart, type ChartPoint } from '../../components/admin/Charts';
import { bucketPoints, CHART_COLORS, PERIOD_OPTIONS, type PeriodValue } from '../../components/admin/chartUtils';

export type Overview = {
  totalUsers: number;
  activeUsers: number;
  suspendedUsers: number;
  /** Accounts on the free trial (not a plan). */
  trialUsers: number;
  /** Bought or admin-given plans whose period hasn't ended. */
  activePlans: number;
  recurringPlans: number;
  passPlans: number;
  plansByPackage: Array<{ planId: string; name: string; isOneTime: boolean; count: number }>;
  activePaidSubscriptions: number;
  mrrPkr: number;
  minutesProcessedCurrentPeriods: number;
  uploadsToday: number;
  failedJobs30d: number;
  queueBacklog: number;
};

export type ChartsResponse = {
  days: number;
  points: ChartPoint[];
  totals: {
    signups: number;
    uploads: number;
    uploadMinutes: number;
    activeCreators: number;
    exports: number;
    planSales: number;
    planSalesPkr: number;
  };
};

const pkr = (n: number) => `PKR ${Math.round(n).toLocaleString()}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

export function AdminDashboardPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [charts, setCharts] = useState<ChartsResponse | null>(null);
  const [period, setPeriod] = useState<PeriodValue>('30');
  const [error, setError] = useState('');

  useEffect(() => {
    void api
      .get('/admin/stats/overview')
      .then((r) => setData(r.data))
      .catch((e) => setError(e?.response?.data?.message || 'Failed to load stats'));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void api
      .get('/admin/stats/charts', { params: { days: period } })
      .then((r) => {
        if (!cancelled) setCharts(r.data);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.response?.data?.message || 'Failed to load charts');
      });
    return () => {
      cancelled = true;
    };
  }, [period]);

  // A year of daily bars is unreadable: show weeks instead.
  const weekly = Number(period) > 90;
  const points = useMemo(
    () => (charts ? bucketPoints(charts.points, weekly ? 7 : 1, ['activePlans']) : []),
    [charts, weekly],
  );
  const bucketLabel = weekly ? 'Week of' : undefined;
  const periodLabel = PERIOD_OPTIONS.find((p) => p.value === period)?.label.toLowerCase() ?? '';

  if (error && !data) return <div className="error-banner">{error}</div>;
  if (!data) return <div className="center">Loading dashboard…</div>;

  const endedPlans = Math.max(0, data.totalUsers - data.trialUsers - data.activePlans);

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">Live ops snapshot for Asaan Caption</p>
        </div>
        <AdminSelect ariaLabel="Chart period" value={period} options={PERIOD_OPTIONS} onChange={setPeriod} />
      </div>
      {error && <div className="error-banner">{error}</div>}

      <div className="admin-kpi-grid">
        <KpiCard
          label="Total users"
          value={data.totalUsers.toLocaleString()}
          hint={`${data.activeUsers.toLocaleString()} active · ${data.suspendedUsers.toLocaleString()} suspended`}
        />
        <KpiCard
          label="Active plans"
          value={data.activePlans.toLocaleString()}
          hint={`${plural(data.recurringPlans, 'subscription')} · ${plural(data.passPlans, 'pass', 'passes')}`}
        />
        <KpiCard
          label="On free trial"
          value={data.trialUsers.toLocaleString()}
          hint={`${data.totalUsers ? Math.round((data.trialUsers / data.totalUsers) * 100) : 0}% of users - not a plan`}
        />
        <KpiCard label="MRR (PKR)" value={data.mrrPkr.toLocaleString()} hint="Subscriptions at list price" />
        <KpiCard
          label="Plan sales"
          value={charts ? pkr(charts.totals.planSalesPkr) : '…'}
          hint={charts ? `${plural(charts.totals.planSales, 'plan')} · ${periodLabel}` : periodLabel}
        />
        <KpiCard label="Uploads (24h)" value={data.uploadsToday.toLocaleString()} />
        <KpiCard label="Failed jobs (30d)" value={data.failedJobs30d.toLocaleString()} />
        <KpiCard label="Queue backlog" value={data.queueBacklog.toLocaleString()} />
      </div>

      <div className="admin-chart-grid">
        <section className="admin-chart-card">
          <h2>New users</h2>
          {charts ? (
            <TimeChart
              points={points}
              bucketLabel={bucketLabel}
              series={[
                { key: 'signups', label: 'Sign-ups', color: CHART_COLORS.accent, kind: 'bar' },
                { key: 'activeCreators', label: 'Creators uploading', color: CHART_COLORS.blue, kind: 'line' },
              ]}
              legendValues={{
                signups: charts.totals.signups.toLocaleString(),
                activeCreators: charts.totals.activeCreators.toLocaleString(),
              }}
            />
          ) : (
            <div className="chart-loading" />
          )}
        </section>

        <section className="admin-chart-card">
          <h2>Uploads &amp; exports</h2>
          {charts ? (
            <TimeChart
              points={points}
              bucketLabel={bucketLabel}
              series={[
                { key: 'uploads', label: 'Uploads', color: CHART_COLORS.blue, kind: 'bar' },
                { key: 'exports', label: 'Exports', color: CHART_COLORS.accent, kind: 'bar' },
              ]}
              legendValues={{
                uploads: charts.totals.uploads.toLocaleString(),
                exports: charts.totals.exports.toLocaleString(),
              }}
            />
          ) : (
            <div className="chart-loading" />
          )}
        </section>

        <section className="admin-chart-card">
          <h2>Active plans</h2>
          {charts ? (
            <TimeChart
              points={points}
              bucketLabel={bucketLabel}
              series={[{ key: 'activePlans', label: 'Active plans', color: CHART_COLORS.accent, kind: 'area' }]}
              legendValues={{ activePlans: `${data.activePlans.toLocaleString()} now` }}
            />
          ) : (
            <div className="chart-loading" />
          )}
        </section>

        <section className="admin-chart-card">
          <h2>Plan sales</h2>
          {charts ? (
            <TimeChart
              points={points}
              bucketLabel={bucketLabel}
              format={pkr}
              series={[{ key: 'planSalesPkr', label: 'Sales (PKR, list price)', color: CHART_COLORS.amber, kind: 'bar' }]}
              legendValues={{ planSalesPkr: pkr(charts.totals.planSalesPkr) }}
            />
          ) : (
            <div className="chart-loading" />
          )}
        </section>

        <section className="admin-chart-card">
          <h2>Video minutes uploaded</h2>
          {charts ? (
            <TimeChart
              points={points}
              bucketLabel={bucketLabel}
              integer={false}
              format={(n) => `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })} min`}
              series={[{ key: 'uploadMinutes', label: 'Minutes', color: CHART_COLORS.violet, kind: 'area' }]}
              legendValues={{ uploadMinutes: `${charts.totals.uploadMinutes.toLocaleString()} min` }}
            />
          ) : (
            <div className="chart-loading" />
          )}
        </section>

        <section className="admin-chart-card">
          <h2>Accounts</h2>
          <SplitBar
            parts={[
              { label: 'Free trial', value: data.trialUsers, color: CHART_COLORS.muted },
              { label: 'Active plan', value: data.activePlans, color: CHART_COLORS.accent },
              { label: 'Plan ended', value: endedPlans, color: CHART_COLORS.pink },
            ]}
          />
          <h3 className="admin-chart-subhead">Active plans by package</h3>
          <BarList
            empty="No active plans right now."
            rows={data.plansByPackage.map((p) => ({
              id: p.planId,
              label: p.name,
              sub: p.isOneTime ? 'Pass' : 'Subscription',
              value: p.count,
            }))}
          />
        </section>
      </div>
    </div>
  );
}
