import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useAuthStore } from '../../stores/authStore';

export function AdminSystemPage() {
  const isAdmin = useAuthStore((s) => s.user?.role) === 'admin';
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [flags, setFlags] = useState({
    projectsListEnabled: false,
    export4kEnabled: true,
    exportsEnabled: true,
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
  const [launchOffer, setLaunchOffer] = useState({ enabled: false, text: '' });
  const [bankTransfer, setBankTransfer] = useState({
    accountTitle: '',
    bankName: '',
    accountNumber: '',
    whatsappNumber: '',
    instructions: [] as string[],
  });
  const [msg, setMsg] = useState('');

  useEffect(() => {
    void Promise.all([api.get('/admin/system/health'), api.get('/admin/system/flags')]).then(
      ([h, f]) => {
        setHealth(h.data);
        if (f.data.flags) setFlags({ ...flags, ...f.data.flags });
        if (f.data.defaultPlanSlug) setDefaultPlanSlug(f.data.defaultPlanSlug);
        if (f.data.apiPricing) setApiPricing({ ...apiPricing, ...f.data.apiPricing });
        if (f.data.launchOffer) setLaunchOffer({ ...launchOffer, ...f.data.launchOffer });
        if (f.data.bankTransfer) setBankTransfer({ ...bankTransfer, ...f.data.bankTransfer });
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    await api.patch('/admin/system/flags', { flags, defaultPlanSlug, apiPricing, launchOffer, bankTransfer });
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
                  ['exportsEnabled', 'Exports enabled (site-wide)'],
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
        <section className="admin-card">
          <h2>Launch offer banner</h2>
          <p className="muted">Dismissible bar shown above the nav on the landing page.</p>
          {!isAdmin ? (
            <p className="muted">Support can view; only admins edit.</p>
          ) : (
            <>
              <label className="admin-check">
                <input
                  type="checkbox"
                  checked={launchOffer.enabled}
                  onChange={(e) => setLaunchOffer({ ...launchOffer, enabled: e.target.checked })}
                />
                Banner enabled
              </label>
              <label>
                Banner text
                <input
                  value={launchOffer.text}
                  onChange={(e) => setLaunchOffer({ ...launchOffer, text: e.target.value })}
                  placeholder="Launch offer — get the Starter plan at 50% off. Offer ends today."
                />
              </label>
              <button type="button" className="btn primary" onClick={() => void save()}>
                Save banner
              </button>
            </>
          )}
        </section>
        <section className="admin-card">
          <h2>Manual payment (bank transfer)</h2>
          <p className="muted">Shown on the landing page Day Pass section so buyers can pay and send proof.</p>
          {!isAdmin ? (
            <p className="muted">Support can view; only admins edit.</p>
          ) : (
            <>
              <label>
                Account title
                <input
                  value={bankTransfer.accountTitle}
                  onChange={(e) => setBankTransfer({ ...bankTransfer, accountTitle: e.target.value })}
                />
              </label>
              <label>
                Bank name
                <input
                  value={bankTransfer.bankName}
                  onChange={(e) => setBankTransfer({ ...bankTransfer, bankName: e.target.value })}
                />
              </label>
              <label>
                Account number
                <input
                  value={bankTransfer.accountNumber}
                  onChange={(e) => setBankTransfer({ ...bankTransfer, accountNumber: e.target.value })}
                />
              </label>
              <label>
                WhatsApp number (digits only, with country code, e.g. 923001234567)
                <input
                  value={bankTransfer.whatsappNumber}
                  onChange={(e) => setBankTransfer({ ...bankTransfer, whatsappNumber: e.target.value })}
                />
              </label>
              <label>
                Instructions (one step per line)
                <textarea
                  rows={4}
                  value={bankTransfer.instructions.join('\n')}
                  onChange={(e) =>
                    setBankTransfer({
                      ...bankTransfer,
                      instructions: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean),
                    })
                  }
                />
              </label>
              <button type="button" className="btn primary" onClick={() => void save()}>
                Save payment details
              </button>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
