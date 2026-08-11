import { useEffect, useRef, useState } from 'react';
import { Outlet, Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useEditorChromeStore } from '../stores/editorChromeStore';
import { useFlagsStore } from '../stores/flagsStore';
import { api } from '../lib/api';

function CrownIcon({ crossedOut }: { crossedOut?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 18h16l1.4-9.6-5.4 3.8L12 5l-4 7.2-5.4-3.8L4 18z"
        fill="currentColor"
      />
      <rect x="4" y="19" width="16" height="2" rx="1" fill="currentColor" />
      {crossedOut && (
        <line x1="2.5" y1="3" x2="21.5" y2="21" stroke="#EF4444" strokeWidth="2.4" strokeLinecap="round" />
      )}
    </svg>
  );
}

type UsageInfo = {
  minutesUsed: number;
  bonusMinutes: number;
  limit: number;
  periodEnd: string;
};

export function PlanBadge({
  userId,
  plan,
  planName,
}: {
  userId?: string;
  plan?: string;
  planName?: string;
}) {
  const isFree = !plan || plan === 'starter';
  const label = planName || (plan ? plan[0].toUpperCase() + plan.slice(1) : 'Free');
  const dismissKey = userId ? `cf_free_badge_dismissed_${userId}` : '';
  const [dismissed, setDismissed] = useState(
    () => isFree && !!dismissKey && localStorage.getItem(dismissKey) === '1',
  );
  const [open, setOpen] = useState(false);
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  async function toggleOpen() {
    const next = !open;
    setOpen(next);
    if (next) {
      try {
        const { data } = await api.get('/auth/usage');
        setUsage(data);
      } catch {
        setUsage(null);
      }
    }
  }

  if (isFree && dismissed) return null;

  const used = usage ? usage.minutesUsed : null;
  const limit = usage ? usage.limit + (usage.bonusMinutes || 0) : null;
  const remaining = used != null && limit != null ? Math.max(0, limit - used) : null;
  const pct = used != null && limit ? Math.min(100, (used / limit) * 100) : 0;

  return (
    <div className="plan-badge-wrap" ref={boxRef}>
      <div className={`plan-badge ${isFree ? 'plan-badge-free' : 'plan-badge-paid'}`}>
        <button type="button" className="plan-badge-link" onClick={() => void toggleOpen()}>
          <CrownIcon crossedOut={isFree} />
          {label} Plan
        </button>
        {isFree && (
          <button
            type="button"
            className="plan-badge-dismiss"
            aria-label="Dismiss"
            onClick={(e) => {
              e.stopPropagation();
              if (dismissKey) localStorage.setItem(dismissKey, '1');
              setDismissed(true);
            }}
          >
            ×
          </button>
        )}
      </div>
      {open && (
        <div className="plan-badge-pop">
          {!usage ? (
            <p className="muted">Loading usage…</p>
          ) : (
            <>
              <div className="plan-badge-pop-head">
                <span>{label} plan</span>
                <span>
                  {used?.toFixed(1)} / {limit} min
                </span>
              </div>
              <div className="plan-badge-pop-bar">
                <div className="plan-badge-pop-fill" style={{ width: `${pct}%` }} />
              </div>
              <p className="plan-badge-pop-remaining">{remaining?.toFixed(1)} min remaining this month</p>
              {isFree && (
                <Link to="/#pricing" className="plan-badge-pop-upgrade" onClick={() => setOpen(false)}>
                  Upgrade for more minutes →
                </Link>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function AppShell() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const editorActive = useEditorChromeStore((s) => s.active);
  const onExport = useEditorChromeStore((s) => s.onExport);
  const onDownloadSrt = useEditorChromeStore((s) => s.onDownloadSrt);
  const flags = useFlagsStore((s) => s.flags);
  const loadFlags = useFlagsStore((s) => s.load);

  useEffect(() => {
    void loadFlags();
  }, [loadFlags]);

  return (
    <div className={`shell ${editorActive ? 'shell-editor' : ''}`}>
      {flags.maintenanceMode && (
        <div className="maintenance-banner">
          {flags.maintenanceMessage || 'Asaan Caption is undergoing maintenance — some features may be unavailable.'}
        </div>
      )}
      <header className="topbar">
        <Link to="/projects/upload" className="brand">
          <img src="/logo.png" alt="Asaan Caption" className="brand-logo" />
        </Link>
        {editorActive ? (
          <>
            <span className="topbar-divider" aria-hidden="true" />
            <Link to="/projects/upload" className="btn ghost topbar-upload-btn">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 19V5m0 0-6 6m6-6 6 6" />
              </svg>
              Upload video
            </Link>
            <div className="topbar-right">
              <div className="topbar-editor-actions">
                <button
                  type="button"
                  className="btn ghost"
                  disabled={!onDownloadSrt}
                  onClick={() => onDownloadSrt?.()}
                >
                  SRT
                </button>
                <button
                  type="button"
                  className="btn export"
                  disabled={!onExport}
                  onClick={() => onExport?.()}
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  >
                    <path d="M12 15V3m0 12-4-4m4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
                  </svg>
                  Export
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <nav>
              {/* Admin toggles this via System > Flags > Projects list enabled */}
              {flags.projectsListEnabled && <Link to="/projects">Projects</Link>}
              <Link to="/projects/upload">Upload</Link>
              {(user?.role === 'admin' || user?.role === 'support') && (
                <Link to="/admin">Admin</Link>
              )}
            </nav>
            <div className="topbar-right">
              <PlanBadge userId={user?.id} plan={user?.plan} planName={user?.planName} />
              <span className="muted topbar-user">{user?.name}</span>
              <button
                className="btn ghost"
                type="button"
                onClick={async () => {
                  await logout();
                  navigate('/login');
                }}
              >
                Log out
              </button>
            </div>
          </>
        )}
      </header>
      <main className={`main ${editorActive ? 'main-editor' : ''}`}>
        <Outlet />
      </main>
    </div>
  );
}
