import { type FormEvent, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { CheckCircle, Key, LockSimple } from '@phosphor-icons/react';
import { ArrowRightIcon, AuthBrand, PasswordChecklist } from '../components/AuthParts';
import { passwordPolicyMessage } from '../lib/passwordPolicy';
import { verifyResetLinkPath, type VerifiedResetState } from '../lib/resetLink';

function LockIcon() {
  return <LockSimple size={18} aria-hidden="true" />;
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
  const verifiedToken = (useLocation().state as VerifiedResetState | null)?.verifiedToken;

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  // True once a submit was refused over the password. From then on the checklist
  // marks what is still missing in red and the banner names it — both derived
  // from the field, so they clear themselves as the password is corrected.
  const [flagUnmet, setFlagUnmet] = useState(false);
  const policyError = passwordPolicyMessage(password);
  const banner = (flagUnmet && policyError) || error;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    // Both checked here rather than left to the browser, so the message is ours
    // and the request is never sent with a weak password or a mismatch — a
    // refused request would still spend one of the 5 reset attempts per hour.
    if (policyError) {
      setFlagUnmet(true);
      setError('');
      return;
    }
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

  // The form is only ever reached THROUGH the verify page, which hands over the
  // token it checked. Anyone arriving another way — an older email, a pasted
  // URL, a bookmark — is sent to verify first, so a dead link is reported before
  // a password is typed. (Router state survives a refresh, so reloading this
  // page does not bounce.) A link with no token goes there too — the verify page
  // owns the "link is incomplete" message.
  if (!token || verifiedToken !== token) {
    return <Navigate to={verifyResetLinkPath(token)} replace />;
  }

  return (
    <main className="auth-page">
      <div className="auth-glow" aria-hidden="true" />
      <div className="auth-orb" aria-hidden="true" />

      <section className="auth-card">
        <AuthBrand />

        {done ? (
          <>
            <div className="auth-status" role="status">
              <div className="auth-status-icon is-ok">
                <CheckCircle size={26} aria-hidden="true" />
              </div>
              <div className="auth-heading">
                <h2>Password updated</h2>
                <p>
                  You can sign in with your new password now. Any other devices that were signed in
                  have been signed out.
                </p>
              </div>
              <Link className="btn primary auth-submit auth-status-action" to="/login">
                Go to sign in
                <ArrowRightIcon />
              </Link>
            </div>
          </>
        ) : (
          <>
            <div className="auth-heading">
              <h2>Choose a new password</h2>
              <p>It has to meet every rule listed under the field.</p>
            </div>

            {banner && <div className="error-banner">{banner}</div>}

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
                    aria-describedby="reset-password-rules"
                    autoFocus
                  />
                </div>
                <PasswordChecklist
                  id="reset-password-rules"
                  password={password}
                  flagUnmet={flagUnmet}
                />
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
                  <>
                    <Key size={17} aria-hidden="true" />
                    Update password
                  </>
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
