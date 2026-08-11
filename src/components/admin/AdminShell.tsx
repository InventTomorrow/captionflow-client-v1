import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';

const LINKS = [
  { to: '/admin', end: true, label: 'Dashboard' },
  { to: '/admin/users', label: 'Users' },
  { to: '/admin/plans', label: 'Packages' },
  { to: '/admin/subscriptions', label: 'Subscriptions' },
  { to: '/admin/projects', label: 'Jobs' },
  { to: '/admin/analytics', label: 'Analytics' },
  { to: '/admin/system', label: 'System' },
  { to: '/admin/audit', label: 'Audit' },
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
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="admin-sidebar-footer">
          <p className="muted">{user?.name}</p>
          <p className="muted" style={{ fontSize: '0.75rem' }}>
            {user?.role}
          </p>
          <button
            type="button"
            className="btn ghost"
            onClick={async () => {
              await logout();
              navigate('/login');
            }}
          >
            Log out
          </button>
        </div>
      </aside>
      <div className="admin-main">
        <header className="admin-topbar">
          <span className="muted">Control plane</span>
          <a href="/projects/upload" className="btn ghost">
            Creator app
          </a>
        </header>
        <div className="admin-content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
