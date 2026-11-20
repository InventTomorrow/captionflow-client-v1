import { useState } from 'react';
import { api, API_URL } from '../lib/api';
import { useGoogleEnabled } from '../lib/useGoogleEnabled';

export function GoogleSignInButton() {
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const enabled = useGoogleEnabled();

  async function startGoogleSignIn() {
    setChecking(true);
    setError('');
    try {
      const { data } = await api.get<{ enabled: boolean }>('/auth/google/status', { timeout: 5000 });
      if (!data.enabled) {
        setError('Google sign-in is not available yet. Please use your email and password.');
        return;
      }
      window.location.assign(`${API_URL}/api/auth/google`);
    } catch {
      setError('Google sign-in is unavailable right now. Please try again later.');
    } finally {
      setChecking(false);
    }
  }

  // Shown only when Google sign-in is set up on the server.
  if (!enabled) return null;

  return (
    <div className="auth-google-group">
      <div className="auth-google-divider"><span>or</span></div>
      <button className="auth-google-button" type="button" disabled={checking} onClick={() => void startGoogleSignIn()}>
        <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true">
          <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
          <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.25 5.48-4.76 7.18l7.73 6C44.42 38.03 46.98 31.88 46.98 24.55z" />
          <path fill="#FBBC05" d="M10.53 28.59A14.4 14.4 0 0 1 9.75 24c0-1.6.27-3.14.77-4.59l-7.98-6.2A23.9 23.9 0 0 0 0 24c0 3.87.93 7.51 2.56 10.78l7.97-6.19z" />
          <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.91-5.8l-7.73-6c-2.14 1.44-4.87 2.3-8.18 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.97 6.19C6.51 42.62 14.62 48 24 48z" />
        </svg>
        {checking ? 'Connecting to Google…' : 'Continue with Google'}
      </button>
      {error && <p className="auth-google-error" role="alert">{error}</p>}
    </div>
  );
}
