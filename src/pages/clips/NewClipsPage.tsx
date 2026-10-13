/**
 * /clips/new — upload a long video and get clips. The upload is the regular
 * one (audio to the server, video kept on this device); transcribe is asked
 * for with purpose 'clips', so finding clips starts by itself once the
 * transcript lands. Then the user lands on the clip set page to watch it.
 */
import { useCallback, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { useNavigate } from 'react-router-dom';
import { ClipFormatToggle } from '../../components/clips/ClipFormatToggle';
import { ClipOptionsForm } from '../../components/clips/ClipOptionsForm';
import { ClipTemplatePicker } from '../../components/clips/ClipTemplatePicker';
import { styleAllClips } from '../../lib/clips/api';
import type { ClipAspect } from '../../lib/clips/clipMath';
import { clipOptionsFrom, type LengthPresetId } from '../../lib/clips/clipOptions';
import { UpgradeBanner } from '../../components/UpgradeBanner';
import { api, errorMessage } from '../../lib/api';
import { buildExportStyle } from '../../lib/export/styleSnapshot';
import { resolvePlanError, type ApiErrorPayload, type PlanErrorInfo } from '../../lib/planErrors';
import { CAPTION_LANGUAGE_OPTIONS, SPOKEN_LANGUAGE_OPTIONS } from '../../lib/languageLabel';
import { templateByKey } from '../../lib/templateCatalog';
import { uploadProjectMedia, validateVideoFile, type UploadProgress } from '../../lib/uploader';
import { useFlagsStore } from '../../stores/flagsStore';

function formatSize(bytes: number) {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${(bytes / 1e6).toFixed(1)} MB`;
}

export function NewClipsPage() {
  const navigate = useNavigate();
  const flags = useFlagsStore((s) => s.flags);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [planError, setPlanError] = useState<PlanErrorInfo | null>(null);
  const [language, setLanguage] = useState('auto');
  const [script, setScript] = useState('keep_original');
  const [keyterms, setKeyterms] = useState('');
  const [preset, setPreset] = useState<LengthPresetId>('standard');
  const [maxClips, setMaxClips] = useState(8);
  const [templateKey, setTemplateKey] = useState('hero-word');
  const [aspect, setAspect] = useState<ClipAspect>('9:16');
  const abortRef = useRef<AbortController | null>(null);

  const onDrop = useCallback((files: File[]) => {
    const next = files[0];
    if (!next) return;
    setError('');
    try {
      validateVideoFile(next);
      setFile(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid file');
      setFile(null);
    }
  }, []);
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: false,
    accept: { 'video/*': ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv'] },
    disabled: busy,
  });

  async function start() {
    if (!file) return;
    setBusy(true);
    setError('');
    setPlanError(null);
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      const uploaded = await uploadProjectMedia(file, setProgress, abort.signal, {
        audioOnlyEnabled: flags.audioOnlyUploadEnabled,
      });
      const projectId = uploaded.projectId;
      const card = templateByKey(templateKey);
      if (card) {
        // The clips' default caption look; each clip can still pick its own.
        await api
          .patch(`/projects/${projectId}/style`, buildExportStyle({ ...card.preset, templateKey: card.key }, { defaultAspect: '9:16' }))
          .catch(() => undefined);
      }
      // The format every clip starts in (vertical is the default; set before the clips exist).
      if (aspect !== '9:16') await styleAllClips(projectId, { aspect }).catch(() => undefined);
      await api.post(`/projects/${projectId}/transcribe`, {
        purpose: 'clips',
        sourceLanguage: language,
        outputLanguage: script,
        keyterms: keyterms
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean)
          .slice(0, 50),
        clipOptions: clipOptionsFrom(preset, maxClips),
      });
      navigate(`/clips/${projectId}`);
    } catch (err) {
      const data = (err as { response?: { data?: ApiErrorPayload } }).response?.data;
      const plan = resolvePlanError(data);
      if (plan) setPlanError(plan);
      else if ((err as { name?: string }).name !== 'CanceledError' && (err as { name?: string }).name !== 'AbortError') {
        setError(errorMessage(err, 'Something went wrong — please try again'));
      }
      setProgress(null);
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  return (
    <div className="clips-page clips-new">
      <header className="clips-head">
        <div>
          <h1>New clips</h1>
          <p className="clips-sub">Upload a podcast, interview or vlog — AI finds the moments worth posting.</p>
        </div>
      </header>

      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      {planError && <UpgradeBanner info={planError} />}

      <div className="clips-new-grid">
        <section className="clips-panel">
          <div {...getRootProps()} className={`up-dropzone ${isDragActive ? 'dragging' : ''} ${busy ? 'disabled' : ''}`}>
            <input {...getInputProps()} aria-label="Choose a video" />
            <p className="up-dropzone-title">{isDragActive ? 'Drop to select' : 'Drag & drop a video, or click to browse'}</p>
            <p className="up-dropzone-hint">Long videos work best — at least a minute of talking</p>
          </div>
          {file && (
            <p className="clips-file">
              {file.name} · {formatSize(file.size)}
            </p>
          )}
          {progress && (
            <div className="up-progress">
              <div className="progress-bar">
                <div style={{ width: `${progress.percent}%` }} />
              </div>
              <div className="up-progress-meta">
                {progress.status} · {progress.percent}%
              </div>
              <button type="button" className="btn ghost" onClick={() => abortRef.current?.abort()}>
                Cancel
              </button>
            </div>
          )}
        </section>

        <section className="clips-panel" aria-label="Options">
          <label className="clip-field">
            <span>Spoken language</span>
            <select value={language} onChange={(e) => setLanguage(e.target.value)} disabled={busy}>
              {SPOKEN_LANGUAGE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="clip-field">
            <span>Caption language</span>
            <select value={script} onChange={(e) => setScript(e.target.value)} disabled={busy}>
              {CAPTION_LANGUAGE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <small className="clip-field-hint">
              Captions and clip titles use this language — translated by the same agent as the editor.
            </small>
          </label>
          <label className="clip-field">
            <span>Names and special words (optional)</span>
            <input
              type="text"
              value={keyterms}
              onChange={(e) => setKeyterms(e.target.value)}
              placeholder="e.g. CaptionFlow, Lahore, Dawood"
              disabled={busy}
            />
          </label>
          <ClipOptionsForm preset={preset} maxClips={maxClips} disabled={busy} onPreset={setPreset} onMaxClips={setMaxClips} />
          <div className="clip-field">
            <span>Format</span>
            <ClipFormatToggle value={aspect} disabled={busy} onChange={(v) => v && setAspect(v)} />
          </div>
          <div className="clip-field">
            <span>Caption style</span>
            <ClipTemplatePicker
              templateKey={templateKey}
              allowVideoStyle={false}
              disabled={busy}
              onPick={(k) => k && setTemplateKey(k)}
            />
          </div>
          <button type="button" className="btn primary clips-cta" disabled={!file || busy} onClick={() => void start()}>
            {busy ? 'Uploading…' : 'Find clips'}
          </button>
        </section>
      </div>
    </div>
  );
}
