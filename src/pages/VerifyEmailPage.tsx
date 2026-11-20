import { type FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import {
  INVALID_VERIFY_TOKEN,
  errorCode,
  useResendVerification,
  type VerifiedEmailState,
} from '../lib/emailVerification';
import { AuthBrand } from '../components/AuthParts';
import {
  ArrowClockwise,
  CheckCircle,
  EnvelopeSimple,
  PaperPlaneTilt,
  WarningCircle,
  XCircle,
} from '@phosphor-icons/react';

/** Long enough that "Confirming…" is read rather than flashed past. */
const MIN_CHECK_MS = 700;
/** How long "Email confirmed" stays up before sign-in replaces it. */
const VERIFIED_HOLD_MS = 1600;

type Phase = 'checking' | 'verified' | 'invalid' | 'error';

function SpinnerIcon() {
  return (
    <svg className="auth-spinner" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return <CheckCircle size={26} aria-hidden="true" />;
}

function CrossIcon() {
  return <XCircle size={26} aria-hidden="true" />;
}

/**
 * A dead link cannot say whose it was, so getting a new one starts with the
 * address. The reply is the server's own wording — it never confirms whether
 * that address has an account waiting.
 */
function NewLinkForm() {
  const [email, setEmail] = useState('');
  const resend = useResendVerification();

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void resend.resend(email);
  }

  if (resend.state === 'sent') {
    return (
      <p className="auth-note" role="status">
        {resend.message}
      </p>
    );
  }

  return (
    <>
      {resend.state === 'failed' && <div className="error-banner">{resend.message}</div>}
      <form className="auth-form" onSubmit={onSubmit}>
        <div className="auth-field">
          <label htmlFor="verify-resend-email">Email you signed up with</label>
          <div className="auth-input-wrap">
            <EnvelopeSimple size={18} aria-hidden="true" />
            <input
              id="verify-resend-email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
        </div>
        <button
          className="btn primary auth-submit"
          disabled={resend.state === 'sending'}
          type="submit"
        >
          {resend.state === 'sending' ? (
            <>
              <SpinnerIcon />
              Sending…
            </>
          ) : (
            <>
              <PaperPlaneTilt size={17} aria-hidden="true" />
              Send a new link
            </>
          )}
        </button>
      </form>
    </>
  );
}

/**
 * Where the emailed sign-up link lands. It redeems the token with the server,
 * shows the outcome, and then moves on to sign-in — confirming an address never
 * signs anyone in, so the password they chose is still the way in.
 */
export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();

  const [phase, setPhase] = useState<Phase>('checking');
  const [message, setMessage] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!token) return;

    const ctrl = new AbortController();
    const started = Date.now();
    let timer: number | undefined;
    const after = (ms: number, fn: () => void) => {
      timer = window.setTimeout(fn, Math.max(0, ms));
    };
    const restOfMinimum = () => MIN_CHECK_MS - (Date.now() - started);

    // Safe to send twice (React's dev double-mount, a refresh, a second click on
    // the email): the server answers "confirmed" for a link it already redeemed.
    api
      .post('/auth/verify-email', { token }, { signal: ctrl.signal })
      .then(({ data }) => {
        if (ctrl.signal.aborted) return;
        const verifiedEmail = typeof data?.email === 'string' ? data.email : '';
        after(restOfMinimum(), () => {
          setPhase('verified');
          after(VERIFIED_HOLD_MS, () => {
            // replace: Back from sign-in should leave the flow, not re-verify.
            navigate('/login', {
              replace: true,
              state: { verifiedEmail } satisfies VerifiedEmailState,
            });
          });
        });
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        after(restOfMinimum(), () => {
          // Only the server saying "this token is no good" is a dead link. A
          // timeout, an outage or a rate limit is not — offer a retry instead of
          // sending someone for a new email they do not need.
          setMessage(errorMessage(err, 'We could not check this link.'));
          setPhase(errorCode(err) === INVALID_VERIFY_TOKEN ? 'invalid' : 'error');
        });
      });

    return () => {
      ctrl.abort();
      window.clearTimeout(timer);
    };
  }, [token, attempt, navigate]);

  function retry() {
    setPhase('checking');
    setMessage('');
    setAttempt((n) => n + 1);
  }

  const view = !token
    ? {
        tone: ' is-bad',
        icon: <CrossIcon />,
        title: 'Link is incomplete',
        body: 'This confirmation link is missing its token. Copy the full link from the email, or send yourself a new one.',
      }
    : phase === 'checking'
      ? {
          tone: '',
          icon: <SpinnerIcon />,
          title: 'Confirming your email…',
          body: 'Hold on a moment while we check your link.',
        }
      : phase === 'verified'
        ? {
            tone: ' is-ok',
            icon: <CheckIcon />,
            title: 'Email confirmed',
            body: 'Taking you to sign in…',
          }
        : phase === 'invalid'
          ? {
              tone: ' is-bad',
              icon: <CrossIcon />,
              title: 'This link no longer works',
              body: `${message} If you already confirmed your email, just sign in.`,
            }
          : {
              tone: ' is-bad',
              icon: <WarningCircle size={26} aria-hidden="true" />,
              title: "We couldn't confirm your email",
              body: message,
            };

  const needsNewLink = !token || phase === 'invalid';

  return (
    <main className="auth-page">
      <div className="auth-glow" aria-hidden="true" />
      <div className="auth-orb" aria-hidden="true" />

      <section className="auth-card">
        <AuthBrand />

        <div className="auth-status" role="status" aria-live="polite">
          <div className={`auth-status-icon${view.tone}`}>{view.icon}</div>
          <div className="auth-heading">
            <h2>{view.title}</h2>
            <p>{view.body}</p>
          </div>

          {phase === 'error' && token ? (
            <button
              type="button"
              className="btn primary auth-submit auth-status-action"
              onClick={retry}
            >
              <ArrowClockwise size={17} aria-hidden="true" />
              Try again
            </button>
          ) : null}
        </div>

        {needsNewLink && <NewLinkForm />}

        {phase !== 'verified' && (
          <p className="auth-footer">
            <Link to="/login">Back to sign in</Link>
          </p>
        )}
      </section>
    </main>
  );
}
