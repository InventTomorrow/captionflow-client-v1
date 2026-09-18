import type { ChartPoint } from './Charts';

export const CHART_COLORS = {
  accent: '#89E900',
  blue: '#5ED2FF',
  amber: '#FFC43D',
  pink: '#FF5FA2',
  violet: '#A78BFA',
  muted: '#8B9099',
} as const;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-09-03" → "Sep 3" */
export function shortDate(iso: string) {
  const [, m, d] = iso.split('-');
  return `${MONTHS[Number(m) - 1] ?? m} ${Number(d)}`;
}

/**
 * Group daily points into `size`-day buckets (long ranges stay readable).
 * Flow values are summed; `levelKeys` (e.g. active plans) keep the bucket's last value.
 */
export function bucketPoints(points: ChartPoint[], size: number, levelKeys: string[] = []): ChartPoint[] {
  if (size <= 1) return points;
  const out: ChartPoint[] = [];
  for (let i = 0; i < points.length; i += size) {
    const group = points.slice(i, i + size);
    const merged: ChartPoint = { date: group[0].date };
    for (const p of group) {
      for (const [k, v] of Object.entries(p)) {
        if (k === 'date' || typeof v !== 'number') continue;
        merged[k] = levelKeys.includes(k) ? v : Number(((Number(merged[k]) || 0) + v).toFixed(2));
      }
    }
    out.push(merged);
  }
  return out;
}

/** Period picker shared by the admin dashboard, analytics and templates pages. */
export const PERIOD_OPTIONS = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: '365', label: 'Last 12 months' },
] as const;

export type PeriodValue = (typeof PERIOD_OPTIONS)[number]['value'];
