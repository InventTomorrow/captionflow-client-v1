import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import type { ApiPlan } from '../components/PricingCards';

/**
 * Waits between automatic retries. About ten seconds in total: enough to ride
 * out an API restart or a dropped connection, short enough that someone looking
 * at the pricing section is not left guessing.
 */
const RETRY_DELAYS_MS = [1000, 2500, 6000];

/**
 * The public plan list — the landing page's pricing section and the upgrade
 * modal both read it.
 *
 * A request that FAILED is not an empty list. The two used to be folded
 * together (`.catch(() => setPlans([]))`), so one refused connection at page
 * load showed "Pricing isn't configured yet" — blaming setup for a blip, on the
 * page that sells the product, until someone happened to refresh. Here a
 * failure retries on its own, and if that runs out it is reported as a failure,
 * with `retry` to try again. `plans` is `[]` only when the server really
 * answered with none.
 */
export function usePlans(enabled = true): {
  /** `null` while loading (including during automatic retries). */
  plans: ApiPlan[] | null;
  /** True once the automatic retries are used up. */
  failed: boolean;
  retry: () => void;
} {
  const [plans, setPlans] = useState<ApiPlan[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (!enabled) return;

    const ctrl = new AbortController();
    let timer: number | undefined;
    let attempt = 0;

    const load = () => {
      api
        .get('/billing/plans', { signal: ctrl.signal })
        .then((r) => {
          if (ctrl.signal.aborted) return;
          // A 200 that is not the plan list (a misrouted API URL answers with
          // the site's own HTML) is a failure too, not "no plans".
          if (!Array.isArray(r.data?.plans)) throw new Error('Unexpected /billing/plans reply');
          setPlans(r.data.plans as ApiPlan[]);
          setFailed(false);
        })
        .catch(() => {
          if (ctrl.signal.aborted) return;
          const delay = RETRY_DELAYS_MS[attempt++];
          if (delay === undefined) setFailed(true);
          else timer = window.setTimeout(load, delay);
        });
    };
    load();

    return () => {
      ctrl.abort();
      window.clearTimeout(timer);
    };
  }, [enabled, round]);

  const retry = useCallback(() => {
    setFailed(false);
    setRound((n) => n + 1);
  }, []);

  return { plans, failed, retry };
}
