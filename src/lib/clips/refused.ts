/**
 * clips/refused.ts — did the server definitely say no?
 *
 * A 4xx answer means the request was refused and nothing was started, so what
 * was made for it (a just-uploaded project) can be removed. A timeout, a
 * dropped connection or a 5xx may have started it anyway (the job queued, the
 * quota held), so those are left alone.
 */
export function refusedByServer(err: unknown): boolean {
  const status = (err as { response?: { status?: unknown } } | null | undefined)?.response?.status;
  return typeof status === 'number' && status >= 400 && status < 500;
}
