/**
 * Whether Google sign-in is set up on the server (GET /auth/google/status).
 * Google buttons render only once it says yes, so a server without Google
 * credentials never shows a button that can only answer "not available".
 * One request per page load, shared by every caller.
 */
import { useEffect, useState } from 'react';
import { api } from './api';

let status: Promise<boolean> | null = null;

export function googleEnabled(): Promise<boolean> {
  status ??= api
    .get<{ enabled: boolean }>('/auth/google/status', { timeout: 5000 })
    .then((r) => r.data.enabled === true)
    .catch(() => {
      status = null; // try again next time
      return false;
    });
  return status;
}

export function useGoogleEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let alive = true;
    void googleEnabled().then((on) => alive && setEnabled(on));
    return () => {
      alive = false;
    };
  }, []);
  return enabled;
}
