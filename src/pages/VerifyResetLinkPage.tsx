import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { resetPasswordPath, type VerifiedResetState } from '../lib/resetLink';
import { AuthBrand } from '../components/AuthParts';

/** Long enough that "Verifying…" is read rather than flashed past. */
const MIN_CHECK_MS = 700;
/** How long "Link verified" stays up before the form replaces it. */
const VERIFIED_HOLD_MS = 900;

type Phase = 'checking' | 'verified' | 'invalid' | 'error';

const ICON_PROPS = {
  xmlns: 'http://www.w3.org/2000/svg',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.25,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

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
    <svg {...ICON_PROPS}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4.5" />
      <path d="M12 16h.01" />
    </svg>
  );
}

/**
 * Where the emailed reset link lands. It asks the server whether the token is
 * still good and only then moves on to the new-password form — so an expired or
 * already-used link is reported here, not after someone has typed a password.
 */
export function VerifyResetLinkPage() {
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

    api
      .post('/auth/reset-password/verify', { token }, { signal: ctrl.signal })
      .then(() => {
        if (ctrl.signal.aborted) return;
        after(restOfMinimum(), () => {
          setPhase('verified');
          after(VERIFIED_HOLD_MS, () => {
            // replace: Back from the form should leave the flow, not re-verify.
            navigate(resetPasswordPath(token), {
              replace: true,
              state: { verifiedToken: token } satisfies VerifiedResetState,
            });
          });
        });
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        const code = (err as { response?: { data?: { code?: unknown } } })?.response?.data?.code;
        after(restOfMinimum(), () => {
          // Only the server saying "this token is no good" is a dead link. A
          // timeout, an outage or a rate limit is not — offer a retry instead of
          // sending someone to request a link they do not need.
          setMessage(errorMessage(err, 'We could not check this link.'));
          setPhase(code === 'INVALID_RESET_TOKEN' ? 'invalid' : 'error');
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
        body: 'This reset link is missing its token. Copy the full link from the email, or request a new one.',
      }
    : phase === 'checking'
      ? {
          tone: '',
          icon: <SpinnerIcon />,
          title: 'Verifying your link…',
          body: 'Hold on a moment while we check your reset link.',
        }
      : phase === 'verified'
        ? {
            tone: ' is-ok',
            icon: <CheckIcon />,
            title: 'Link verified',
            body: 'Taking you to choose a new password…',
          }
        : phase === 'invalid'
          ? {
              tone: ' is-bad',
              icon: <CrossIcon />,
              title: 'This link no longer works',
              body: message,
            }
          : {
              tone: ' is-bad',
              icon: <AlertIcon />,
              title: "We couldn't verify your link",
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

          {needsNewLink ? (
            <Link className="btn primary auth-submit auth-status-action" to="/forgot-password">
              Request a new link
            </Link>
          ) : phase === 'error' ? (
            <button
              type="button"
              className="btn primary auth-submit auth-status-action"
              onClick={retry}
            >
              Try again
            </button>
          ) : null}
        </div>

        {phase !== 'verified' && (
          <p className="auth-footer">
            <Link to="/login">Back to sign in</Link>
          </p>
        )}
      </section>
    </main>
  );
}
