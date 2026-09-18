import { useCallback, useEffect, useState } from 'react';
import { api, API_URL } from '../lib/api';
import { getSourceFile } from '../lib/media/localMedia';
import { resolvePlanError, type ApiErrorPayload, type PlanErrorInfo } from '../lib/planErrors';
import { UpgradeBanner } from './UpgradeBanner';

/**
 * What the preview plays: this device's copy of the source (OPFS) when it has
 * one, else the server stream — except for an audio-only project, whose video
 * was never uploaded, which gets a short note instead of a broken player.
 */
type PreviewSource =
  | { kind: 'loading' }
  | { kind: 'local'; url: string }
  | { kind: 'server' }
  | { kind: 'deviceOnly' }
  | { kind: 'unavailable' };

function usePreviewSource(projectId: string) {
  const [source, setSource] = useState<PreviewSource>({ kind: 'loading' });
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setSource({ kind: 'loading' });
    void (async () => {
      const file = await getSourceFile(projectId).catch(() => null);
      if (cancelled) return;
      if (file) {
        objectUrl = URL.createObjectURL(file);
        setSource({ kind: 'local', url: objectUrl });
        return;
      }
      const kind = await api
        .get(`/projects/${projectId}`)
        .then((r) => r.data.project?.video?.kind as string | undefined)
        .catch(() => undefined);
      if (cancelled) return;
      setSource(kind === 'audio' ? { kind: 'deviceOnly' } : { kind: 'server' });
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [projectId]);
  return [source, setSource] as const;
}

/**
 * "Prepare Your Media" popup shown on the editor right after upload.
 * Language options only — caption mode / Whisper settings use server defaults.
 */
export function PrepareMediaModal({
  projectId,
  onClose,
  onStarted,
}: {
  projectId: string;
  onClose: () => void;
  onStarted: () => void;
}) {
  const [sourceLanguage, setSourceLanguage] = useState('auto');
  const [outputLanguage, setOutputLanguage] = useState('keep_original');
  /** Comma-separated names and special words, sent to Deepgram as keyterms. */
  const [keyterms, setKeyterms] = useState('');
  const [error, setError] = useState('');
  const [planError, setPlanError] = useState<PlanErrorInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = usePreviewSource(projectId);
  // A <video> removed mid-load keeps fetching its src; once the blob URL is
  // revoked that turns into a stream of ERR_FILE_NOT_FOUND retries. Stop the
  // element's loading once it has really left the page (StrictMode's simulated
  // detach keeps it connected, so it is left alone there).
  const stopLoadingOnDetach = useCallback((el: HTMLVideoElement | null) => {
    if (!el) return;
    return () => {
      setTimeout(() => {
        if (el.isConnected) return;
        el.removeAttribute('src');
        el.load();
      }, 0);
    };
  }, []);

  async function onContinue() {
    setBusy(true);
    setError('');
    setPlanError(null);
    try {
      await api.post(`/projects/${projectId}/transcribe`, {
        sourceLanguage,
        outputLanguage,
        keyterms: parseKeyterms(keyterms),
      });
      onStarted();
    } catch (err: unknown) {
      const data = (err as { response?: { data?: ApiErrorPayload } })?.response?.data;
      const planErr = resolvePlanError(data);
      if (planErr) setPlanError(planErr);
      else setError(data?.message || 'Failed to start transcription');
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop prepare-backdrop" onClick={onClose}>
      <section
        className="prepare-modal"
        role="dialog"
        aria-labelledby="prepare-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="prepare-header">
          <div>
            <div className="prepare-chip">
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />
              </svg>
              Step 1 of 2
            </div>
            <h1 id="prepare-title">Prepare your media</h1>
            <p className="prepare-sub">Select a language to transcribe your media.</p>
          </div>
          <button type="button" className="prepare-icon-btn" onClick={onClose} aria-label="Close">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="prepare-media">
          {error && <div className="error-banner">{error}</div>}
          {planError && <UpgradeBanner info={planError} />}
          <div className="prepare-player">
            {preview.kind === 'local' && (
              <video
                ref={stopLoadingOnDetach}
                className="prepare-video"
                controls
                preload="metadata"
                src={preview.url}
                // This browser can't play the local file (e.g. HEVC): try the server's stream.
                onError={() => setPreview({ kind: 'server' })}
              />
            )}
            {preview.kind === 'server' && (
              <video
                ref={stopLoadingOnDetach}
                className="prepare-video"
                controls
                preload="metadata"
                src={`${API_URL}/api/projects/${projectId}/video`}
                onError={() => setPreview({ kind: 'unavailable' })}
              />
            )}
            {preview.kind === 'deviceOnly' && (
              <p className="prepare-player-note">
                No preview available here. Captions are generated from the audio.
              </p>
            )}
            {preview.kind === 'unavailable' && (
              <p className="prepare-player-note">
                No preview available here. Captions are generated from the audio.
              </p>
            )}
          </div>
        </div>

        <div className="prepare-fields">
          <label>
            <span>What language is spoken?</span>
            <div className="prepare-select-wrap">
              <select value={sourceLanguage} onChange={(e) => setSourceLanguage(e.target.value)}>
                <option value="auto">Auto (detect language)</option>
                <option value="ur">Urdu (with English)</option>
                <option value="pa">Punjabi (with English)</option>
                <option value="en">English</option>
                <option value="hi">Hindi</option>
                <option value="ar">Arabic</option>
                <option value="de">German</option>
                <option value="es">Spanish</option>
                <option value="fr">French</option>
                <option value="tr">Turkish</option>
              </select>
              <ChevronIcon />
            </div>
          </label>
          <label>
            <span>Script style</span>
            <div className="prepare-select-wrap">
              <select value={outputLanguage} onChange={(e) => setOutputLanguage(e.target.value)}>
                <option value="keep_original">Original</option>
                <option value="roman_urdu">Urdish (Urdu + English in English letters)</option>
                <option value="roman_punjabi">Roman Punjabi (Punjabi + English in English letters)</option>
                <option value="english">English (translate)</option>
                <option value="urdu">Urdu - اردو (translate)</option>
                <option value="hindi">Hindi (translate)</option>
                <option value="arabic">Arabic (translate)</option>
                <option value="german">German (translate)</option>
                <option value="spanish">Spanish (translate)</option>
                <option value="french">French (translate)</option>
                <option value="turkish">Turkish (translate)</option>
              </select>
              <ChevronIcon />
            </div>
          </label>
          <label className="prepare-field-wide">
            <span>Names &amp; special words (optional)</span>
            <input
              type="text"
              className="prepare-input"
              value={keyterms}
              onChange={(e) => setKeyterms(e.target.value)}
              placeholder="e.g. AsaanCaption, Lahore, Ali Raza"
              maxLength={600}
            />
            <small className="prepare-hint">Separate with commas. Helps get names, brands and places right.</small>
          </label>
        </div>

        <footer className="prepare-footer">
          <button type="button" className="prepare-btn prepare-btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="prepare-btn prepare-btn-primary"
            onClick={() => void onContinue()}
            disabled={busy || !!planError?.showUpgrade}
          >
            {busy ? 'Starting…' : 'Continue'}
          </button>
        </footer>
      </section>
    </div>
  );
}

/** "Ali Raza, Lahore,, AsaanCaption" → ["Ali Raza", "Lahore", "AsaanCaption"] (max 50, 60 chars each). */
function parseKeyterms(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of text.split(/[,\n،]/)) {
    const term = part.replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!term || seen.has(term.toLowerCase())) continue;
    seen.add(term.toLowerCase());
    out.push(term);
    if (out.length === 50) break;
  }
  return out;
}

function ChevronIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
