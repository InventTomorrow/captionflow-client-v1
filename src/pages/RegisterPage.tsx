import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore, type RegisterResult } from '../stores/authStore';
import { errorMessage } from '../lib/api';
import { useResendVerification } from '../lib/emailVerification';
import {
  ArrowRightIcon,
  AuthBrand,
  PasswordChecklist,
  PasswordInput,
} from '../components/AuthParts';
import { passwordPolicyMessage } from '../lib/passwordPolicy';

function UserIcon() {
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
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

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

/**
 * What sign-up turns into once the account exists: nobody is signed in, and the
 * emailed link is the way forward. Owns its resend state, so coming back here
 * after "use a different email" starts clean.
 */
function CheckYourEmail({
  email,
  pending,
  onDifferentEmail,
}: {
  email: string;
  pending: RegisterResult;
  onDifferentEmail: () => void;
}) {
  const resend = useResendVerification();
  const sending = resend.state === 'sending';
  // The account was made but the first email never left the server — so there
  // is nothing to check an inbox for until a resend goes through.
  const undelivered = !pending.emailSent && resend.state !== 'sent';
  const hours = pending.expiresInHours;

  const resendButton = (label: string) => (
    <button
      type="button"
      className="auth-linkbtn"
      disabled={sending}
      onClick={() => resend.resend(email)}
    >
      {sending ? 'sending…' : label}
    </button>
  );

  return (
    <>
      <div className="auth-status" role="status">
        <div className="auth-status-icon">
          <MailIcon />
        </div>
        <div className="auth-heading">
          <h2>{undelivered ? 'One more step' : 'Check your email'}</h2>
          {undelivered ? (
            <p>
              Your account is ready, but we couldn't send the confirmation email to{' '}
              <strong className="auth-email">{email}</strong> just now. Send it again to finish
              signing up.
            </p>
          ) : (
            <p>
              We sent a confirmation link to <strong className="auth-email">{email}</strong>. Open
              it to confirm your address, then sign in.
              {hours ? ` The link expires in ${hours} ${hours === 1 ? 'hour' : 'hours'}.` : ''}
            </p>
          )}
        </div>

        {undelivered && (
          <button
            type="button"
            className="btn primary auth-submit auth-status-action"
            disabled={sending}
            onClick={() => resend.resend(email)}
          >
            {sending ? (
              <>
                <SpinnerIcon />
                Sending…
              </>
            ) : (
              'Send the email'
            )}
          </button>
        )}
      </div>

      {resend.state === 'failed' && <div className="error-banner">{resend.message}</div>}

      <p className="auth-note" aria-live="polite">
        {undelivered ? (
          <>Wrong address? </>
        ) : resend.state === 'sent' ? (
          <>
            A new link is on its way — the earlier one no longer works. Still nothing?{' '}
            {resendButton('Send it again')} or{' '}
          </>
        ) : (
          <>
            Nothing arrived? Check your spam folder, or {resendButton('resend the email')}. Wrong
            address?{' '}
          </>
        )}
        <button type="button" className="auth-linkbtn" onClick={onDifferentEmail}>
          {resend.state === 'sent' ? 'use a different email' : 'Use a different email'}
        </button>
        .
      </p>

      <p className="auth-footer">
        Already confirmed? <Link to="/login">Sign in</Link>
      </p>
    </>
  );
}

export function RegisterPage() {
  const register = useAuthStore((s) => s.register);
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // True once a submit was refused over the password. From then on the checklist
  // marks what is still missing in red and the banner names it — both derived
  // from the field, so they clear themselves as the password is corrected.
  const [flagUnmet, setFlagUnmet] = useState(false);
  const policyError = passwordPolicyMessage(password);
  const banner = (flagUnmet && policyError) || error;
  // Set once the account exists but its email still has to be confirmed: the
  // form gives way to "check your email", and nobody is signed in yet.
  const [pending, setPending] = useState<RegisterResult | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    // Checked here rather than left to the browser's minLength/pattern bubble,
    // so the message is ours and the request is never sent with a weak password.
    if (policyError) {
      setFlagUnmet(true);
      setError('');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await register(name, email, password);
      if (result.verificationRequired) setPending(result);
      else navigate('/projects/upload');
    } catch (err: unknown) {
      setError(errorMessage(err, 'Registration failed'));
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

        {pending ? (
          <CheckYourEmail
            email={email}
            pending={pending}
            onDifferentEmail={() => setPending(null)}
          />
        ) : (
          <>
            <div className="auth-heading">
              <h2>Create account</h2>
              <p>Start captioning in minutes.</p>
            </div>

            {banner && <div className="error-banner">{banner}</div>}

            <form className="auth-form" onSubmit={onSubmit}>
              <div className="auth-field">
                <label htmlFor="register-name">Name</label>
                <div className="auth-input-wrap">
                  <UserIcon />
                  <input
                    id="register-name"
                    autoComplete="name"
                    placeholder="Your name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="auth-field">
                <label htmlFor="register-email">Email</label>
                <div className="auth-input-wrap">
                  <MailIcon />
                  <input
                    id="register-email"
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
                <label htmlFor="register-password">Password</label>
                <PasswordInput
                  id="register-password"
                  autoComplete="new-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  aria-describedby="register-password-rules"
                />
                <PasswordChecklist
                  id="register-password-rules"
                  password={password}
                  flagUnmet={flagUnmet}
                />
              </div>

              <button className="btn primary auth-submit" disabled={busy} type="submit">
                {busy ? (
                  <>
                    <SpinnerIcon />
                    Creating…
                  </>
                ) : (
                  <>
                    Create account
                    <ArrowRightIcon />
                  </>
                )}
              </button>
            </form>

            <p className="auth-footer">
              Have an account? <Link to="/login">Sign in</Link>
            </p>
          </>
        )}
      </section>
    </main>
  );
}
