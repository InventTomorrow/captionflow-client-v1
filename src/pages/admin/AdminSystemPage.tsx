import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useAuthStore } from '../../stores/authStore';

export function AdminSystemPage() {
  const isAdmin = useAuthStore((s) => s.user?.role) === 'admin';
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [flags, setFlags] = useState({
    projectsListEnabled: false,
    export4kEnabled: true,
    maintenanceMode: false,
    maintenanceMessage: '',
  });
  const [defaultPlanSlug, setDefaultPlanSlug] = useState('starter');
  const [apiPricing, setApiPricing] = useState({
    whisperUsdPerMinute: 0.006,
    gptInputUsdPer1k: 0.00015,
    gptOutputUsdPer1k: 0.0006,
    usdToPkr: 280,
  });
  const [msg, setMsg] = useState('');

  useEffect(() => {
    void Promise.all([api.get('/admin/system/health'), api.get('/admin/system/flags')]).then(
      ([h, f]) => {
        setHealth(h.data);
        if (f.data.flags) setFlags({ ...flags, ...f.data.flags });
        if (f.data.defaultPlanSlug) setDefaultPlanSlug(f.data.defaultPlanSlug);
        if (f.data.apiPricing) setApiPricing({ ...apiPricing, ...f.data.apiPricing });
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    await api.patch('/admin/system/flags', { flags, defaultPlanSlug, apiPricing });
    setMsg('Saved');
  }

  return (
    <div className="admin-page">
      <h1>System</h1>
      <p className="muted">Health and feature flags</p>
      {msg && <div className="admin-success">{msg}</div>}

      <div className="admin-cards">
        <section className="admin-card">
          <h2>Health</h2>
          <pre className="admin-pre">{JSON.stringify(health, null, 2)}</pre>
        </section>
        <section className="admin-card">
          <h2>Flags</h2>
          {!isAdmin ? (
            <p className="muted">Support can view health; only admins edit flags.</p>
          ) : (
            <>
              {(
                [
                  ['projectsListEnabled', 'Projects list enabled'],
                  ['export4kEnabled', '4K export enabled'],
                  ['maintenanceMode', 'Maintenance mode'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="admin-check">
                  <input
                    type="checkbox"
                    checked={Boolean(flags[key])}
                    onChange={(e) => setFlags({ ...flags, [key]: e.target.checked })}
                  />
                  {label}
                </label>
              ))}
              <label>
                Maintenance message
                <input
                  value={flags.maintenanceMessage}
                  onChange={(e) => setFlags({ ...flags, maintenanceMessage: e.target.value })}
                />
              </label>
              <label>
                Default plan slug
                <input value={defaultPlanSlug} onChange={(e) => setDefaultPlanSlug(e.target.value)} />
              </label>
              <button type="button" className="btn primary" onClick={() => void save()}>
                Save flags
              </button>
            </>
          )}
        </section>
        <section className="admin-card">
          <h2>API cost assumptions</h2>
          <p className="muted">
            Drives every cost/profit figure on the Analytics page — nothing is frozen at usage
            time, so correcting a rate here immediately corrects past totals too.
          </p>
          {!isAdmin ? (
            <p className="muted">Support can view; only admins edit.</p>
          ) : (
            <>
              <label>
                Whisper — USD per minute of audio
                <input
                  type="number"
                  step="0.0001"
                  value={apiPricing.whisperUsdPerMinute}
                  onChange={(e) =>
                    setApiPricing({ ...apiPricing, whisperUsdPerMinute: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                GPT input — USD per 1,000 tokens
                <input
                  type="number"
                  step="0.00001"
                  value={apiPricing.gptInputUsdPer1k}
                  onChange={(e) =>
                    setApiPricing({ ...apiPricing, gptInputUsdPer1k: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                GPT output — USD per 1,000 tokens
                <input
                  type="number"
                  step="0.00001"
                  value={apiPricing.gptOutputUsdPer1k}
                  onChange={(e) =>
                    setApiPricing({ ...apiPricing, gptOutputUsdPer1k: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                USD → PKR exchange rate
                <input
                  type="number"
                  step="0.1"
                  value={apiPricing.usdToPkr}
                  onChange={(e) => setApiPricing({ ...apiPricing, usdToPkr: Number(e.target.value) })}
                />
              </label>
              <button type="button" className="btn primary" onClick={() => void save()}>
                Save pricing
              </button>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
