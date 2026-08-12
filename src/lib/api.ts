import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

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
      url.includes('/auth/logout');

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
