import { useState } from 'react';
import { ImageSquare } from '@phosphor-icons/react';
import { api, API_URL } from '../lib/api';
import { useGoogleEnabled } from '../lib/useGoogleEnabled';

/**
 * "Connect Google photo" for accounts without a profile photo. Once there is
 * one, nothing is shown: the photo refreshes by itself — every Google sign-in
 * stores the account's current photo (auth.controller googleCallback) — so a
 * manual "Refresh Google photo" button is not needed.
 */
export function ConnectGooglePhotoButton({
  hasPhoto,
  className,
  role,
}: {
  hasPhoto?: boolean;
  className?: string;
  role?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const enabled = useGoogleEnabled();

  async function connect() {
    setBusy(true);
    setError('');
    try {
      const { data } = await api.get<{ enabled: boolean }>('/auth/google/status', { timeout: 5000 });
      if (!data.enabled) {
        setError('Google connection is not available yet.');
        return;
      }
      window.location.assign(`${API_URL}/api/auth/google/link`);
    } catch {
      setError('Google connection is unavailable right now.');
    } finally {
      setBusy(false);
    }
  }

  // Nothing once there's a photo, or while Google sign-in isn't set up on the server.
  if (hasPhoto || !enabled) return null;

  return (
    <>
      <button type="button" className={className} role={role} disabled={busy} onClick={() => void connect()}>
        <ImageSquare size={16} aria-hidden="true" />
        Connect Google photo
      </button>
      {error && <small className="google-photo-error" role="alert">{error}</small>}
    </>
  );
}
