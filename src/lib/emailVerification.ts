/**
 * Shared by the three pages that touch sign-up email verification: the
 * "check your email" screen after sign-up, the page the emailed link opens, and
 * sign-in (which refuses an unconfirmed account and offers another email).
 */

import { useState } from 'react';
import { api, errorMessage } from './api';

/** Sign-in with the right password on an account whose link was never opened. */
export const EMAIL_NOT_VERIFIED = 'EMAIL_NOT_VERIFIED';
/** The emailed link is unknown, replaced by a newer one, or expired. */
export const INVALID_VERIFY_TOKEN = 'INVALID_VERIFY_TOKEN';

/** An emailed 6-digit code is wrong, used, out of tries or expired. */
export const INVALID_CODE = 'INVALID_CODE';

/** What a sign-in refused for an unconfirmed email says about the code it sent. */
export interface PendingCode {
  email: string;
  emailSent: boolean;
  codeLength?: number;
  expiresInMinutes?: number;
}

/** The code details from an EMAIL_NOT_VERIFIED reply, or null from a server that mails links. */
export function pendingCodeFrom(err: unknown, fallbackEmail: string): PendingCode | null {
  const d = (err as { response?: { data?: { details?: Record<string, unknown> } } })?.response?.data
    ?.details;
  if (!d || d.method !== 'code') return null;
  return {
    email: typeof d.email === 'string' ? d.email : fallbackEmail,
    emailSent: d.emailSent !== false,
    codeLength: typeof d.codeLength === 'number' ? d.codeLength : undefined,
    expiresInMinutes: typeof d.expiresInMinutes === 'number' ? d.expiresInMinutes : undefined,
  };
}

/** Ask for a new sign-up code; resolves with the server's (deliberately vague) wording. */
export async function resendVerificationCode(email: string): Promise<string> {
  const { data } = await api.post('/auth/resend-verification', { email });
  return typeof data?.message === 'string' ? data.message : 'A new code is on its way.';
}

/** The `code` field of the server's error body, if this was a server error. */
export function errorCode(err: unknown): string | undefined {
  const code = (err as { response?: { data?: { code?: unknown } } })?.response?.data?.code;
  return typeof code === 'string' ? code : undefined;
}

/** Router state the verify page hands to sign-in: the address it just confirmed. */
export interface VerifiedEmailState {
  verifiedEmail: string;
}

export type ResendState = 'idle' | 'sending' | 'sent' | 'failed';

/**
 * Ask for another verification email.
 *
 * The server answers the same whether or not the address has an account waiting
 * (it must not confirm which addresses exist), so `message` on success is its
 * wording, not a promise that mail was sent — show it as it is.
 */
export function useResendVerification() {
  const [state, setState] = useState<ResendState>('idle');
  const [message, setMessage] = useState('');

  async function resend(email: string) {
    setState('sending');
    setMessage('');
    try {
      const { data } = await api.post('/auth/resend-verification', { email });
      setMessage(
        typeof data?.message === 'string' ? data.message : 'A new link is on its way.',
      );
      setState('sent');
    } catch (err: unknown) {
      setMessage(errorMessage(err, 'Could not send the email. Try again.'));
      setState('failed');
    }
  }

  function reset() {
    setState('idle');
    setMessage('');
  }

  return { state, message, resend, reset };
}
