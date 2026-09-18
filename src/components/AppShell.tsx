import { useEffect, useRef, useState } from 'react';
import { Outlet, Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useEditorChromeStore } from '../stores/editorChromeStore';
import { useFlagsStore } from '../stores/flagsStore';
import { api } from '../lib/api';
import { PricingModal } from './PricingModal';

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

function InfoIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9.5" />
      <line x1="12" y1="11" x2="12" y2="16.5" />
      <circle cx="12" cy="7.5" r="0.25" fill="currentColor" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function NavUploadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 13v8" />
      <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
      <path d="m8 17 4-4 4 4" />
    </svg>
  );
}

function NavUserIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="4.5" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  );
}

function NavFolderIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/** Avatar + name; opens a small menu with the account email and sign-out. */
function UserMenu({ name, email, onLogout }: { name?: string; email?: string; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className="topbar-user-menu" ref={boxRef}>
      <button
        type="button"
        className="topbar-user-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="topbar-avatar">{(name || '?')[0]?.toUpperCase()}</span>
        <span className="topbar-user-name">{name}</span>
        <ChevronDownIcon />
      </button>
      {open && (
        <div className="topbar-user-pop" role="menu">
          <p className="topbar-user-pop-name">{name}</p>
          {email && <p className="topbar-user-pop-email">{email}</p>}
          <button type="button" role="menuitem" onClick={onLogout}>
            Log out
          </button>
        </div>
      )}
    </div>
  );
}

type UsageInfo = {
  minutesUsed: number;
  bonusMinutes: number;
  limit: number;
  periodEnd: string;
};

/** "23h 45m" / "2d 6h" / "45m" until the plan's usage period rolls over. */
function formatRenewsIn(periodEnd?: string): string | null {
  if (!periodEnd) return null;
  const ms = new Date(periodEnd).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function PlanBadge({
  plan,
  planName,
  onUpgradeClick,
}: {
  plan?: string;
  planName?: string;
  onUpgradeClick?: () => void;
}) {
  const isFree = !plan || plan === 'starter';
  const label = planName || (plan ? plan[0].toUpperCase() + plan.slice(1) : 'Free');
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

  // Free-tier usage sits directly in the topbar (next to the Upgrade button)
  // instead of behind a click, so fetch it up front rather than on toggle.
  useEffect(() => {
    if (!isFree) return;
    let cancelled = false;
    void api
      .get('/auth/usage')
      .then(({ data }) => {
        if (!cancelled) setUsage(data);
      })
      .catch(() => {
        if (!cancelled) setUsage(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isFree]);

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

  const used = usage ? usage.minutesUsed : null;
  const limit = usage ? usage.limit + (usage.bonusMinutes || 0) : null;
  const remaining = used != null && limit != null ? Math.max(0, limit - used) : null;
  const pct = used != null && limit ? Math.min(100, (used / limit) * 100) : 0;

  if (isFree) {
    const renewsIn = formatRenewsIn(usage?.periodEnd);
    const renewsTitle = usage?.periodEnd
      ? `Renews on ${new Date(usage.periodEnd).toLocaleString(undefined, {
          dateStyle: 'medium',
          timeStyle: 'short',
        })}`
      : undefined;
    return (
      <>
        <div className="plan-usage-card">
          <div className="plan-usage-card-top">
            <span className="plan-usage-text">
              {used != null ? used.toFixed(1) : '-'} / {limit ?? '-'} min
            </span>
            <span className="plan-usage-bar">
              <span className="plan-usage-fill" style={{ width: `${pct}%` }} />
            </span>
          </div>
          <div className="plan-usage-card-bottom">
            <span>{renewsIn ? `Renews in ${renewsIn}` : remaining != null ? `${remaining.toFixed(1)} min left` : '-'}</span>
            {renewsTitle && (
              <span title={renewsTitle}>
                <InfoIcon />
              </span>
            )}
          </div>
        </div>
        <div className="plan-badge plan-badge-free">
          <button type="button" className="plan-badge-link" onClick={() => onUpgradeClick?.()}>
            <CrownIcon />
            Upgrade Plan
          </button>
        </div>
      </>
    );
  }

  return (
    <div className="plan-badge-wrap" ref={boxRef}>
      <div className="plan-badge plan-badge-paid">
        <button type="button" className="plan-badge-link" onClick={() => void toggleOpen()}>
          <CrownIcon />
          {label} Plan
        </button>
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
  const [pricingOpen, setPricingOpen] = useState(false);

  async function signOut() {
    await logout();
    navigate('/login');
  }

  useEffect(() => {
    void loadFlags();
  }, [loadFlags]);

  return (
    <div className={`shell ${editorActive ? 'shell-editor' : ''}`}>
      {flags.maintenanceMode && (
        <div className="maintenance-banner">
          {flags.maintenanceMessage || 'Asaan Caption is undergoing maintenance - some features may be unavailable.'}
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
                  disabled={!onExport || !flags.exportsEnabled}
                  title={!flags.exportsEnabled ? 'Exports are temporarily disabled' : undefined}
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
            <nav className="topbar-nav">
              {/* Admin toggles this via System > Flags > Projects list enabled */}
              {flags.projectsListEnabled && (
                <NavLink to="/projects" end>
                  <NavFolderIcon />
                  Projects
                </NavLink>
              )}
              <NavLink to="/projects/upload">
                <NavUploadIcon />
                Upload
              </NavLink>
              {(user?.role === 'admin' || user?.role === 'support') && (
                <NavLink to="/admin">
                  <NavUserIcon />
                  Admin
                </NavLink>
              )}
            </nav>
            <div className="topbar-right">
              <div className="topbar-account">
                <PlanBadge
                  plan={user?.plan}
                  planName={user?.planName}
                  onUpgradeClick={() => setPricingOpen(true)}
                />
                <UserMenu name={user?.name} email={user?.email} onLogout={() => void signOut()} />
              </div>
            </div>
          </>
        )}
      </header>
      <main className={`main ${editorActive ? 'main-editor' : ''}`}>
        <Outlet />
      </main>
      {/* Rendered here, outside <header>, because .topbar's backdrop-filter
       *  makes it a containing block for position:fixed descendants — a
       *  modal nested inside it would size itself to the topbar, not the
       *  viewport. */}
      <PricingModal open={pricingOpen} onClose={() => setPricingOpen(false)} />
    </div>
  );
}
