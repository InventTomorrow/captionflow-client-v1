import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useAuthStore } from '../../stores/authStore';
import { AdminSelect } from '../../components/admin/AdminSelect';

/** Slug of the free trial's plan record (server TRIAL_PLAN_SLUG). The free trial is not a plan. */
const TRIAL_PLAN_SLUG = 'starter';

const QUALITY_OPTIONS = [
  { value: '720p', label: '720p' },
  { value: '1080p', label: '1080p' },
  { value: '2K', label: '2K' },
  { value: '4K', label: '4K' },
];

type Plan = {
  _id: string;
  slug: string;
  name: string;
  description?: string;
  priceMonthlyPkr: number;
  priceYearlyPkr: number;
  isActive: boolean;
  sortOrder: number;
  features: string[];
  isOneTime?: boolean;
  durationDays?: number;
  discountPercent?: number;
  discountActive?: boolean;
  limits: {
    minutesPerMonth: number;
    maxExportQuality: string;
    maxFileSizeGb: number;
    maxProjects: number;
    bulkUpload: boolean;
    priorityProcessing: boolean;
    brandKits: boolean;
    exportEnabled: boolean;
  };
};

const emptyLimits = {
  minutesPerMonth: 60,
  maxExportQuality: '1080p',
  maxFileSizeGb: 1,
  maxProjects: 50,
  bulkUpload: false,
  priorityProcessing: false,
  brandKits: false,
  exportEnabled: true,
};

