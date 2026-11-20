/**
 * Pieces shared by the sign-in / register / password pages: the minimal
 * split layout (the product story on the left, the form on the right, in
 * the landing page's style), the brand block, a password input with a
 * show/hide toggle, and the new-password rules checklist.
 */

import { useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { ArrowRight, CheckCircle, Circle, Eye, EyeSlash, LockSimple, ShieldCheck } from '@phosphor-icons/react';
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
    <main className="auth-page auth-split-page" data-auth-mode={mode}>
      <AuthShowcase mode={mode} />
      <section className="auth-entry-pane" aria-label={mode === 'login' ? 'Sign in' : 'Create account'}>
        <section className="auth-card">{children}</section>
        <p className="auth-entry-assurance">
          <ShieldCheck size={14} aria-hidden="true" />
          Private, secure, and encrypted
        </p>
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

export function ArrowRightIcon() {
  return <ArrowRight size={17} weight="bold" aria-hidden="true" className="auth-submit-arrow" />;
}

/** Lock icon on the left, show/hide toggle on the right. */
export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="auth-input-wrap has-toggle">
      <LockSimple size={18} aria-hidden="true" />
      <input {...props} type={visible ? 'text' : 'password'} />
      <button
        type="button"
        className="auth-eye"
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        onClick={() => setVisible((v) => !v)}
      >
        {visible ? <EyeSlash size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
      </button>
    </div>
  );
}

function RuleIcon({ met }: { met: boolean }) {
  return met ? (
    <CheckCircle size={15} weight="fill" aria-hidden="true" />
  ) : (
    <Circle size={15} weight="bold" aria-hidden="true" />
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
