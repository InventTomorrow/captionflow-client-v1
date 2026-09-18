import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4610';

export const api = axios.create({
  baseURL: `${API_URL}/api`,
  withCredentials: true,
  timeout: 60_000,
});

// Access/refresh tokens live only in httpOnly cookies set by the server —
// never in JS-reachable storage, so there's nothing to attach here. The
// browser sends them automatically on every request (withCredentials above).
let refreshing: Promise<boolean> | null = null;

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config as typeof error.config & { _retry?: boolean };
    const url = String(original?.url || '');
    const isAuthRoute =
      url.includes('/auth/login') ||
      url.includes('/auth/register') ||
      url.includes('/auth/refresh') ||
      url.includes('/auth/logout') ||
      // A 401 here is a bad/expired reset token, not an expired session —
      // refreshing and retrying would only hide the real message.
      url.includes('/auth/forgot-password') ||
      url.includes('/auth/reset-password');

    if (error.response?.status === 401 && original && !original._retry && !isAuthRoute) {
      original._retry = true;
      if (!refreshing) {
        refreshing = api
          .post('/auth/refresh')
          .then(() => true)
          .catch(() => false)
          .finally(() => {
            refreshing = null;
          });
      }
      const ok = await refreshing;
      if (ok) return api(original);
    }
    return Promise.reject(error);
  },
);

export { API_URL };

/**
 * Turn a failed request into something a user can act on.
 *
 * The obvious `err.response.data.message || 'Something failed'` hides the two
 * cases that matter most, because BOTH produce the generic fallback: the
 * server never answered at all (wrong port, not running, CORS), and it
 * answered in a shape this app does not use. Those look identical to "the
 * server rejected my input", which sends you hunting in the wrong place — a
 * dead port once read as a database outage for exactly this reason.
 *
 * So: a real server message wins; otherwise say which failure it actually was,
 * and name the URL we tried.
 */
export function errorMessage(err: unknown, fallback: string): string {
  const e = err as {
    response?: { status?: number; data?: { message?: unknown } };
    code?: string;
    message?: string;
  };

  const message = e?.response?.data?.message;
  if (typeof message === 'string' && message.trim()) return message;

  // No response object at all: the request never completed a round trip.
  if (!e?.response) {
    if (e?.code === 'ECONNABORTED') return `The server at ${API_URL} did not respond in time.`;
    return `Can't reach the server at ${API_URL} - is it running, and on that port?`;
  }

  const status = e.response.status;
  if (status === 429) return 'Too many attempts - wait a minute and try again.';
  return `${fallback} (server returned ${status ?? 'an error'} with no message)`;
}
