/**
 * The hand-off between the two password-reset pages.
 *
 * The emailed link opens the verify page; only once the server has confirmed
 * the token does that page move on to the new-password form, carrying the
 * checked token in router state. The form refuses to render without it.
 */

/** Router state the verify page passes on: the token it just checked. */
export interface VerifiedResetState {
  verifiedToken: string;
}

/** With no token it is still the right place: that page explains the link is incomplete. */
export function verifyResetLinkPath(token: string): string {
  return token
    ? `/reset-password/verify?token=${encodeURIComponent(token)}`
    : '/reset-password/verify';
}

export function resetPasswordPath(token: string): string {
  return `/reset-password?token=${encodeURIComponent(token)}`;
}
