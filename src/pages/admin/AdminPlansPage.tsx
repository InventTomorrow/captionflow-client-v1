import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useAuthStore } from '../../stores/authStore';

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
  limits: {
    minutesPerMonth: number;
    maxExportQuality: string;
    maxFileSizeGb: number;
    maxProjects: number;
    bulkUpload: boolean;
    priorityProcessing: boolean;
    brandKits: boolean;
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
};

export function AdminPlansPage() {
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === 'admin';
  const [plans, setPlans] = useState<Plan[]>([]);
  const [editing, setEditing] = useState<Partial<Plan> | null>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

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
        });
      }
      setMsg('Saved');
      setEditing(null);
      await load();
    } catch (e: unknown) {
      setError((e as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Save failed');
    }
  }

  async function archive(id: string) {
    await api.delete(`/admin/plans/${id}`);
    await load();
  }

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1>Packages</h1>
          <p className="muted">Free / Creator / Studio and custom plans</p>
        </div>
        {isAdmin && (
          <button
            type="button"
            className="btn primary"
            onClick={() =>
              setEditing({
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

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Slug</th>
              <th>Monthly</th>
              <th>Minutes</th>
              <th>Quality</th>
              <th>Active</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {plans.map((p) => (
              <tr key={p._id}>
                <td>{p.name}</td>
                <td>{p.slug}</td>
                <td>PKR {p.priceMonthlyPkr}</td>
                <td>{p.limits.minutesPerMonth}</td>
                <td>{p.limits.maxExportQuality}</td>
                <td>{p.isActive ? 'Yes' : 'No'}</td>
                <td className="admin-actions">
                  {isAdmin && (
                    <>
                      <button type="button" className="btn ghost" onClick={() => setEditing(p)}>
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
          <h2>{editing._id ? 'Edit plan' : 'New plan'}</h2>
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
            <label>
              Max quality
              <select
                value={editing.limits?.maxExportQuality || '1080p'}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    limits: { ...emptyLimits, ...editing.limits!, maxExportQuality: e.target.value },
                  })
                }
              >
                <option value="720p">720p</option>
                <option value="1080p">1080p</option>
                <option value="2K">2K</option>
                <option value="4K">4K</option>
              </select>
            </label>
          </div>
          <div className="admin-actions">
            <button type="button" className="btn primary" onClick={() => void save()}>
              Save
            </button>
            <button type="button" className="btn ghost" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
