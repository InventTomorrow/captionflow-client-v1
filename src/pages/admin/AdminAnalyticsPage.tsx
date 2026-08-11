import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { KpiCard } from '../../components/admin/KpiCard';

type Point = { date: string; value: number };
type CostOverview = {
  usage: { whisperSeconds: number; gptInputTokens: number; gptOutputTokens: number };
  cost: { whisperCostUsd: number; gptCostUsd: number; totalCostUsd: number; totalCostPkr: number };
  mrrPkr: number;
  profitPkr: number;
  days: number;
};

export function AdminAnalyticsPage() {
  const [metric, setMetric] = useState('signups');
  const [points, setPoints] = useState<Point[]>([]);
  const [overview, setOverview] = useState<Record<string, number> | null>(null);
  const [costs, setCosts] = useState<CostOverview | null>(null);
  const [msg, setMsg] = useState('');

  async function load() {
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const [ts, ov, cs] = await Promise.all([
      api.get('/admin/stats/timeseries', { params: { metric, from, to } }),
      api.get('/admin/stats/overview'),
      api.get('/admin/analytics/costs', { params: { days: 30 } }),
    ]);
    setPoints(ts.data.points);
    setOverview(ov.data);
    setCosts(cs.data);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metric]);

  async function rollup() {
    await api.post('/admin/analytics/rollup', {});
    setMsg('Rollup ran for today');
    await load();
  }

  const max = Math.max(1, ...points.map((p) => p.value));

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1>Analytics</h1>
          <p className="muted">Daily rollups and growth metrics</p>
        </div>
        <button type="button" className="btn" onClick={() => void rollup()}>
          Run rollup now
        </button>
      </div>
      {msg && <div className="admin-success">{msg}</div>}
      {overview && (
        <div className="admin-kpi-grid">
          <KpiCard label="MRR (PKR)" value={overview.mrrPkr?.toLocaleString?.() ?? overview.mrrPkr} />
          <KpiCard label="Paid subs" value={overview.activePaidSubscriptions} />
          <KpiCard label="Users" value={overview.totalUsers} />
          <KpiCard label="Minutes (periods)" value={overview.minutesProcessedCurrentPeriods} />
        </div>
      )}
      {costs && (
        <>
          <h2 className="admin-subhead">API cost &amp; profit — last {costs.days} days</h2>
          <p className="muted">
            Cost is computed from raw usage at today&apos;s rates (Admin → System → API cost
            assumptions). Profit = current MRR minus that cost, a rough monthly approximation, not
            real accounting.
          </p>
          <div className="admin-kpi-grid">
            <KpiCard label="Whisper minutes" value={(costs.usage.whisperSeconds / 60).toFixed(1)} />
            <KpiCard
              label="GPT tokens (in/out)"
              value={`${costs.usage.gptInputTokens.toLocaleString()} / ${costs.usage.gptOutputTokens.toLocaleString()}`}
            />
            <KpiCard label="API cost (USD)" value={`$${costs.cost.totalCostUsd.toFixed(2)}`} />
            <KpiCard label="API cost (PKR)" value={costs.cost.totalCostPkr.toLocaleString()} />
            <KpiCard
              label="Profit (PKR, MRR − cost)"
              value={costs.profitPkr.toLocaleString()}
            />
          </div>
        </>
      )}
      <div className="admin-toolbar">
        <select value={metric} onChange={(e) => setMetric(e.target.value)}>
          <option value="signups">Signups</option>
          <option value="activations">Activations</option>
          <option value="minutes">Minutes</option>
          <option value="exports">Exports</option>
          <option value="mrr">MRR</option>
        </select>
      </div>
      <div className="admin-chart">
        {points.length === 0 ? (
          <p className="muted">No rollup data yet — run rollup or wait for the hourly job.</p>
        ) : (
          <div className="admin-bars">
            {points.map((p) => (
              <div key={p.date} className="admin-bar-col" title={`${p.date}: ${p.value}`}>
                <div className="admin-bar" style={{ height: `${(p.value / max) * 100}%` }} />
                <span>{p.date.slice(5)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
