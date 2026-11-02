/**
 * Pieces shared by the sign-in / register / password pages: the stacked
 * brand block, a password input with a show/hide toggle, and the new-password
 * rules checklist.
 */

import { useState, type InputHTMLAttributes, type ReactNode } from 'react';
import {
  ArrowRight,
  AudioLines,
  Captions,
  CheckCircle2,
  Clock3,
  Cloud,
  Grid2X2,
  Languages,
  Play,
  Scissors,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Volume2,
  WandSparkles,
  Zap,
} from 'lucide-react';
import { PASSWORD_RULES } from '../lib/passwordPolicy';

type AuthMode = 'login' | 'register';

const MARKETING_FEATURES = [
  { Icon: Captions, title: 'AI Captions', detail: 'Accurate & stylish' },
  { Icon: Zap, title: 'Quick Edits', detail: 'Trim, highlight, export' },
  { Icon: Grid2X2, title: 'Pro Templates', detail: '9:16, 16:9 ready' },
  { Icon: Cloud, title: 'Cloud Workspace', detail: 'Access anywhere' },
] as const;

function AuthFeatureItem({ Icon, title, detail }: (typeof MARKETING_FEATURES)[number]) {
  return (
    <div className="auth-feature-item">
      <span className="auth-feature-icon"><Icon aria-hidden="true" /></span>
      <span><strong>{title}</strong><small>{detail}</small></span>
    </div>
  );
}

function AuthMetric({ icon, value, label }: { icon: ReactNode; value: string; label: string }) {
  return (
    <div className="auth-preview-metric">
      <span className="auth-metric-icon">{icon}</span>
      <span><strong>{value}</strong><small>{label}</small></span>
    </div>
  );
}

function AuthWorkspacePreview() {
  return (
    <div className="auth-product-preview" aria-label="Caption workspace preview">
      <div className="auth-preview-head">
        <span className="auth-preview-title"><i /> Your workspace</span>
        <span className="auth-preview-link">All projects <ArrowRight size={14} /></span>
      </div>
      <div className="auth-preview-media">
        <img src="/media/caption-studio-host.jpg" alt="Creator editing a captioned podcast video" />
        <span className="auth-preview-pill"><CheckCircle2 size={13} /> Draft saved</span>
        <span className="auth-preview-play"><Play size={18} fill="currentColor" /></span>
        <span className="auth-preview-duration">02:14</span>
        <p>Make every <strong>moment</strong><br />impossible to miss.</p>
        <div className="auth-preview-track"><i /></div>
      </div>
      <div className="auth-preview-metrics">
        <AuthMetric icon={<Captions />} value="98%" label="Caption accuracy" />
        <AuthMetric icon={<Scissors />} value="8 clips" label="Ready to publish" />
        <AuthMetric icon={<Clock3 />} value="12 min" label="Time saved" />
        <AuthMetric icon={<TrendingUp />} value="4.5x" label="Higher engagement" />
      </div>
    </div>
  );
}

function AuthOrbitBackground() {
  return (
    <div className="auth-orbit-layer" aria-hidden="true">
      <span className="auth-orbit auth-orbit-one" />
      <span className="auth-orbit auth-orbit-two" />
      <span className="auth-orbit auth-orbit-three" />
      <i className="auth-orbit-node auth-node-one" />
      <i className="auth-orbit-node auth-node-two" />
      <i className="auth-orbit-node auth-node-three" />
      <i className="auth-orbit-node auth-node-four" />
      <b className="auth-orbit-spark auth-spark-one">+</b>
      <b className="auth-orbit-spark auth-spark-two">+</b>
    </div>
  );
}

