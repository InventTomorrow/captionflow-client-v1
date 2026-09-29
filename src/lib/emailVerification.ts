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
