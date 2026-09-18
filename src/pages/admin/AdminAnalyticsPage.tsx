import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { KpiCard } from '../../components/admin/KpiCard';
import { AdminSelect } from '../../components/admin/AdminSelect';
import { TimeChart, type ChartPoint, type ChartSeries } from '../../components/admin/Charts';
import { bucketPoints, CHART_COLORS, PERIOD_OPTIONS, type PeriodValue } from '../../components/admin/chartUtils';
import type { ChartsResponse, Overview } from './AdminDashboardPage';

type CostOverview = {
  usage: { whisperSeconds: number; gptInputTokens: number; gptOutputTokens: number };
  cost: { whisperCostUsd: number; gptCostUsd: number; totalCostUsd: number; totalCostPkr: number };
  mrrPkr: number;
  profitPkr: number;
  days: number;
  daily: Array<{ date: string; totalCostUsd: number }>;
};

const METRICS: Array<{ value: string; label: string; series: ChartSeries; integer?: boolean; unit?: string }> = [
  { value: 'signups', label: 'Sign-ups', series: { key: 'signups', label: 'Sign-ups', color: CHART_COLORS.accent, kind: 'bar' } },
  {
    value: 'activeCreators',
    label: 'Creators uploading',
    series: { key: 'activeCreators', label: 'Creators uploading', color: CHART_COLORS.blue, kind: 'bar' },
  },
  { value: 'uploads', label: 'Uploads', series: { key: 'uploads', label: 'Uploads', color: CHART_COLORS.blue, kind: 'bar' } },
  {
    value: 'uploadMinutes',
    label: 'Video minutes uploaded',
    integer: false,
    unit: ' min',
    series: { key: 'uploadMinutes', label: 'Minutes', color: CHART_COLORS.violet, kind: 'area' },
  },
  { value: 'exports', label: 'Exports', series: { key: 'exports', label: 'Exports', color: CHART_COLORS.accent, kind: 'bar' } },
  {
    value: 'activePlans',
    label: 'Active plans',
    series: { key: 'activePlans', label: 'Active plans', color: CHART_COLORS.accent, kind: 'area' },
  },
  { value: 'planSales', label: 'Plans sold', series: { key: 'planSales', label: 'Plans sold', color: CHART_COLORS.amber, kind: 'bar' } },
  {
    value: 'planSalesPkr',
    label: 'Plan sales (PKR)',
    series: { key: 'planSalesPkr', label: 'Sales (PKR, list price)', color: CHART_COLORS.amber, kind: 'bar' },
  },
];

/** Every day in the last `days` days (UTC dates, as the cost rollup stores them). */
function lastDays(days: number) {
  const out: string[] = [];
  const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  for (let i = days - 1; i >= 0; i--) out.push(new Date(today - i * 86_400_000).toISOString().slice(0, 10));
  return out;
}

