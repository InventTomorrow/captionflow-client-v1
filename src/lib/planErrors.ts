/**
 * Maps a QUOTA_EXCEEDED / PLAN_EXPIRED API error to the specific reason a
 * user should see (trial over vs. plan expired vs. out of credits), each
 * with its own copy and an upgrade CTA — instead of one generic "hit your
 * plan limit" message for every case.
 */

export interface ApiErrorPayload {
  code?: string;
  message?: string;
  details?: {
    code?: string;
    reason?: string;
    used?: number;
    limit?: number;
  };
}

export interface PlanErrorInfo {
  reason: 'trial_expired' | 'plan_expired' | 'out_of_credits' | 'feature_disabled' | 'other_limit';
  title: string;
  message: string;
  /** Only the billing-driven reasons get an upgrade CTA. */
  showUpgrade: boolean;
}

export function resolvePlanError(data?: ApiErrorPayload): PlanErrorInfo | null {
  if (!data) return null;
  const code = data.code || data.details?.code;

  if (code === 'PLAN_FEATURE_DISABLED') {
    return {
      reason: 'feature_disabled',
      title: data.message || 'Not available on your plan',
      message: 'Upgrade to a paid plan to unlock this feature.',
      showUpgrade: true,
    };
  }

  if (code === 'PLAN_EXPIRED') {
    return {
      reason: 'plan_expired',
      title: 'Your plan has expired',
      message: data.message || 'Renew your plan to keep captioning.',
      showUpgrade: true,
    };
  }

  if (code === 'QUOTA_EXCEEDED') {
    const reason = data.details?.reason;
    if (reason === 'trial_expired') {
      return {
        reason: 'trial_expired',
        title: 'Your free trial is over',
        message: 'You have used all the caption minutes included in the free plan.',
        showUpgrade: true,
      };
    }
    if (reason === 'out_of_credits') {
      const { used, limit } = data.details || {};
      return {
        reason: 'out_of_credits',
        title: "You're out of credits",
        message:
          used != null && limit != null
            ? `You've used ${used} of ${limit} minutes for this billing period.`
            : 'You have used all the caption minutes for this billing period.',
        showUpgrade: true,
      };
    }
    return {
      reason: 'other_limit',
      title: 'Plan limit reached',
      message: data.message || "You've hit your plan limit.",
      showUpgrade: false,
    };
  }

  return null;
}
