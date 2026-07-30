import { useState } from 'react';
import { api, API_URL, getAccessToken } from '../lib/api';

/**
 * "Prepare Your Media" popup shown on the editor right after upload.
 * Replaces the old full-page transcription settings screen — only the
 * language options are exposed; everything else uses server defaults.
 */
export function PrepareMediaModal({
  projectId,
  onClose,
  onStarted,
}: {
  projectId: string;
  onClose: () => void;
  /** Transcription kicked off — the editor shows its inline processing state. */
  onStarted: () => void;
}) {
  const [sourceLanguage, setSourceLanguage] = useState('auto');
  const [outputLanguage, setOutputLanguage] = useState('keep_original');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onContinue() {
    setBusy(true);
    setError('');
    try {
      await api.post(`/projects/${projectId}/transcribe`, {
        sourceLanguage,
        outputLanguage,
        // captionMode / batchSize / whisperOptions use server defaults for now
      });
      // Stay on the editor: processing progress is shown right on the stage.
      onStarted();
    } catch (err: unknown) {
      setError(
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
          'Failed to start transcription',
      );
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal-card prepare-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h3>Prepare Your Media</h3>
            <p className="muted tiny">Select a language to transcribe your media.</p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} title="Close">
            ×
          </button>
        </div>

        <div className="modal-body">
          {error && <div className="error-banner">{error}</div>}

          <video
            className="prepare-video"
            controls
            preload="metadata"
            src={`${API_URL}/api/projects/${projectId}/video?token=${encodeURIComponent(getAccessToken() || '')}`}
          />

          <div className="prepare-fields">
            <label className="props-field">
              What language is spoken?
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
            </label>
            <label className="props-field">
              Script style
              <select value={outputLanguage} onChange={(e) => setOutputLanguage(e.target.value)}>
                <option value="keep_original">Original</option>
                <option value="roman_urdu">Roman (Urdu/Hindi in English letters)</option>
                <option value="english">English (translate)</option>
                <option value="urdu">Urdu — اردو (translate)</option>
                <option value="hindi">Hindi (translate)</option>
                <option value="arabic">Arabic (translate)</option>
                <option value="german">German (translate)</option>
                <option value="spanish">Spanish (translate)</option>
                <option value="french">French (translate)</option>
                <option value="turkish">Turkish (translate)</option>
              </select>
            </label>
          </div>

          {/* ---- Options removed from the popup for now (kept for later) ----
          <p className="muted">
            Estimated ~{estimate.minutes} min audio → ~{estimate.calls} API calls · ~${estimate.cost}
          </p>

          <fieldset>
            <legend>Caption style</legend>
            <label className="radio">
              <input type="radio" checked={captionMode === 'word'} onChange={() => setCaptionMode('word')} />
              Word by word
            </label>
            <label className="radio">
              <input type="radio" checked={captionMode === 'batch'} onChange={() => setCaptionMode('batch')} />
              Batch (N words)
            </label>
            <label className="radio">
              <input type="radio" checked={captionMode === 'sentence'} onChange={() => setCaptionMode('sentence')} />
              Full sentence
            </label>
          </fieldset>

          {captionMode === 'batch' && (
            <div className="batch-sizes">
              {[3, 5, 7].map((n) => (
                <button key={n} type="button" className={`btn ${batchSize === n ? 'primary' : 'ghost'}`}
                  onClick={() => setBatchSize(n as 3 | 5 | 7)}>
                  {n}
                </button>
              ))}
            </div>
          )}

          Advanced Whisper options:
          <label>
            Model
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              <option value="whisper-1">whisper-1 (word timestamps — required for word mode)</option>
              <option value="gpt-4o-mini-transcribe">gpt-4o-mini-transcribe (cheaper, no word ts)</option>
              <option value="gpt-4o-transcribe">gpt-4o-transcribe (accurate, no word ts)</option>
              <option value="gpt-4o-transcribe-diarize">gpt-4o-transcribe-diarize (speakers, no word ts)</option>
            </select>
          </label>
          <label>
            Prompt (style / vocabulary hint)
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} />
          </label>
          <label>
            Temperature ({temperature})
            <input type="range" min={0} max={1} step={0.1} value={temperature}
              onChange={(e) => setTemperature(Number(e.target.value))} />
          </label>
          ------------------------------------------------------------------ */}
        </div>

        <div className="modal-foot">
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={() => void onContinue()} disabled={busy}>
            {busy ? 'Starting…' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
}
