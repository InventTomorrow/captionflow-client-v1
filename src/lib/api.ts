import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

export const api = axios.create({
  baseURL: `${API_URL}/api`,
  withCredentials: true,
  timeout: 60_000,
});

let accessToken: string | null = localStorage.getItem('cf_access');
let refreshing: Promise<string | null> | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
  if (token) localStorage.setItem('cf_access', token);
  else localStorage.removeItem('cf_access');
}

export function getAccessToken() {
  return accessToken;
}

api.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

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
          .then((r) => {
            setAccessToken(r.data.accessToken);
            return r.data.accessToken as string;
          })
          .catch(() => {
            setAccessToken(null);
            // Clearing the token alone left useAuthStore's `user` truthy,
            // so <Private> kept rendering the protected page — every
            // subsequent request then went out with no Authorization
            // header, 401'd again, and silently retried this same doomed
            // refresh forever with no "session expired" message and no way
            // out except a manual reload. Force both the app state and a
            // real navigation to /login so an expired session actually ends
            // the session, in whichever tab notices first.
            void import('../stores/authStore').then(({ useAuthStore }) => {
              useAuthStore.setState({ user: null, loading: false });
            });
            if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
              window.location.href = '/login';
            }
            return null;
          })
          .finally(() => {
            refreshing = null;
          });
      }
      const token = await refreshing;
      if (token) {
        original.headers.Authorization = `Bearer ${token}`;
        return api(original);
      }
    }
    return Promise.reject(error);
  },
);

export { API_URL };
