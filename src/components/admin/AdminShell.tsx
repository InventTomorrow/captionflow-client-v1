import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  ArrowUpRight,
  ChartLineUp,
  ClipboardText,
  CreditCard,
  Gauge,
  HardDrives,
  Package,
  Queue,
  SignOut,
  SquaresFour,
  Users,
  type Icon,
} from '@phosphor-icons/react';
import { useAuthStore } from '../../stores/authStore';
import { AccountAvatar } from '../AccountAvatar';
import { ConnectGooglePhotoButton } from '../ConnectGooglePhotoButton';

const LINKS: { to: string; end?: boolean; label: string; icon: Icon }[] = [
  { to: '/admin', end: true, label: 'Dashboard', icon: Gauge },
  { to: '/admin/users', label: 'Users', icon: Users },
  { to: '/admin/plans', label: 'Packages', icon: Package },
  { to: '/admin/subscriptions', label: 'Subscriptions', icon: CreditCard },
  { to: '/admin/templates', label: 'Templates', icon: SquaresFour },
  { to: '/admin/projects', label: 'Jobs', icon: Queue },
  { to: '/admin/analytics', label: 'Analytics', icon: ChartLineUp },
  { to: '/admin/system', label: 'System', icon: HardDrives },
  { to: '/admin/audit', label: 'Audit', icon: ClipboardText },
];

export function AdminShell() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-sidebar-brand">
          <img src="/logo.png" alt="Asaan Caption" className="admin-brand-logo" />
          <span className="admin-sidebar-sub">Admin</span>
        </div>
        <nav className="admin-nav">
          {LINKS.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) => (isActive ? 'active' : undefined)}
            >
              {({ isActive }) => (
                <>
                  <l.icon size={18} weight={isActive ? 'fill' : 'duotone'} aria-hidden="true" />
                  {l.label}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="admin-sidebar-footer">
          <div className="admin-account-profile">
            <AccountAvatar name={user?.name} avatarUrl={user?.avatarUrl} className="admin-account-avatar" />
            <div className="admin-account-copy">
              <p>{user?.name}</p>
              <span>{user?.email}</span>
            </div>
          </div>
          <ConnectGooglePhotoButton hasPhoto={Boolean(user?.avatarUrl)} className="btn ghost" />
          <button
            type="button"
            className="btn ghost"
            onClick={async () => {
              await logout();
              navigate('/login');
            }}
          >
            <SignOut size={16} aria-hidden="true" />
            Log out
          </button>
        </div>
      </aside>
      <div className="admin-main">
        <header className="admin-topbar">
          <span className="muted">Control plane</span>
          <a href="/projects/upload" className="btn ghost">
            Creator app
            <ArrowUpRight size={14} weight="bold" aria-hidden="true" />
          </a>
        </header>
        <div className="admin-content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
