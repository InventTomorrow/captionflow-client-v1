import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { errorMessage } from '../lib/api';
import { ArrowRightIcon, AuthBrand, PasswordInput } from '../components/AuthParts';

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
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function LoginPage() {
  const login = useAuthStore((s) => s.login);
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(email, password);
      const role = useAuthStore.getState().user?.role;
      navigate(role === 'admin' || role === 'support' ? '/admin' : '/projects/upload');
    } catch (err: unknown) {
      setError(errorMessage(err, 'Login failed'));
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

        <div className="auth-heading">
          <h2>Welcome back</h2>
          <p>Sign in to keep captioning where you left off.</p>
        </div>

        {error && <div className="error-banner">{error}</div>}

        <form className="auth-form" onSubmit={onSubmit}>
          <div className="auth-field">
            <label htmlFor="login-email">Email</label>
            <div className="auth-input-wrap">
              <MailIcon />
              <input
                id="login-email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="auth-field">
            <div className="auth-label-row">
              <label htmlFor="login-password">Password</label>
              <Link to="/forgot-password" className="auth-forgot">
                Forgot password?
              </Link>
            </div>
            <PasswordInput
              id="login-password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
          </div>

          <button className="btn primary auth-submit" disabled={busy} type="submit">
            {busy ? (
              <>
                <SpinnerIcon />
                Signing in…
              </>
            ) : (
              <>
                Sign in
                <ArrowRightIcon />
              </>
            )}
          </button>
        </form>

        <p className="auth-footer">
          No account? <Link to="/register">Create one</Link>
        </p>
      </section>
    </main>
  );
}
