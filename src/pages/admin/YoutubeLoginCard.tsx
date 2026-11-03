import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';

interface LoginStatus {
  cookiesSet: boolean;
  uploadedAt: string | null;
  status: 'unknown' | 'ok' | 'blocked';
  checkedAt: string | null;
  ytdlpVersion: string | null;
  /** Set by upload/test: why the test video could not be read (null = it could). */
  testError?: string | null;
}

const errorText = (e: unknown, fallback: string) =>
  (e as { response?: { data?: { message?: string } } })?.response?.data?.message || fallback;

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : 'Never');

function badge(login: LoginStatus): { cls: string; label: string } {
  if (login.status === 'ok') return { cls: 'ready', label: 'Working' };
  if (login.status === 'blocked') {
    return { cls: 'error', label: login.cookiesSet ? 'Expired: upload a new file' : 'Blocked: upload a login' };
  }
  return login.cookiesSet ? { cls: 'processing', label: 'Not checked yet' } : { cls: '', label: 'No login yet' };
}

/**
 * Admin → System: the YouTube login (cookies.txt) that gets the server past
 * YouTube's "confirm you're not a bot" check, so Clips from a link works.
 */
export function YoutubeLoginCard({ isAdmin }: { isAdmin: boolean }) {
  const [login, setLogin] = useState<LoginStatus | null>(null);
  const [busy, setBusy] = useState<'' | 'upload' | 'test'>('');
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.get<LoginStatus>('/admin/system/youtube-login').then(
      (r) => setLogin(r.data),
      (e) => setError(errorText(e, 'Could not load the YouTube login status')),
    );
  }, []);

  async function upload(file: File) {
    setBusy('upload');
    setError('');
    try {
      const r = await api.put<LoginStatus>('/admin/system/youtube-login', { cookies: await file.text() });
      setLogin(r.data);
    } catch (e) {
      setError(errorText(e, 'Upload failed'));
    } finally {
      setBusy('');
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function test() {
    setBusy('test');
    setError('');
    try {
      const r = await api.post<LoginStatus>('/admin/system/youtube-login/test');
      setLogin(r.data);
    } catch (e) {
      setError(errorText(e, 'Test failed'));
    } finally {
      setBusy('');
    }
  }

  const b = login ? badge(login) : null;

  return (
    <section className="admin-card">
      <h2>YouTube login</h2>
      <p className="muted">
        YouTube blocks most servers. Upload a login file once and Clips from a link works for every user.
      </p>
      {login && b && (
        <dl className="admin-dl">
          <dt>Status</dt>
          <dd>
            <span className={`admin-badge ${b.cls}`}>{b.label}</span>
          </dd>
          <dt>Uploaded</dt>
          <dd>{when(login.uploadedAt)}</dd>
          <dt>Checked</dt>
          <dd>{when(login.checkedAt)}</dd>
          <dt>yt-dlp</dt>
          <dd>{login.ytdlpVersion ?? 'Not found'}</dd>
        </dl>
      )}
      {login?.testError && (
        <div className="error-banner" role="alert">
          {login.testError}
        </div>
      )}
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      {!isAdmin ? (
        <p className="muted">Support can view; only admins change the login.</p>
      ) : (
        <>
          <label>
            Upload cookies.txt
            <input
              ref={fileRef}
              type="file"
              accept=".txt,text/plain"
              disabled={busy !== ''}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file);
              }}
            />
          </label>
          <div className="admin-actions">
            <button type="button" className="btn" disabled={busy !== ''} onClick={() => void test()}>
              {busy === 'test' ? 'Testing…' : 'Test now'}
            </button>
          </div>
          <p className="muted" aria-live="polite">
            {busy === 'upload' ? 'Saving and testing with YouTube…' : ''}
          </p>
          <details>
            <summary>How to get cookies.txt</summary>
            <ol>
              <li>In Chrome, install the extension “Get cookies.txt LOCALLY” and allow it in Incognito.</li>
              <li>Open an Incognito window and sign in to youtube.com with a spare Google account.</li>
              <li>Click the extension, press Export, and upload that file here.</li>
              <li>Close the Incognito window. Don’t sign out, or the login stops working.</li>
            </ol>
          </details>
        </>
      )}
    </section>
  );
}
