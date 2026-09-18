import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { CHART_COLORS, shortDate } from './chartUtils';

/** Admin charts: plain SVG sized to its container, no chart library. */

export interface ChartSeries {
  key: string;
  label: string;
  color: string;
  kind?: 'bar' | 'line' | 'area';
}

export type ChartPoint = { date: string } & Record<string, number | string>;

/** Tick step rounded up to 1, 2, 2.5 or 5 × 10ⁿ (whole numbers for counts). */
function niceStep(raw: number, integer: boolean) {
  if (raw <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / exp;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp;
  return integer ? Math.max(1, Math.ceil(step)) : step;
}

function compact(n: number) {
  if (Math.abs(n) >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${+(n / 1_000).toFixed(1)}k`;
  return `${+n.toFixed(2)}`;
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

export function TimeChart({
  points,
  series,
  height = 220,
  integer = true,
  format = (n: number) => n.toLocaleString(),
  legendValues,
  bucketLabel,
}: {
  points: ChartPoint[];
  series: ChartSeries[];
  height?: number;
  /** Whole-number axis (counts). */
  integer?: boolean;
  format?: (n: number) => string;
  /** Shown next to each legend entry (e.g. the period total). */
  legendValues?: Record<string, string>;
  /** Tooltip heading for grouped points, e.g. "Week of". */
  bucketLabel?: string;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const padL = 42;
  const padR = 10;
  const padT = 10;
  const padB = 24;
  const innerW = Math.max(1, width - padL - padR);
  const innerH = height - padT - padB;
  const n = points.length;
  const max = Math.max(0, ...points.flatMap((p) => series.map((s) => Number(p[s.key]) || 0)));
  const step = niceStep(max / 4, integer);
  const yMax = step * 4;
  const slot = innerW / Math.max(1, n);
  const x = (i: number) => padL + slot * (i + 0.5);
  const y = (v: number) => padT + innerH - (Math.max(0, v) / yMax) * innerH;
  const bars = series.filter((s) => s.kind === 'bar');
  const groupW = Math.max(1, Math.min(slot * 0.72, 48));
  const barW = groupW / Math.max(1, bars.length);
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(innerW / 64))));

  const hovered = hover != null ? points[hover] : null;
  const tipLeft = hover != null ? x(hover) : 0;
  const tipOnLeft = tipLeft > width * 0.62;

  return (
    <div className="chart">
      <div className="chart-legend">
        {series.map((s) => (
          <span key={s.key} className="chart-legend-item">
            <i style={{ background: s.color }} />
            {s.label}
            {legendValues?.[s.key] != null && <b>{legendValues[s.key]}</b>}
          </span>
        ))}
      </div>
      <div ref={ref} className="chart-area" style={{ height }}>
        {width > 0 && (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={series.map((s) => s.label).join(', ')}
            onPointerMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const i = Math.floor((e.clientX - rect.left - padL) / slot);
              setHover(n ? Math.min(n - 1, Math.max(0, i)) : null);
            }}
            onPointerLeave={() => setHover(null)}
          >
            {[0, 1, 2, 3, 4].map((t) => (
              <g key={t}>
                <line x1={padL} x2={width - padR} y1={y(step * t)} y2={y(step * t)} className="chart-grid" />
                <text x={padL - 8} y={y(step * t)} className="chart-tick" textAnchor="end" dominantBaseline="middle">
                  {compact(step * t)}
                </text>
              </g>
            ))}
            {points.map((p, i) =>
              i % labelEvery === 0 ? (
                <text key={p.date} x={x(i)} y={height - 6} className="chart-tick" textAnchor="middle">
                  {shortDate(p.date)}
                </text>
              ) : null,
            )}
            {hover != null && <line x1={x(hover)} x2={x(hover)} y1={padT} y2={padT + innerH} className="chart-guide" />}
            {bars.map((s, bi) =>
              points.map((p, i) => {
                const v = Number(p[s.key]) || 0;
                if (v <= 0) return null;
                const top = y(v);
                return (
                  <rect
                    key={`${s.key}-${p.date}`}
                    x={x(i) - groupW / 2 + bi * barW}
                    y={top}
                    width={Math.max(1, barW - (bars.length > 1 ? 1 : 0))}
                    height={Math.max(1, padT + innerH - top)}
                    rx={Math.min(3, barW / 3)}
                    fill={s.color}
                    opacity={hover == null || hover === i ? 1 : 0.55}
                  />
                );
              }),
            )}
            {series
              .filter((s) => s.kind !== 'bar')
              .map((s) => {
                const coords = points.map((p, i) => [x(i), y(Number(p[s.key]) || 0)] as const);
                const line = coords.map(([cx, cy], i) => `${i ? 'L' : 'M'}${cx.toFixed(1)},${cy.toFixed(1)}`).join(' ');
                const base = padT + innerH;
                return (
                  <g key={s.key}>
                    {s.kind === 'area' && coords.length > 1 && (
                      <path
                        d={`${line} L${coords[coords.length - 1][0].toFixed(1)},${base} L${coords[0][0].toFixed(1)},${base} Z`}
                        fill={s.color}
                        opacity={0.14}
                      />
                    )}
                    {coords.length > 1 && <path d={line} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" />}
                    {(coords.length === 1 || hover != null) &&
                      coords.map(([cx, cy], i) =>
                        coords.length === 1 || i === hover ? (
                          <circle key={i} cx={cx} cy={cy} r={3.5} fill={s.color} stroke="var(--card)" strokeWidth={1.5} />
                        ) : null,
                      )}
                  </g>
                );
              })}
          </svg>
        )}
        {hovered && (
          <div
            className="chart-tip"
            style={
              tipOnLeft
                ? { right: width - tipLeft + 10, top: padT }
                : { left: tipLeft + 10, top: padT }
            }
          >
            <strong>
              {bucketLabel ? `${bucketLabel} ` : ''}
              {shortDate(hovered.date)}
            </strong>
            {series.map((s) => (
              <span key={s.key}>
                <i style={{ background: s.color }} />
                {s.label}
                <b>{format(Number(hovered[s.key]) || 0)}</b>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Ranked horizontal bars. */
export function BarList({
  rows,
  color = CHART_COLORS.accent,
  empty,
}: {
  rows: Array<{ id: string; label: ReactNode; sub?: ReactNode; value: number; valueLabel?: string }>;
  color?: string;
  empty: string;
}) {
  if (!rows.length) return <p className="muted chart-empty">{empty}</p>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="bar-list">
      {rows.map((r) => (
        <li key={r.id}>
          <div className="bar-list-head">
            <span className="bar-list-label">
              {r.label}
              {r.sub && <small>{r.sub}</small>}
            </span>
            <b>{r.valueLabel ?? r.value.toLocaleString()}</b>
          </div>
          <div className="bar-list-track">
            <div style={{ width: `${(r.value / max) * 100}%`, background: color }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** One bar split into parts of a whole, with a legend. */
export function SplitBar({ parts }: { parts: Array<{ label: string; value: number; color: string }> }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  return (
    <div className="split-bar">
      <div className="split-bar-track">
        {parts.map((p) =>
          p.value > 0 ? (
            <div key={p.label} style={{ flexGrow: p.value, background: p.color }} title={`${p.label}: ${p.value}`} />
          ) : null,
        )}
      </div>
      <ul className="split-bar-legend">
        {parts.map((p) => (
          <li key={p.label}>
            <i style={{ background: p.color }} />
            {p.label}
            <b>{p.value.toLocaleString()}</b>
            <small>{total ? `${Math.round((p.value / total) * 100)}%` : '0%'}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}
