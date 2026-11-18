/**
 * Pieces shared by the sign-in / register / password pages: the minimal
 * split layout (the product story on the left, the form on the right, in
 * the landing page's style), the brand block, a password input with a
 * show/hide toggle, and the new-password rules checklist.
 */

import { useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { PASSWORD_RULES } from '../lib/passwordPolicy';
import { BrandLogo } from './BrandLogo';

type AuthMode = 'login' | 'register';

const POINTS = [
  ['01', 'Urdu, English and Roman Urdu — even mixed mid-sentence'],
  ['02', 'Edit words and timing, then pick a caption style'],
  ['03', 'Export burned-in video or an SRT file'],
] as const;

/** The product story beside the form (hidden on small screens). */
export function AuthShowcase({ mode }: { mode: AuthMode }) {
  return (
    <section className="auth-showcase" data-auth-mode={mode} aria-label="Asaan Caption">
      <header className="auth-showcase-head">
        <a href="/" className="auth-showcase-logo" aria-label="Asaan Caption home"><BrandLogo /></a>
      </header>

      <div className="auth-showcase-copy">
        <div className="auth-eyebrow"><span className="auth-dot" /> BUILT FOR THE WAY PAKISTAN SPEAKS</div>
        <h1>
          Need Urdish captions?
          <br />
          <span>We got it.</span>
        </h1>
        <p>Automatic captions engineered for the way Pakistan speaks — Urdu, Roman Urdu, and everything in between.</p>
      </div>

      <ol className="auth-points">
        {POINTS.map(([n, text]) => (
          <li key={n}><span>{n}</span>{text}</li>
        ))}
      </ol>

      <footer className="auth-showcase-proof">
        <span>Trusted by thousands of Pakistani creators</span>
        <span>MADE IN PAKISTAN ✳</span>
      </footer>
    </section>
  );
}

export function AuthSplitShell({ mode, children }: { mode: AuthMode; children: ReactNode }) {
  return (
    <main className="auth-page auth-split-page">
      <AuthShowcase mode={mode} />
      <section className="auth-entry-pane" aria-label={mode === 'login' ? 'Sign in' : 'Create account'}>
        <section className="auth-card">{children}</section>
        <p className="auth-entry-assurance">Private, secure, and encrypted</p>
      </section>
    </main>
  );
}

export function AuthBrand() {
  return (
    <div className="auth-brand">
      <a href="/" className="auth-brand-link" aria-label="Asaan Caption home"><BrandLogo /></a>
      <p className="auth-brand-tagline">Captions for the way Pakistan speaks</p>
    </div>
  );
}

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

function EyeIcon({ off }: { off: boolean }) {
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
      <path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0" />
      <circle cx="12" cy="12" r="3" />
      {off && <path d="m3 3 18 18" />}
    </svg>
  );
}

export function ArrowRightIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="auth-submit-arrow"
    >
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

/** Lock icon on the left, show/hide toggle on the right. */
export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="auth-input-wrap has-toggle">
      <LockIcon />
      <input {...props} type={visible ? 'text' : 'password'} />
      <button
        type="button"
        className="auth-eye"
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        onClick={() => setVisible((v) => !v)}
      >
        <EyeIcon off={visible} />
      </button>
    </div>
  );
}

function RuleIcon({ met }: { met: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6.25" />
      {met && <path d="m5.2 8.3 1.9 1.9 3.7-4" />}
    </svg>
  );
}

/**
 * The new-password rules as a live checklist — each one ticks as it is met.
 * Goes under every field where a password is CHOSEN (sign-up, reset), never
 * under sign-in. Point the input's `aria-describedby` at `id`.
 *
 * `flagUnmet` turns the rules still missing red. Set it once a submit has been
 * refused, so the list stays calm while someone is typing their first attempt.
 */
export function PasswordChecklist({
  id,
  password,
  flagUnmet = false,
}: {
  id: string;
  password: string;
  flagUnmet?: boolean;
}) {
  return (
    <ul id={id} className="auth-pw-rules" aria-label="Password requirements">
      {PASSWORD_RULES.map((rule) => {
        const met = rule.test(password);
        return (
          <li key={rule.id} className={met ? 'is-met' : flagUnmet ? 'is-missing' : undefined}>
            <RuleIcon met={met} />
            <span>{rule.label}</span>
            <span className="auth-sr-only">{met ? ' (met)' : ' (not met yet)'}</span>
          </li>
        );
      })}
    </ul>
  );
}
