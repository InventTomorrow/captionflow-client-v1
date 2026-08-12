import { useState } from 'react';
import { api, API_URL } from '../lib/api';
import { resolvePlanError, type ApiErrorPayload, type PlanErrorInfo } from '../lib/planErrors';
import { UpgradeBanner } from './UpgradeBanner';

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
  const [error, setError] = useState('');
  const [planError, setPlanError] = useState<PlanErrorInfo | null>(null);
  const [busy, setBusy] = useState(false);

  async function onContinue() {
    setBusy(true);
    setError('');
    setPlanError(null);
    try {
      await api.post(`/projects/${projectId}/transcribe`, {
        sourceLanguage,
        outputLanguage,
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
            <video
              className="prepare-video"
              controls
              preload="metadata"
              src={`${API_URL}/api/projects/${projectId}/video`}
            />
          </div>
        </div>

        <div className="prepare-fields">
          <label>
            <span>What language is spoken?</span>
            <div className="prepare-select-wrap">
              <select value={sourceLanguage} onChange={(e) => setSourceLanguage(e.target.value)}>
                <option value="auto">Auto-detect</option>
                <option value="ur">Urdu / Hindi (Hinglish)</option>
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
                <option value="roman_urdu">Urdish (Urdu/Hindi in English letters)</option>
                <option value="english">English (translate)</option>
                <option value="urdu">Urdu — اردو (translate)</option>
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