function AuthFloatingDecorations() {
  return (
    <div className="auth-floating-layer" aria-hidden="true">
      <div className="auth-floating-item floating-caption-card" data-float-speed="slow" data-float-direction="up" data-rotate="-7">
        <span><Captions /></span>
        <p><strong>Auto Captions</strong><small>Turn speech into captions</small></p>
      </div>

      <div className="auth-floating-item floating-video-card" data-float-speed="medium" data-float-direction="down" data-rotate="8">
        <Play fill="currentColor" />
        <small>0:12</small>
      </div>

      <div className="auth-floating-item floating-waveform-card" data-float-speed="slow" data-float-direction="up" data-rotate="-6">
        <AudioLines />
      </div>

      <div className="auth-floating-item floating-document-card" data-float-speed="fast" data-float-direction="down" data-rotate="-11">
        <span>CC</span><i /><i /><i />
      </div>

      <div className="auth-floating-item floating-translate-card" data-float-speed="medium" data-float-direction="up" data-rotate="7">
        <Languages /><strong>Translate</strong>
      </div>

      <div className="auth-floating-item floating-clip-card" data-float-speed="slow" data-float-direction="down" data-rotate="-8">
        <span><img src="/media/caption-studio-host.jpg" alt="" /><Play fill="currentColor" /><small>0:28</small></span>
        <p><i /><i /><i /></p>
      </div>

      <div className="auth-floating-item floating-clean-audio" data-float-speed="fast" data-float-direction="up" data-rotate="-5">
        <Volume2 /><strong>Clean Audio</strong><span><i /></span>
      </div>

      <div className="auth-floating-item floating-caption-clips" data-float-speed="medium" data-float-direction="down" data-rotate="0">
        <Sparkles />
        <p><strong>Captions + Clips</strong><small>All in one place</small></p>
        <ArrowRight />
      </div>

      <div className="auth-floating-item floating-secure-workspace" data-float-speed="slow" data-float-direction="up" data-rotate="0">
        <ShieldCheck /><strong>Secure workspace</strong>
      </div>
    </div>
  );
}

/** Shared product story used by both primary authentication screens. */
export function AuthShowcase({ mode }: { mode: AuthMode }) {
  return (
    <section className="auth-showcase" data-auth-mode={mode} aria-label="Asaan Caption product preview">
      <div className="auth-showcase-grid" aria-hidden="true" />
      <div className="auth-showcase-glow" aria-hidden="true" />

      <header className="auth-showcase-head">
        <span className="auth-showcase-logo">
          <img src="/logo-mark.png" alt="" />
          <img src="/logo-wordmark.png" alt="Asaan Caption" />
        </span>
        <span className="auth-showcase-kicker"><WandSparkles size={14} /> AI Video Workspace</span>
      </header>

      <div className="auth-showcase-copy">
        <h1>
          Create faster. Publish <span>sharper.</span>
        </h1>
        <p>Pick up where you left off with captions, clips, and exports organized in one focused workspace.</p>
      </div>

      <div className="auth-feature-row">
        {MARKETING_FEATURES.map((feature) => <AuthFeatureItem key={feature.title} {...feature} />)}
      </div>

      <AuthWorkspacePreview />

      <footer className="auth-showcase-proof">
        <div className="auth-creator-proof">
          <span className="auth-avatar-stack"><i>A</i><i>S</i><i>R</i></span>
          <p><strong>Join 10,000+ creators and businesses</strong><small>Create better videos, in less time.</small></p>
        </div>
        <ul aria-label="Workspace benefits">
          <li><ShieldCheck /> Secure</li>
          <li><Sparkles /> Fast</li>
          <li><Cloud /> Always accessible</li>
        </ul>
      </footer>
    </section>
  );
}

export function AuthSplitShell({ mode, children }: { mode: AuthMode; children: ReactNode }) {
  return (
    <main className="auth-page auth-split-page">
      <AuthShowcase mode={mode} />
      <section className="auth-entry-pane" aria-label={mode === 'login' ? 'Sign in' : 'Create account'}>
        <AuthOrbitBackground />
        <AuthFloatingDecorations />
        <section className="auth-card">{children}</section>
        <p className="auth-entry-assurance"><ShieldCheck size={14} /> Private, secure, and encrypted</p>
      </section>
    </main>
  );
}

export function AuthBrand() {
  return (
    <div className="auth-brand">
      <img src="/logo-mark.png" alt="" className="auth-brand-mark-img" />
      <img src="/logo-wordmark.png" alt="Asaan Caption" className="auth-brand-wordmark" />
      <span className="auth-brand-wordmark-text">
        <strong>ASAAN</strong>
        <span>— CAPTION —</span>
      </span>
      <p className="auth-brand-tagline">Captions for long videos</p>
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
