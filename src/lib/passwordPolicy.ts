/**
 * What a NEW password has to satisfy — shown as a live checklist on sign-up and
 * on the reset-password form, the only two places one is ever set. Sign-in is
 * deliberately not checked: accounts created before the policy keep the
 * password they have.
 *
 * MIRRORS server/src/utils/passwordPolicy.ts (the two are separate
 * repositories, so there is no shared module). The server is the one that
 * actually enforces these; this copy exists so nobody has to submit to find out
 * what is missing. Change both together.
 */

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export interface PasswordRule {
  id: 'length' | 'lower' | 'upper' | 'digit' | 'special';
  /** Checklist wording. */
  label: string;
  /** How the rule reads inside "Password needs …". */
  needs: string;
  test: (password: string) => boolean;
}

export const PASSWORD_RULES: readonly PasswordRule[] = [
  {
    id: 'length',
    label: `At least ${PASSWORD_MIN_LENGTH} characters`,
    needs: `at least ${PASSWORD_MIN_LENGTH} characters`,
    test: (p) => p.length >= PASSWORD_MIN_LENGTH,
  },
  {
    id: 'lower',
    label: 'One lowercase letter',
    needs: 'a lowercase letter',
    test: (p) => /[a-z]/.test(p),
  },
  {
    id: 'upper',
    label: 'One uppercase letter',
    needs: 'an uppercase letter',
    test: (p) => /[A-Z]/.test(p),
  },
  {
    id: 'digit',
    label: 'One number',
    needs: 'a number',
    test: (p) => /[0-9]/.test(p),
  },
  {
    id: 'special',
    label: 'One special character',
    needs: 'a special character',
    // Punctuation or a symbol (! @ # $ % ^ & * - _ + = ? …). A space is not one.
    test: (p) => /[\p{P}\p{S}]/u.test(p),
  },
];

export function unmetPasswordRules(password: string): PasswordRule[] {
  return PASSWORD_RULES.filter((rule) => !rule.test(password));
}

function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** Null when the password passes; otherwise one sentence naming what is missing. */
export function passwordPolicyMessage(password: string): string | null {
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Password can be at most ${PASSWORD_MAX_LENGTH} characters.`;
  }
  const unmet = unmetPasswordRules(password);
  if (!unmet.length) return null;
  return `Password needs ${joinList(unmet.map((rule) => rule.needs))}.`;
}
