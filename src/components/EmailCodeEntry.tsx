import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { EnvelopeSimple, ShieldCheck } from '@phosphor-icons/react';
import { errorMessage } from '../lib/api';

/** Seconds before "Send a new code" can be pressed again. */
const RESEND_COOLDOWN_S = 30;

function SpinnerIcon() {
  return (
    <svg className="auth-spinner" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/**
 * "Enter the 6-digit code we emailed you": used by sign-up, sign-in (an
 * unconfirmed account) and forgot-password.
 *
 * One plain text field rather than six boxes: pasting the code, the phone's
 * one-time-code autofill and screen readers all work with it as they are.
 */
export function EmailCodeEntry({
  email,
  title = 'Check your email',
  emailSent = true,
  codeLength = 6,
  expiresInMinutes,
  submitLabel = 'Verify',
  intro,
  onSubmit,
  onResend,
  onDifferentEmail,
}: {
  email: string;
  title?: string;
  /** False when the first email could not be sent: say so and lead with "send". */
  emailSent?: boolean;
  codeLength?: number;
  expiresInMinutes?: number;
  submitLabel?: string;
  /** Replaces "We sent a code to …" (e.g. where the server must not confirm an account exists). */
  intro?: ReactNode;
  /** Resolves when the code is accepted; throws (server error) when it is not. */
  onSubmit: (code: string) => Promise<void>;
  /** Asks for a new code. Resolves with the server's wording, or throws. */
  onResend: () => Promise<string | void>;
  onDifferentEmail?: () => void;
}) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [delivered, setDelivered] = useState(emailSent);
  const [cooldown, setCooldown] = useState(emailSent ? RESEND_COOLDOWN_S : 0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  const digits = code.replace(/\D/g, '');
  const complete = digits.length === codeLength;

  async function submit(value: string) {
    setBusy(true);
    setError('');
    setNote('');
    try {
      await onSubmit(value);
    } catch (err: unknown) {
      setError(errorMessage(err, 'Could not check the code. Try again.'));
      setCode('');
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  function onFormSubmit(e: FormEvent) {
    e.preventDefault();
    if (!complete || busy) return;
    void submit(digits);
  }

  function onChange(value: string) {
    // Keep digits only, so a pasted "123 456" or "Code: 123456" still fits.
    const next = value.replace(/\D/g, '').slice(0, codeLength);
    setCode(next);
    if (error) setError('');
    // A full code (typed, pasted or autofilled) is sent straight away.
    if (next.length === codeLength && !busy) void submit(next);
  }

  async function resend() {
    setResending(true);
    setError('');
    setNote('');
    try {
      const message = await onResend();
      setDelivered(true);
      setNote(typeof message === 'string' && message ? message : 'A new code is on its way.');
      setCode('');
      setCooldown(RESEND_COOLDOWN_S);
      inputRef.current?.focus();
    } catch (err: unknown) {
      setError(errorMessage(err, 'Could not send a new code. Try again.'));
    } finally {
      setResending(false);
    }
  }

  return (
    <>
      <div className="auth-status">
        <div className="auth-status-icon">
          <EnvelopeSimple size={18} aria-hidden="true" />
        </div>
        <div className="auth-heading">
          <h2>{delivered ? title : 'One more step'}</h2>
          {delivered && intro ? (
            <p>{intro}</p>
          ) : delivered ? (
            <p>
              We sent a {codeLength}-digit code to <strong className="auth-email">{email}</strong>.
              {expiresInMinutes ? ` It expires in ${expiresInMinutes} minutes.` : ''}
            </p>
          ) : (
            <p>
              We couldn't send the code to <strong className="auth-email">{email}</strong> just
              now. Send it again to continue.
            </p>
          )}
        </div>
      </div>

      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      {note && !error && (
        <div className="ok-banner" role="status">
          {note}
        </div>
      )}

      <form className="auth-form" onSubmit={onFormSubmit}>
        <div className="auth-field">
          <label htmlFor="email-code">Code</label>
          <div className="auth-input-wrap">
            <ShieldCheck size={18} aria-hidden="true" />
            <input
              ref={inputRef}
              id="email-code"
              className="auth-code-input"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern={`\\d{${codeLength}}`}
              maxLength={codeLength + 2}
              placeholder={'•'.repeat(codeLength)}
              value={code}
              onChange={(e) => onChange(e.target.value)}
              disabled={busy}
              required
              autoFocus
              aria-describedby="email-code-hint"
            />
          </div>
        </div>

        <button className="btn primary auth-submit" disabled={busy || !complete} type="submit">
          {busy ? (
            <>
              <SpinnerIcon />
              Checking…
            </>
          ) : (
            submitLabel
          )}
        </button>
      </form>

      <p className="auth-note" id="email-code-hint" aria-live="polite">
        Nothing arrived? Check your spam folder, or{' '}
        <button
          type="button"
          className="auth-linkbtn"
          disabled={resending || cooldown > 0}
          onClick={() => void resend()}
        >
          {resending ? 'sending…' : cooldown > 0 ? `send a new code (${cooldown}s)` : 'send a new code'}
        </button>
        .
        {onDifferentEmail && (
          <>
            <br />
            Wrong address?{' '}
            <button type="button" className="auth-linkbtn" onClick={onDifferentEmail}>
              Use a different email
            </button>
            .
          </>
        )}
      </p>
    </>
  );
}
