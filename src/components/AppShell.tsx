import { Outlet, Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useEditorChromeStore } from '../stores/editorChromeStore';

export function AppShell() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const editorActive = useEditorChromeStore((s) => s.active);
  const projectName = useEditorChromeStore((s) => s.projectName);
  const onExport = useEditorChromeStore((s) => s.onExport);
  const onDownloadSrt = useEditorChromeStore((s) => s.onDownloadSrt);

  return (
    <div className={`shell ${editorActive ? 'shell-editor' : ''}`}>
      <header className="topbar">
        <Link to="/" className="brand">
          CaptionFlow
        </Link>
        <nav>
          <Link to="/">Projects</Link>
          <Link to="/upload">Upload</Link>
        </nav>
        {editorActive && projectName && (
          <div className="topbar-project" title={projectName}>
            <span className="topbar-project-name">{projectName}</span>
            <span className="topbar-saved">
              <span className="saved-dot" /> Saved
            </span>
          </div>
        )}
        <div className="topbar-right">
          {editorActive && (
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
          )}
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
      </header>
      <main className={`main ${editorActive ? 'main-editor' : ''}`}>
        <Outlet />
      </main>
    </div>
  );
}
