import { type FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { AuthBrand } from '../components/AuthParts';

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

export function ForgotPasswordPage() {
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

        {sent ? (
          <>
            <div className="auth-heading">
              <h2>Check your email</h2>
              <p>
                If <strong>{email}</strong> has an account, a reset link is on its way. It expires
                in 30 minutes and can only be used once.
              </p>
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
