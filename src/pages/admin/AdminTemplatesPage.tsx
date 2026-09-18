import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuthStore } from '../../stores/authStore';
import { useFlagsStore } from '../../stores/flagsStore';
import { AdminSelect } from '../../components/admin/AdminSelect';
import { KpiCard } from '../../components/admin/KpiCard';
import { Pager } from '../../components/admin/Pager';
import { TemplateCard } from '../../components/TemplateCard';
import {
  arrangeTemplates,
  matchTemplateKey,
  TEMPLATE_CATALOG,
  templateByKey,
  type ArrangedTemplate,
} from '../../lib/templateCatalog';

/**
 * Admin → Templates: the export log (one row per finished export), the most
 * used templates, and the template order every creator sees in the editor.
 */

const PERIODS = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: '365', label: 'Last 12 months' },
  { value: '0', label: 'All time' },
];

type StatRow = { key: string; exports: number; users: number; projects: number; lastExportAt: string };

type StatsResponse = {
  days: number;
  templates: StatRow[];
  customExports: number;
  totals: { exports: number; users: number; projects: number };
  layout: { order: string[]; hidden: string[]; updatedAt?: string } | null;
  /** Exported projects from before the log existed, grouped by look. */
  unlogged: Array<{ style: Record<string, string | null>; projects: number }>;
};

type ExportRow = {
  id: string;
  exportedAt: string;
  user: { id: string; name?: string; email?: string } | null;
  projectName: string;
  templateKey: string;
  template: string;
  quality: string;
  format: string;
  durationSec?: number;
  backfilled: boolean;
};

const LOG_PAGE_SIZE = 25;

function templateName(key: string) {
  if (!key) return 'Custom style';
  return templateByKey(key)?.name ?? key;
}

