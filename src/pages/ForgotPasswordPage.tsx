import { type FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { CheckCircle, EnvelopeSimple, PaperPlaneTilt } from '@phosphor-icons/react';
import { ArrowRightIcon, AuthBrand, PasswordChecklist, PasswordInput } from '../components/AuthParts';
import { PageLoader } from '../components/PageLoader';
import { passwordPolicyMessage } from '../lib/passwordPolicy';
import { useFlagsStore } from '../stores/flagsStore';
import { EmailCodeEntry } from '../components/EmailCodeEntry';

function MailIcon() {
  return <EnvelopeSimple size={18} aria-hidden="true" />;
}

function SpinnerIcon() {
  return (
    <svg className="auth-spinner" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
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
          <CheckCircle size={26} aria-hidden="true" />
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
          <ArrowRightIcon />
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

/**
 * Last step of the emailed-code reset: the code was accepted and swapped for a
 * one-time reset token (held only in memory here), so choose the new password.
 */
function NewPasswordStep({ token, onStartOver }: { token: string; onStartOver: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [flagUnmet, setFlagUnmet] = useState(false);
  const policyError = passwordPolicyMessage(password);
  const banner = (flagUnmet && policyError) || error;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
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
    } catch (err: unknown) {
      const code = (err as { response?: { data?: { code?: string } } })?.response?.data?.code;
      setExpired(code === 'INVALID_RESET_TOKEN');
      setError(
        code === 'INVALID_RESET_TOKEN'
          ? 'This reset took too long and has expired. Start over to get a new code.'
          : errorMessage(err, 'Could not reset your password. Try again.'),
      );
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="auth-status" role="status">
        <div className="auth-status-icon is-ok">
          <CheckCircle size={26} aria-hidden="true" />
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
          <ArrowRightIcon />
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="auth-heading">
        <h2>Choose a new password</h2>
        <p>Your code was accepted. Pick a new password for your account.</p>
      </div>

      {banner && (
        <div className="error-banner" role="alert">
          {banner}
          {expired && (
            <>
              {' '}
              <button type="button" className="auth-linkbtn" onClick={onStartOver}>
                Start over
              </button>
            </>
          )}
        </div>
      )}

      <form className="auth-form" onSubmit={onSubmit}>
        <div className="auth-field">
          <label htmlFor="reset-new-password">New password</label>
          <PasswordInput
            id="reset-new-password"
            autoComplete="new-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoFocus
            aria-describedby="reset-new-password-rules"
          />
          <PasswordChecklist id="reset-new-password-rules" password={password} flagUnmet={flagUnmet} />
        </div>

        <div className="auth-field">
          <label htmlFor="reset-new-confirm">Confirm new password</label>
          <PasswordInput
            id="reset-new-confirm"
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
  // Set once the emailed code is accepted: the one-time token for the last step.
  const [resetToken, setResetToken] = useState('');

  function startOver() {
    setResetToken('');
    setSent(false);
    setError('');
  }

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
          : msg || 'Could not send the code. Try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  // emailEnabled decides which form this page is, so wait for the flags (they load once per visit).
  if (!flagsLoaded) return <PageLoader />;

  return (
    <main className="auth-page">
      <div className="auth-glow" aria-hidden="true" />
      <div className="auth-orb" aria-hidden="true" />

      <section className="auth-card">
        <AuthBrand />

        {!emailEnabled ? (
          <DirectReset />
        ) : resetToken ? (
          <NewPasswordStep token={resetToken} onStartOver={startOver} />
        ) : sent ? (
          <>
            <EmailCodeEntry
              email={email}
              title="Enter your reset code"
              submitLabel="Continue"
              // The server answers the same for every address, so this must not
              // promise that a code was sent.
              intro={
                <>
                  If <strong className="auth-email">{email}</strong> has an account, a 6-digit code
                  is on its way. It expires in 10 minutes and works once.
                </>
              }
              onSubmit={async (code) => {
                const { data } = await api.post('/auth/reset-password/verify-code', { email, code });
                setResetToken(String(data.token));
              }}
              onResend={async () => {
                const { data } = await api.post('/auth/forgot-password', { email });
                return typeof data?.message === 'string' ? data.message : undefined;
              }}
              onDifferentEmail={startOver}
            />
            <p className="auth-footer">
              <Link to="/login">Back to sign in</Link>
            </p>
          </>
        ) : (
          <>
            <div className="auth-heading">
              <h2>Forgot your password?</h2>
              <p>Enter your email and we'll send you a 6-digit code to choose a new password.</p>
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
                  <>
                    <PaperPlaneTilt size={17} aria-hidden="true" />
                    Send code
                  </>
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