export function AdminPlansPage() {
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === 'admin';
  const [plans, setPlans] = useState<Plan[]>([]);
  const [editing, setEditing] = useState<Partial<Plan> | null>(null);
  // Snapshot of `editing` as of the last open/save, so we can tell a real
  // unsaved edit apart from just re-opening the same plan. Previously
  // clicking "New plan"/"Edit" on another row, or "Cancel", silently
  // discarded whatever was typed with no warning — easy way to lose a
  // plan you thought you'd already saved.
  const [editingSnapshot, setEditingSnapshot] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  function openEditor(next: Partial<Plan> | null) {
    if (editing && JSON.stringify(editing) !== editingSnapshot) {
      if (!window.confirm('Discard unsaved changes to this plan?')) return;
    }
    setEditing(next);
    setEditingSnapshot(next ? JSON.stringify(next) : null);
  }

  async function load() {
    const { data } = await api.get('/admin/plans', { params: { all: 1 } });
    setPlans(data.plans);
  }

  useEffect(() => {
    void load().catch((e) => setError(e?.response?.data?.message || 'Failed'));
  }, []);

  async function save() {
    if (!editing || !isAdmin) return;
    setError('');
    try {
      if (editing._id) {
        await api.patch(`/admin/plans/${editing._id}`, {
          name: editing.name,
          description: editing.description,
          priceMonthlyPkr: Number(editing.priceMonthlyPkr),
          priceYearlyPkr: Number(editing.priceYearlyPkr),
          sortOrder: Number(editing.sortOrder || 0),
          isActive: editing.isActive,
          features: editing.features,
          limits: editing.limits,
          isOneTime: Boolean(editing.isOneTime),
          durationDays: editing.isOneTime ? Number(editing.durationDays || 0) || undefined : undefined,
          discountPercent: Number(editing.discountPercent || 0) || undefined,
          discountActive: Boolean(editing.discountActive),
        });
      } else {
        await api.post('/admin/plans', {
          slug: editing.slug,
          name: editing.name,
          description: editing.description,
          priceMonthlyPkr: Number(editing.priceMonthlyPkr),
          priceYearlyPkr: Number(editing.priceYearlyPkr),
          sortOrder: Number(editing.sortOrder || 0),
          features: editing.features || [],
          limits: editing.limits || emptyLimits,
          isOneTime: Boolean(editing.isOneTime),
          durationDays: editing.isOneTime ? Number(editing.durationDays || 0) || undefined : undefined,
          discountPercent: Number(editing.discountPercent || 0) || undefined,
          discountActive: Boolean(editing.discountActive),
        });
      }
      setMsg('Saved');
      setEditing(null);
      setEditingSnapshot(null);
      await load();
    } catch (e: unknown) {
      setError((e as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Save failed');
    }
  }

  async function archive(id: string) {
    await api.delete(`/admin/plans/${id}`);
    await load();
  }

  const trial = plans.find((p) => p.slug === TRIAL_PLAN_SLUG);
  const paidPlans = plans.filter((p) => p.slug !== TRIAL_PLAN_SLUG);
  const editingTrial = editing?.slug === TRIAL_PLAN_SLUG && Boolean(editing._id);

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1>Packages</h1>
          <p className="muted">Plans people buy or are given. The free trial is not a plan - its limits are below.</p>
        </div>
        {isAdmin && (
          <button
            type="button"
            className="btn primary"
            onClick={() =>
              openEditor({
                slug: 'custom',
                name: 'Custom',
                priceMonthlyPkr: 0,
                priceYearlyPkr: 0,
                sortOrder: 10,
                features: [],
                limits: { ...emptyLimits },
                isActive: true,
              })
            }
          >
            New plan
          </button>
        )}
      </div>
      {msg && <div className="admin-success">{msg}</div>}
      {error && <div className="error-banner">{error}</div>}

      {trial && (
        <section className="admin-card admin-trial-card">
          <div>
            <h2>Free trial</h2>
            <p className="muted">
              Every new account starts here. {trial.limits.minutesPerMonth} caption minutes, up to{' '}
              {trial.limits.maxExportQuality}, export {trial.limits.exportEnabled === false ? 'off' : 'on'}.
            </p>
          </div>
          {isAdmin && (
            <button type="button" className="btn ghost" onClick={() => openEditor(trial)}>
              Edit trial limits
            </button>
          )}
        </section>
      )}

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Slug</th>
              <th>Type</th>
              <th>Price</th>
              <th>Minutes</th>
              <th>Quality</th>
              <th>Export</th>
              <th>Discount</th>
              <th>Active</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {paidPlans.map((p) => (
              <tr key={p._id}>
                <td>{p.name}</td>
                <td>{p.slug}</td>
                <td>{p.isOneTime ? `Day Pass (${p.durationDays || '?'}d)` : 'Subscription'}</td>
                <td>PKR {p.priceMonthlyPkr}</td>
                <td>{p.limits.minutesPerMonth}</td>
                <td>{p.limits.maxExportQuality}</td>
                <td>{p.limits.exportEnabled === false ? 'Disabled' : 'Yes'}</td>
                <td>{p.discountActive && p.discountPercent ? `${p.discountPercent}% off` : '-'}</td>
                <td>{p.isActive ? 'Yes' : 'No'}</td>
                <td className="admin-actions">
                  {isAdmin && (
                    <>
                      <button type="button" className="btn ghost" onClick={() => openEditor(p)}>
                        Edit
                      </button>
                      {p.isActive && (
                        <button type="button" className="btn ghost" onClick={() => void archive(p._id)}>
                          Archive
                        </button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && isAdmin && (
        <div className="admin-card" style={{ marginTop: '1.25rem' }}>
          <h2>{editingTrial ? 'Edit free trial' : editing._id ? 'Edit plan' : 'New plan'}</h2>
          {!editing._id && (
            <label>
              Slug
              <input
                value={editing.slug || ''}
                onChange={(e) => setEditing({ ...editing, slug: e.target.value })}
              />
            </label>
          )}
          <label>
            Name
            <input
              value={editing.name || ''}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            />
          </label>
          <label>
            Description
            <input
              value={editing.description || ''}
              onChange={(e) => setEditing({ ...editing, description: e.target.value })}
            />
          </label>
          <div className="admin-inline">
            {!editingTrial && (
              <>
                <label>
                  Monthly PKR
                  <input
                    type="number"
                    value={editing.priceMonthlyPkr ?? 0}
                    onChange={(e) => setEditing({ ...editing, priceMonthlyPkr: Number(e.target.value) })}
                  />
                </label>
                <label>
                  Yearly PKR
                  <input
                    type="number"
                    value={editing.priceYearlyPkr ?? 0}
                    onChange={(e) => setEditing({ ...editing, priceYearlyPkr: Number(e.target.value) })}
                  />
                </label>
              </>
            )}
            <label>
              Minutes / month
              <input
                type="number"
                value={editing.limits?.minutesPerMonth ?? 0}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    limits: { ...emptyLimits, ...editing.limits!, minutesPerMonth: Number(e.target.value) },
                  })
                }
              />
            </label>
            <div className="admin-field">
              <span>Max quality</span>
              <AdminSelect
                ariaLabel="Max quality"
                value={editing.limits?.maxExportQuality || '1080p'}
                options={QUALITY_OPTIONS}
                onChange={(maxExportQuality) =>
                  setEditing({
                    ...editing,
                    limits: { ...emptyLimits, ...editing.limits!, maxExportQuality },
                  })
                }
              />
            </div>
          </div>
          <label className="admin-check">
            <input
              type="checkbox"
              checked={editing.limits?.exportEnabled ?? true}
              onChange={(e) =>
                setEditing({
                  ...editing,
                  limits: { ...emptyLimits, ...editing.limits!, exportEnabled: e.target.checked },
                })
              }
            />
            Export enabled on this plan
          </label>
          <label>
            Features (one per line - shown as checklist bullets)
            <textarea
              rows={4}
              value={(editing.features || []).join('\n')}
              onChange={(e) =>
                setEditing({ ...editing, features: e.target.value.split('\n').map((f) => f.trim()).filter(Boolean) })
              }
            />
          </label>
          {!editingTrial && (
            <>
              <div className="admin-inline">
                <label className="admin-check">
                  <input
                    type="checkbox"
                    checked={Boolean(editing.isOneTime)}
                    onChange={(e) => setEditing({ ...editing, isOneTime: e.target.checked })}
                  />
                  One-time pass (not a recurring subscription)
                </label>
                {editing.isOneTime && (
                  <label>
                    Duration (days)
                    <input
                      type="number"
                      value={editing.durationDays ?? 3}
                      onChange={(e) => setEditing({ ...editing, durationDays: Number(e.target.value) })}
                    />
                  </label>
                )}
              </div>
              <div className="admin-inline">
                <label className="admin-check">
                  <input
                    type="checkbox"
                    checked={Boolean(editing.discountActive)}
                    onChange={(e) => setEditing({ ...editing, discountActive: e.target.checked })}
                  />
                  Discount active
                </label>
                {editing.discountActive && (
                  <label>
                    Discount %
                    <input
                      type="number"
                      min={0}
                      max={95}
                      value={editing.discountPercent ?? 0}
                      onChange={(e) => setEditing({ ...editing, discountPercent: Number(e.target.value) })}
                    />
                  </label>
                )}
              </div>
            </>
          )}
          <div className="admin-actions">
            <button type="button" className="btn primary" onClick={() => void save()}>
              Save
            </button>
            <button type="button" className="btn ghost" onClick={() => openEditor(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
