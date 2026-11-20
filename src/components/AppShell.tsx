import { useEffect, useRef, useState } from 'react';
import { Outlet, Link, NavLink, useLocation, useMatch, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useEditorChromeStore } from '../stores/editorChromeStore';
import { useFlagsStore } from '../stores/flagsStore';
import { api } from '../lib/api';
import { PricingModal } from './PricingModal';
import { subscribeClipsEvents } from '../stores/clipsStore';
import {
  CaretDown,
  ClosedCaptioning,
  Crown,
  CrownCross,
  DownloadSimple,
  FolderOpen,
  FolderSimple,
  Info,
  ShieldCheck,
  SignOut,
  UploadSimple,
} from '@phosphor-icons/react';

function CrownIcon({ crossedOut }: { crossedOut?: boolean }) {
  const Icon = crossedOut ? CrownCross : Crown;
  return <Icon size={16} weight="fill" aria-hidden="true" />;
}

function NavFolderIcon({ active }: { active?: boolean }) {
  const Icon = active ? FolderOpen : FolderSimple;
  return <Icon weight={active ? 'fill' : 'duotone'} aria-hidden="true" />;
}

/** Avatar + name; opens a small menu with the account email and sign-out. */
function UserMenu({ name, email, admin, onLogout }: { name?: string; email?: string; admin?: boolean; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const closeOnEscape = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', closeOnEscape);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', closeOnEscape); };
  }, [open]);

  return (
    <div className="topbar-user-menu" ref={boxRef}>
      <button
        type="button"
        className="topbar-user-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Open account menu for ${name || 'your account'}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="topbar-avatar">{(name || '?')[0]?.toUpperCase()}</span>
        <span className="topbar-user-copy">
          <span className="topbar-user-name">{name}</span>
          <span className="topbar-user-meta">Account</span>
        </span>
        <CaretDown weight="bold" aria-hidden="true" />
      </button>
      {open && (
        <div className="topbar-user-pop" role="menu">
          <p className="topbar-user-pop-name">{name}</p>
          {email && <p className="topbar-user-pop-email">{email}</p>}
          {admin && <Link to="/admin" role="menuitem" onClick={() => setOpen(false)}><ShieldCheck size={16} aria-hidden="true" />Admin area</Link>}
          <button type="button" role="menuitem" onClick={onLogout}>
            <SignOut size={16} aria-hidden="true" />
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
  /** Admin account: no usage limit (minutes are still counted). */
  unlimited?: boolean;
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
  const unlimited = !!usage?.unlimited;
  const pct = used != null && limit && !unlimited ? Math.min(100, (used / limit) * 100) : 0;

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
              {used != null ? used.toFixed(1) : '-'} / {unlimited ? 'Unlimited' : `${limit ?? '-'} min`}
            </span>
            <span className="plan-usage-bar">
              <span className="plan-usage-fill" style={{ width: `${pct}%` }} />
            </span>
          </div>
          <div className="plan-usage-card-bottom">
            <span>{unlimited ? 'Admin · no usage limit' : renewsIn ? `Renews in ${renewsIn}` : remaining != null ? `${remaining.toFixed(1)} min left` : '-'}</span>
            {renewsTitle && (
              <span title={renewsTitle}>
                <Info size={13} weight="bold" aria-hidden="true" />
              </span>
            )}
          </div>
        </div>
        <div className="plan-badge plan-badge-free">
          <button type="button" className="plan-badge-link" aria-label="Upgrade plan" onClick={() => onUpgradeClick?.()}>
            <CrownIcon />
            <span className="plan-badge-text">Upgrade Plan</span>
          </button>
        </div>
      </>
    );
  }

  return (
    <div className="plan-badge-wrap" ref={boxRef}>
      <div className="plan-badge plan-badge-paid">
        <button type="button" className="plan-badge-link" aria-label={`${label} plan and usage`} onClick={() => void toggleOpen()}>
          <CrownIcon />
          <span className="plan-badge-text">{label} Plan</span>
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
                  {used?.toFixed(1)} / {unlimited ? 'Unlimited' : `${limit} min`}
                </span>
              </div>
              <div className="plan-badge-pop-bar">
                <div className="plan-badge-pop-fill" style={{ width: `${pct}%` }} />
              </div>
              <p className="plan-badge-pop-remaining">
                {unlimited ? 'Admin account — no usage limit' : `${remaining?.toFixed(1)} min remaining this month`}
              </p>
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
  const location = useLocation();
  const editorActive = useEditorChromeStore((s) => s.active);
  const editorMatch = useMatch('/projects/:id/editor');
  // Editor header/layout from the moment the route matches, not only once the
  // lazily loaded EditorPage registers itself — otherwise the header flips from
  // the nav to the editor bar on every editor open. (`?clip=` links redirect to
  // Clips, so they keep the normal header.)
  const editorChrome =
    editorActive || (!!editorMatch && !new URLSearchParams(location.search).get('clip'));
  const onExport = useEditorChromeStore((s) => s.onExport);
  const onDownloadSrt = useEditorChromeStore((s) => s.onDownloadSrt);
  const flags = useFlagsStore((s) => s.flags);
  const loadFlags = useFlagsStore((s) => s.load);
  const [pricingOpen, setPricingOpen] = useState(false);
  const creatorSurface = location.pathname === '/create' ? ' main-create' : '';

  // Clips progress arrives in the user's own socket room, on any page.
  useEffect(() => {
    if (flags.clipsEnabled) subscribeClipsEvents();
  }, [flags.clipsEnabled]);

  async function signOut() {
    await logout();
    navigate('/login');
  }

  useEffect(() => {
    void loadFlags();
  }, [loadFlags]);

  // Each workspace should open at its own heading instead of inheriting the
  // previous page's scroll position when users switch tools in the header.
  useEffect(() => {
    if (!editorActive) window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [editorActive, location.pathname]);

  return (
    <div className={`shell ${editorChrome ? 'shell-editor' : ''}`}>
      {flags.maintenanceMode && (
        <div className="maintenance-banner">
          {flags.maintenanceMessage || 'Asaan Caption is undergoing maintenance - some features may be unavailable.'}
        </div>
      )}
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/create" className="brand" aria-label="Asaan Caption home">
            <img src="/logo-mark.png" alt="" className="brand-logo-mark" />
            <img src="/logo-wordmark.png" alt="Asaan Caption" className="brand-logo-wordmark" />
          </Link>
          {editorChrome ? (
            <>
              <span className="topbar-divider" aria-hidden="true" />
              <Link to="/create" className="btn ghost topbar-upload-btn">
                <UploadSimple size={14} weight="bold" aria-hidden="true" />
                Create
              </Link>
              <Link to="/projects" className="btn ghost topbar-upload-btn"><NavFolderIcon />Projects</Link>
              <div className="topbar-right">
                <div className="topbar-editor-actions">
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={!onDownloadSrt}
                    onClick={() => onDownloadSrt?.()}
                  >
                    <ClosedCaptioning size={16} aria-hidden="true" />
                    SRT
                  </button>
                  <button
                    type="button"
                    className="btn export"
                    disabled={!onExport || !flags.exportsEnabled}
                    title={!flags.exportsEnabled ? 'Exports are temporarily disabled' : undefined}
                    onClick={() => onExport?.()}
                  >
                    <DownloadSimple size={15} weight="bold" aria-hidden="true" />
                    Export
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <nav className="topbar-nav" aria-label="Primary navigation">
                <NavLink to="/create" aria-label="Create">
                  {({ isActive }) => <>
                    <ClosedCaptioning weight={isActive ? 'fill' : 'duotone'} aria-hidden="true" />
                    <span>Create</span>
                  </>}
                </NavLink>
                <NavLink to="/projects" end aria-label="Projects" className={({ isActive }) => isActive || location.pathname.startsWith('/clips/') ? 'active' : ''}>{({ isActive }) => <><NavFolderIcon active={isActive || location.pathname.startsWith('/clips/')} /><span>Projects</span></>}</NavLink>
              </nav>
              <div className="topbar-right">
                <div className="topbar-account">
                  <PlanBadge
                    plan={user?.plan}
                    planName={user?.planName}
                    onUpgradeClick={() => setPricingOpen(true)}
                  />
                  <UserMenu name={user?.name} email={user?.email} admin={user?.role === 'admin' || user?.role === 'support'} onLogout={() => void signOut()} />
                </div>
              </div>
            </>
          )}
        </div>
      </header>
      <main className={`main${editorChrome ? ' main-editor' : ''}${creatorSurface}`}>
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