export function AdminAnalyticsPage() {
  const [metric, setMetric] = useState('signups');
  const [period, setPeriod] = useState<PeriodValue>('30');
  const [charts, setCharts] = useState<ChartsResponse | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [costs, setCosts] = useState<CostOverview | null>(null);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  async function loadCosts(days: string) {
    const [ov, cs] = await Promise.all([
      api.get('/admin/stats/overview'),
      api.get('/admin/analytics/costs', { params: { days } }),
    ]);
    setOverview(ov.data);
    setCosts(cs.data);
  }

  useEffect(() => {
    let cancelled = false;
    setError('');
    void Promise.all([
      api.get('/admin/stats/charts', { params: { days: period } }),
      api.get('/admin/stats/overview'),
      api.get('/admin/analytics/costs', { params: { days: period } }),
    ])
      .then(([ch, ov, cs]) => {
        if (cancelled) return;
        setCharts(ch.data);
        setOverview(ov.data);
        setCosts(cs.data);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.response?.data?.message || 'Failed to load analytics');
      });
    return () => {
      cancelled = true;
    };
  }, [period]);

  async function rollup() {
    await api.post('/admin/analytics/rollup', {});
    setMsg('Rollup ran for today');
    await loadCosts(period);
  }

  const weekly = Number(period) > 90;
  const growthPoints = useMemo(
    () => (charts ? bucketPoints(charts.points, weekly ? 7 : 1, ['activePlans']) : []),
    [charts, weekly],
  );
  const costPoints = useMemo<ChartPoint[]>(() => {
    if (!costs) return [];
    const byDate = new Map(costs.daily.map((d) => [d.date, d.totalCostUsd]));
    const daily = lastDays(costs.days).map((date) => ({ date, costUsd: byDate.get(date) ?? 0 }));
    return bucketPoints(daily, weekly ? 7 : 1);
  }, [costs, weekly]);
  const chosen = METRICS.find((m) => m.value === metric) ?? METRICS[0];
  const formatMetric = (n: number) =>
    metric === 'planSalesPkr'
      ? `PKR ${Math.round(n).toLocaleString()}`
      : `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })}${chosen.unit ?? ''}`;

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1>Analytics</h1>
          <p className="muted">Growth, API cost and profit</p>
        </div>
        <div className="admin-actions">
          <AdminSelect ariaLabel="Period" value={period} options={PERIOD_OPTIONS} onChange={setPeriod} />
          <button type="button" className="btn" onClick={() => void rollup()}>
            Run rollup now
          </button>
        </div>
      </div>
      {msg && <div className="admin-success">{msg}</div>}
      {error && <div className="error-banner">{error}</div>}
      {overview && (
        <div className="admin-kpi-grid">
          <KpiCard label="MRR (PKR)" value={overview.mrrPkr.toLocaleString()} hint="Subscriptions at list price" />
          <KpiCard label="Active plans" value={overview.activePlans.toLocaleString()} hint="Free trial not included" />
          <KpiCard label="Users" value={overview.totalUsers.toLocaleString()} hint={`${overview.trialUsers.toLocaleString()} on free trial`} />
          <KpiCard label="Minutes used (current periods)" value={overview.minutesProcessedCurrentPeriods} />
        </div>
      )}

      <section className="admin-chart-card admin-chart-wide">
        <div className="admin-chart-card-head">
          <h2>Growth</h2>
          <AdminSelect
            ariaLabel="Metric"
            value={metric}
            options={METRICS.map(({ value, label }) => ({ value, label }))}
            onChange={setMetric}
          />
        </div>
        {charts ? (
          <TimeChart
            points={growthPoints}
            series={[chosen.series]}
            integer={chosen.integer ?? true}
            format={formatMetric}
            bucketLabel={weekly ? 'Week of' : undefined}
            height={260}
          />
        ) : (
          <div className="chart-loading" style={{ height: 260 }} />
        )}
      </section>

      {costs && (
        <>
          <h2 className="admin-subhead">API cost &amp; profit - {PERIOD_OPTIONS.find((p) => p.value === period)?.label.toLowerCase()}</h2>
          <p className="muted">
            Cost is computed from raw usage at today&apos;s rates (Admin → System → API cost assumptions). Profit =
            current MRR minus that cost, a rough monthly approximation, not real accounting. Days before the daily
            rollup ran show no cost.
          </p>
          <div className="admin-kpi-grid">
            <KpiCard label="Transcription minutes" value={(costs.usage.whisperSeconds / 60).toFixed(1)} />
            <KpiCard
              label="GPT tokens (in/out)"
              value={`${costs.usage.gptInputTokens.toLocaleString()} / ${costs.usage.gptOutputTokens.toLocaleString()}`}
            />
            <KpiCard label="API cost (USD)" value={`$${costs.cost.totalCostUsd.toFixed(2)}`} />
            <KpiCard label="API cost (PKR)" value={costs.cost.totalCostPkr.toLocaleString()} />
            <KpiCard label="Profit (PKR, MRR − cost)" value={costs.profitPkr.toLocaleString()} />
          </div>
          <section className="admin-chart-card admin-chart-wide">
            <h2>API cost per day</h2>
            <TimeChart
              points={costPoints}
              integer={false}
              format={(n) => `$${n.toFixed(2)}`}
              bucketLabel={weekly ? 'Week of' : undefined}
              series={[{ key: 'costUsd', label: 'Cost (USD)', color: CHART_COLORS.pink, kind: 'bar' }]}
              legendValues={{ costUsd: `$${costs.cost.totalCostUsd.toFixed(2)}` }}
            />
          </section>
        </>
      )}
    </div>
  );
}
