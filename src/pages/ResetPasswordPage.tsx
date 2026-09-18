import { type FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { AuthBrand } from '../components/AuthParts';

function LockIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg className="auth-spinner" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    // Checked here as well as by the browser so the message is ours and the
    // request is never sent with a mismatch.
    if (password !== confirm) {
      setError('Those passwords do not match.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.post('/auth/reset-password', { token, password });
      setDone(true);
      // The server deliberately does not sign you in — proving control of the
      // mailbox is not the same as knowing the new password.
      setTimeout(() => navigate('/login'), 2500);
    } catch (err: unknown) {
      setError(errorMessage(err, 'Could not reset your password. Request a new link.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-glow" aria-hidden="true" />
      <div className="auth-orb" aria-hidden="true" />

      <section className="auth-card">
        <AuthBrand />

        {!token ? (
          <>
            <div className="auth-heading">
              <h2>Link is incomplete</h2>
              <p>
                This reset link is missing its token. Copy the full link from the email, or request
                a new one.
              </p>
            </div>
            <p className="auth-footer">
              <Link to="/forgot-password">Request a new link</Link>
            </p>
          </>
        ) : done ? (
          <>
            <div className="auth-heading">
              <h2>Password updated</h2>
              <p>
                You can sign in with your new password now. Any other devices that were signed in
                have been signed out.
              </p>
            </div>
            <p className="auth-footer">
              <Link to="/login">Go to sign in</Link>
            </p>
          </>
        ) : (
          <>
            <div className="auth-heading">
              <h2>Choose a new password</h2>
              <p>Make it at least 8 characters.</p>
            </div>

            {error && <div className="error-banner">{error}</div>}

            <form className="auth-form" onSubmit={onSubmit}>
              <div className="auth-field">
                <label htmlFor="reset-password">New password</label>
                <div className="auth-input-wrap">
                  <LockIcon />
                  <input
                    id="reset-password"
                    type="password"
                    autoComplete="new-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                    autoFocus
                  />
                </div>
              </div>

              <div className="auth-field">
                <label htmlFor="reset-confirm">Confirm new password</label>
                <div className="auth-input-wrap">
                  <LockIcon />
                  <input
                    id="reset-confirm"
                    type="password"
                    autoComplete="new-password"
                    placeholder="••••••••"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                    minLength={8}
                  />
                </div>
              </div>

              <button className="btn primary auth-submit" disabled={busy} type="submit">
                {busy ? (
                  <>
                    <SpinnerIcon />
                    Updating…
                  </>
                ) : (
                  'Update password'
                )}
              </button>
            </form>

            <p className="auth-footer">
              <Link to="/login">Back to sign in</Link>
            </p>
          </>
        )}
      </section>
    </main>
  );
}