function formatLength(sec?: number) {
  if (!sec) return '-';
  const s = Math.round(sec);
  return s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

export function AdminTemplatesPage() {
  const isAdmin = useAuthStore((s) => s.user?.role) === 'admin';
  const reloadFlags = useFlagsStore((s) => s.reload);
  const [period, setPeriod] = useState('30');
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [statsKey, setStatsKey] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // ---- stats (+ one-time logging of exports from before the log existed)
  const backfillTried = useRef(false);
  useEffect(() => {
    let cancelled = false;
    api
      .get<StatsResponse>('/admin/templates/stats', { params: { days: period } })
      .then(async ({ data }) => {
        if (cancelled) return;
        setStats(data);
        if (!isAdmin || backfillTried.current || !data.unlogged.length) return;
        backfillTried.current = true;
        const matches = data.unlogged.map((g) => ({
          style: g.style,
          key: matchTemplateKey(g.style as Parameters<typeof matchTemplateKey>[0]) ?? null,
        }));
        const { data: result } = await api.post<{ logged: number }>('/admin/templates/backfill', { matches });
        if (cancelled || !result.logged) return;
        setNotice(
          `Added ${result.logged} earlier ${result.logged === 1 ? 'export' : 'exports'} to the log (finished before the log started; template matched from each video's style).`,
        );
        setStatsKey((k) => k + 1);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.response?.data?.message || 'Failed to load template stats');
      });
    return () => {
      cancelled = true;
    };
  }, [period, statsKey, isAdmin]);

  // ---- export log
  const [logTemplate, setLogTemplate] = useState('');
  const [logPage, setLogPage] = useState(1);
  const [log, setLog] = useState<{ total: number; exports: ExportRow[] } | null>(null);
  const [logLoading, setLogLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLogLoading(true);
    api
      .get('/admin/templates/exports', {
        params: { days: period, template: logTemplate || undefined, page: logPage, limit: LOG_PAGE_SIZE },
      })
      .then(({ data }) => {
        if (!cancelled) setLog(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.response?.data?.message || 'Failed to load the export log');
      })
      .finally(() => {
        if (!cancelled) setLogLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [period, logTemplate, logPage, statsKey]);

  // ---- picker order (working copy until saved)
  const savedLayout = stats?.layout ?? null;
  const saved = useMemo(() => arrangeTemplates(savedLayout), [savedLayout]);
  const [draft, setDraft] = useState<ArrangedTemplate[] | null>(null);
  const cards = draft ?? saved;
  const dirty =
    draft != null &&
    (!sameList(
      draft.map((t) => t.key),
      saved.map((t) => t.key),
    ) ||
      !sameList(
        draft.map((t) => String(t.hidden)),
        saved.map((t) => String(t.hidden)),
      ));
  const [saving, setSaving] = useState(false);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const usageByKey = useMemo(() => new Map((stats?.templates ?? []).map((r) => [r.key, r])), [stats]);

  const edit = useCallback(
    (change: (list: ArrangedTemplate[]) => ArrangedTemplate[]) => setDraft((d) => change(d ?? saved)),
    [saved],
  );

  function moveTo(key: string, index: number) {
    edit((list) => {
      const from = list.findIndex((t) => t.key === key);
      if (from < 0 || from === index) return list;
      const next = [...list];
      const [item] = next.splice(from, 1);
      next.splice(Math.max(0, Math.min(next.length, index)), 0, item);
      return next;
    });
  }

  function toggleHidden(key: string) {
    edit((list) => list.map((t) => (t.key === key ? { ...t, hidden: !t.hidden } : t)));
  }

  function sortByUse() {
    const rank = (key: string) => usageByKey.get(key)?.exports ?? 0;
    edit((list) =>
      [...list].sort((a, b) => Number(a.hidden) - Number(b.hidden) || rank(b.key) - rank(a.key)),
    );
  }

  async function saveOrder() {
    if (!draft) return;
    setSaving(true);
    setError('');
    try {
      const layout = { order: draft.map((t) => t.key), hidden: draft.filter((t) => t.hidden).map((t) => t.key) };
      await api.put('/admin/templates/layout', layout);
      // Show the saved order straight away (the stats reload below confirms it).
      setStats((s) => (s ? { ...s, layout } : s));
      setDraft(null);
      setNotice('Template order saved. Creators see it the next time they open the editor.');
      setStatsKey((k) => k + 1);
      void reloadFlags();
    } catch (e: unknown) {
      setError((e as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const top = (stats?.templates ?? []).slice(0, 10);
  const topMax = Math.max(1, ...top.map((r) => r.exports));
  const periodLabel = PERIODS.find((p) => p.value === period)?.label.toLowerCase() ?? '';
  const logOptions = useMemo(
    () => [
      { value: '', label: 'All templates' },
      ...TEMPLATE_CATALOG.map((t) => ({ value: t.key, label: t.name })),
      { value: 'custom', label: 'Custom style' },
    ],
    [],
  );
  const visibleCount = cards.filter((t) => !t.hidden).length;

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1>Templates</h1>
          <p className="muted">What creators export with, and the template order they see in the editor.</p>
        </div>
        <AdminSelect
          ariaLabel="Period"
          value={period}
          options={PERIODS}
          onChange={(v) => {
            setPeriod(v);
            setLogPage(1);
          }}
        />
      </div>
      {notice && <div className="admin-success">{notice}</div>}
      {error && <div className="error-banner">{error}</div>}

      <div className="admin-kpi-grid">
        <KpiCard label="Exports" value={stats ? stats.totals.exports.toLocaleString() : '…'} hint={periodLabel} />
        <KpiCard label="Creators exporting" value={stats ? stats.totals.users.toLocaleString() : '…'} />
        <KpiCard
          label="Templates used"
          value={stats ? stats.templates.length.toLocaleString() : '…'}
          hint={`of ${TEMPLATE_CATALOG.length} templates`}
        />
        <KpiCard
          label="Most used"
          value={top[0] ? templateName(top[0].key) : '-'}
          hint={top[0] ? `${top[0].exports.toLocaleString()} exports` : undefined}
        />
      </div>

      <section className="admin-chart-card admin-chart-wide">
        <div className="admin-chart-card-head">
          <h2>Top 10 templates</h2>
          <span className="muted tiny">
            Ranked by exports · {periodLabel}
            {stats?.customExports
              ? ` · ${stats.customExports.toLocaleString()} ${stats.customExports === 1 ? 'export' : 'exports'} used a custom style`
              : ''}
          </span>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table template-rank-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Template</th>
                <th>Exports</th>
                <th>Creators</th>
                <th>Videos</th>
                <th>Last export</th>
              </tr>
            </thead>
            <tbody>
              {top.map((r, i) => (
                <tr key={r.key}>
                  <td className="template-rank">{i + 1}</td>
                  <td>
                    <div className="template-rank-name">
                      <strong>{templateName(r.key)}</strong>
                      <code>{r.key}</code>
                    </div>
                    <div className="bar-list-track">
                      <div style={{ width: `${(r.exports / topMax) * 100}%` }} />
                    </div>
                  </td>
                  <td>{r.exports.toLocaleString()}</td>
                  <td>{r.users.toLocaleString()}</td>
                  <td>{r.projects.toLocaleString()}</td>
                  <td>{formatWhen(r.lastExportAt)}</td>
                </tr>
              ))}
              {stats && !top.length && (
                <tr>
                  <td colSpan={6} className="admin-empty">
                    No exports with a template {period === '0' ? 'yet' : `in the ${periodLabel}`}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="admin-chart-card admin-chart-wide">
        <div className="admin-chart-card-head">
          <h2>Export log</h2>
          <AdminSelect
            ariaLabel="Template"
            value={logTemplate}
            options={logOptions}
            onChange={(v) => {
              setLogTemplate(v);
              setLogPage(1);
            }}
          />
        </div>
        <p className="muted tiny">
          {log ? `${log.total.toLocaleString()} ${log.total === 1 ? 'export' : 'exports'}` : '…'} · every finished
          export, newest first
        </p>
        <div className={`admin-table-wrap${logLoading ? ' is-loading' : ''}`}>
          <table className="admin-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Creator</th>
                <th>Video</th>
                <th>Template</th>
                <th>Quality</th>
                <th>Length</th>
              </tr>
            </thead>
            <tbody>
              {log?.exports.map((row) => (
                <tr key={row.id}>
                  <td>
                    {formatWhen(row.exportedAt)}
                    {row.backfilled && <div className="muted tiny">from before the log</div>}
                  </td>
                  <td>
                    {row.user ? <Link to={`/admin/users/${row.user.id}`}>{row.user.name || row.user.email}</Link> : '-'}
                    {row.user?.email && <div className="muted tiny">{row.user.email}</div>}
                  </td>
                  <td className="template-log-video">{row.projectName || '-'}</td>
                  <td>
                    <strong>{templateName(row.templateKey)}</strong>
                    {row.templateKey && <div className="muted tiny">{row.templateKey}</div>}
                  </td>
                  <td>
                    {row.quality || '-'}
                    {row.format && <span className="muted"> · {row.format.toUpperCase()}</span>}
                  </td>
                  <td>{formatLength(row.durationSec)}</td>
                </tr>
              ))}
              {log && !log.exports.length && (
                <tr>
                  <td colSpan={6} className="admin-empty">
                    No exports match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pager
          page={logPage}
          pages={Math.max(1, Math.ceil((log?.total ?? 0) / LOG_PAGE_SIZE))}
          onPage={setLogPage}
        />
      </section>

      <section className="admin-chart-card admin-chart-wide">
        <div className="admin-chart-card-head">
          <div>
            <h2>Template order</h2>
            <p className="muted tiny">
              The order every creator sees in the editor&apos;s Templates panel ({visibleCount} shown). Drag a card
              or use the arrows; hidden templates stay out of the editor.
            </p>
          </div>
          {isAdmin && (
            <div className="admin-actions">
              <button type="button" className="btn ghost" onClick={sortByUse} disabled={!stats}>
                Sort by most used
              </button>
              <button type="button" className="btn ghost" onClick={() => setDraft(arrangeTemplates(null))}>
                Reset to default
              </button>
              {dirty && (
                <button type="button" className="btn ghost" onClick={() => setDraft(null)}>
                  Discard
                </button>
              )}
              <button type="button" className="btn primary" onClick={() => void saveOrder()} disabled={!dirty || saving}>
                {saving ? 'Saving…' : 'Save order'}
              </button>
            </div>
          )}
        </div>
        {dirty && <p className="template-order-dirty">Unsaved changes - creators still see the saved order.</p>}
        <ol className="template-order-grid">
          {cards.map((t, i) => {
            const usage = usageByKey.get(t.key);
            return (
              <li
                key={t.key}
                className={`template-tile${t.hidden ? ' is-hidden' : ''}${dragKey === t.key ? ' is-dragging' : ''}${
                  dropIndex === i && dragKey && dragKey !== t.key ? ' is-drop-target' : ''
                }`}
                draggable={isAdmin}
                onDragStart={(e) => {
                  setDragKey(t.key);
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', t.key);
                }}
                onDragOver={(e) => {
                  if (!dragKey) return;
                  e.preventDefault();
                  if (dropIndex !== i) setDropIndex(i);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragKey) moveTo(dragKey, i);
                  setDragKey(null);
                  setDropIndex(null);
                }}
                onDragEnd={() => {
                  setDragKey(null);
                  setDropIndex(null);
                }}
              >
                <div className="template-tile-bar">
                  <span className="template-tile-pos">{i + 1}</span>
                  <span className="template-tile-name">
                    {t.name}
                    <small>
                      {usage ? `${usage.exports.toLocaleString()} ${usage.exports === 1 ? 'export' : 'exports'}` : 'No exports'}
                    </small>
                  </span>
                  {isAdmin && (
                    <span className="template-tile-grip" aria-hidden="true">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                        <circle cx="9" cy="6" r="1.6" />
                        <circle cx="15" cy="6" r="1.6" />
                        <circle cx="9" cy="12" r="1.6" />
                        <circle cx="15" cy="12" r="1.6" />
                        <circle cx="9" cy="18" r="1.6" />
                        <circle cx="15" cy="18" r="1.6" />
                      </svg>
                    </span>
                  )}
                </div>
                <div className="template-tile-card templates-list" aria-hidden="true">
                  <TemplateCard t={t} isActive={false} onApply={() => undefined} />
                </div>
                {isAdmin && (
                  <div className="template-tile-actions">
                    <button
                      type="button"
                      className="btn ghost"
                      aria-label={`Move ${t.name} up`}
                      disabled={i === 0}
                      onClick={() => moveTo(t.key, i - 1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="btn ghost"
                      aria-label={`Move ${t.name} down`}
                      disabled={i === cards.length - 1}
                      onClick={() => moveTo(t.key, i + 1)}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className={`btn ghost template-tile-toggle${t.hidden ? ' is-off' : ''}`}
                      aria-pressed={!t.hidden}
                      onClick={() => toggleHidden(t.key)}
                    >
                      {t.hidden ? 'Hidden' : 'Shown'}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
