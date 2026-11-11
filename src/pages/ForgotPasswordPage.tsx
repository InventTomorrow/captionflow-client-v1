import { type FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { AuthBrand, PasswordChecklist, PasswordInput } from '../components/AuthParts';
import { passwordPolicyMessage } from '../lib/passwordPolicy';
import { useFlagsStore } from '../stores/flagsStore';

function MailIcon() {
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
      <path d="m22 7-8.991 5.667a2 2 0 0 1-2.009 0L2 7" />
      <rect x="2" y="4" width="20" height="16" rx="3" />
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

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

/**
 * Shown instead of the emailed-link form while the server has no mail
 * (MAIL_TRANSPORT=off): the account's email plus a new password, set right
 * here. The server refuses admin/support accounts and rate-limits it.
 */
function DirectReset() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  // Same checklist behaviour as the emailed reset form: red only after a refused submit.
  const [flagUnmet, setFlagUnmet] = useState(false);
  const policyError = passwordPolicyMessage(password);
  const banner = (flagUnmet && policyError) || error;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    // Checked here so a weak password or a typo never spends one of the 5 tries an hour.
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
      await api.post('/auth/reset-password-direct', { email, password });
      setDone(true);
    } catch (err: unknown) {
      setError(errorMessage(err, 'Could not reset your password. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="auth-status" role="status">
        <div className="auth-status-icon is-ok">
          <CheckIcon />
        </div>
        <div className="auth-heading">
          <h2>Password updated</h2>
          <p>
            You can sign in with your new password now. Any other devices that were signed in have
            been signed out.
          </p>
        </div>
        <Link className="btn primary auth-submit auth-status-action" to="/login">
          Go to sign in
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="auth-heading">
        <h2>Forgot your password?</h2>
        <p>Enter your account email and choose a new password.</p>
      </div>

      {banner && <div className="error-banner">{banner}</div>}

      <form className="auth-form" onSubmit={onSubmit}>
        <div className="auth-field">
          <label htmlFor="forgot-email">Email</label>
          <div className="auth-input-wrap">
            <MailIcon />
            <input
              id="forgot-email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </div>
        </div>

        <div className="auth-field">
          <label htmlFor="forgot-password">New password</label>
          <PasswordInput
            id="forgot-password"
            autoComplete="new-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            aria-describedby="forgot-password-rules"
          />
          <PasswordChecklist id="forgot-password-rules" password={password} flagUnmet={flagUnmet} />
        </div>

        <div className="auth-field">
          <label htmlFor="forgot-confirm">Confirm new password</label>
          <PasswordInput
            id="forgot-confirm"
            autoComplete="new-password"
            placeholder="••••••••"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        </div>

        <button className="btn primary auth-submit" disabled={busy} type="submit">
          {busy ? (
            <>
              <SpinnerIcon />
              Updating…
            </>
          ) : (
            'Reset password'
          )}
        </button>
      </form>

      <p className="auth-footer">
        Remembered it? <Link to="/login">Sign in</Link>
      </p>
    </>
  );
}

export function ForgotPasswordPage() {
  // Signed-out pages sit outside the app shell that loads flags, so load them here.
  const loadFlags = useFlagsStore((s) => s.load);
  const flagsLoaded = useFlagsStore((s) => s.loaded);
  const emailEnabled = useFlagsStore((s) => s.flags.emailEnabled);
  useEffect(() => {
    void loadFlags();
  }, [loadFlags]);
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post('/auth/forgot-password', { email });
      // The server answers identically whether or not the address has an
      // account — this screen must not imply otherwise, or it becomes an
      // account-existence oracle for anyone with a list of addresses.
      setSent(true);
      if (typeof data?.message === 'string') setError('');
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      // Rate limiting is the one case worth surfacing: it is about the caller,
      // not about whether the account exists.
      setError(
        status === 429
          ? msg || 'Too many attempts. Try again later.'
          : msg || 'Could not send the reset link. Try again.',
      );
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

        {!flagsLoaded ? null : !emailEnabled ? (
          <DirectReset />
        ) : sent ? (
          <>
            <div className="auth-status">
              <div className="auth-status-icon">
                <MailIcon />
              </div>
              <div className="auth-heading">
                <h2>Check your email</h2>
                <p>
                  If <strong className="auth-email">{email}</strong> has an account, a reset link
                  is on its way. It expires in 30 minutes and can only be used once.
                </p>
              </div>
            </div>
            <p className="auth-note">
              Nothing arrived? Check your spam folder, then{' '}
              <button type="button" className="auth-linkbtn" onClick={() => setSent(false)}>
                try a different email
              </button>
              .
            </p>
            <p className="auth-footer">
              <Link to="/login">Back to sign in</Link>
            </p>
          </>
        ) : (
          <>
            <div className="auth-heading">
              <h2>Forgot your password?</h2>
              <p>Enter your email and we'll send you a link to choose a new one.</p>
            </div>

            {error && <div className="error-banner">{error}</div>}

            <form className="auth-form" onSubmit={onSubmit}>
              <div className="auth-field">
                <label htmlFor="forgot-email">Email</label>
                <div className="auth-input-wrap">
                  <MailIcon />
                  <input
                    id="forgot-email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
              </div>

              <button className="btn primary auth-submit" disabled={busy} type="submit">
                {busy ? (
                  <>
                    <SpinnerIcon />
                    Sending…
                  </>
                ) : (
                  'Send reset link'
                )}
              </button>
            </form>

            <p className="auth-footer">
              Remembered it? <Link to="/login">Sign in</Link>
            </p>
          </>
        )}
      </section>
    </main>
  );
}
