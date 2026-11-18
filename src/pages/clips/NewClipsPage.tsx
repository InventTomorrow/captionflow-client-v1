/**
 * /clips/new — upload a long video and get clips. The video remains local
 * whenever possible while its audio is transcribed for clip discovery.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Captions,
  CheckCircle2,
  FileVideo2,
  Link2,
  Maximize2,
  Play,
  ShieldCheck,
  UploadCloud,
  Volume2,
  WandSparkles,
  X,
} from 'lucide-react';
import { ClipFormatToggle } from '../../components/clips/ClipFormatToggle';
import { ClipOptionsForm } from '../../components/clips/ClipOptionsForm';
import { ClipTemplatePicker } from '../../components/clips/ClipTemplatePicker';
import { PremiumSelect } from '../../components/PremiumSelect';
import { HelperInstallModal } from '../../components/clips/HelperInstallModal';
import { createClipsFromUrl, findLinkedClips, styleAllClips } from '../../lib/clips/api';
import { HelperError, findHelper, helperFetch, helperVideoInfo, youtubeVideoId } from '../../lib/helper/helper';
import type { ClipAspect } from '../../lib/clips/clipMath';
import { clipOptionsFrom, type LengthPresetId } from '../../lib/clips/clipOptions';
import { UpgradeBanner } from '../../components/UpgradeBanner';
import { api, errorMessage } from '../../lib/api';
import { buildExportStyle } from '../../lib/export/styleSnapshot';
import { resolvePlanError, type ApiErrorPayload, type PlanErrorInfo } from '../../lib/planErrors';
import { CAPTION_LANGUAGE_OPTIONS, SPOKEN_LANGUAGE_OPTIONS } from '../../lib/languageLabel';
import { templateByKey } from '../../lib/templateCatalog';
import { refusedByServer } from '../../lib/clips/refused';
import { deleteSource } from '../../lib/media/localMedia';
import { ClipsDeviceError, uploadLinkedAudio, uploadProjectMedia, validateVideoFile, type UploadProgress } from '../../lib/uploader';
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
  const [url, setUrl] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewReady, setPreviewReady] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // A link and a file can both be set; the link wins (its box is the one just
  // filled). urlInvalid gates submit with an error shown by the box.
  const urlImportOn = flags.urlImportEnabled;
  const trimmedUrl = url.trim();
  const useUrl = urlImportOn && trimmedUrl.length > 0;
  const urlInvalid = useUrl && !/^https?:\/\/\S+/i.test(trimmedUrl);
  const canSubmit = !busy && !urlInvalid && (useUrl || !!file);
  /** A YouTube link goes through Asaan Caption Helper on this computer, not our server. */
  const youtubeId = useUrl && !urlInvalid ? youtubeVideoId(trimmedUrl) : null;
  const [helperOk, setHelperOk] = useState(false);
  const [helperModal, setHelperModal] = useState<'missing' | 'outdated' | null>(null);
  /** "Create" was pressed while the helper was missing: carry on once it connects. */
  const resumeAfterHelper = useRef(false);
  const poppedFor = useRef('');
  const startRef = useRef<() => void>(() => undefined);

  // A pasted YouTube link: look for the helper, and offer it straight away when it isn't there.
  useEffect(() => {
    setHelperOk(false);
    if (!youtubeId) return;
    let stale = false;
    const timer = setTimeout(async () => {
      const status = await findHelper();
      if (stale) return;
      if (status?.ready && !status.outdated) return setHelperOk(true);
      if (poppedFor.current === youtubeId) return;
      poppedFor.current = youtubeId;
      setHelperModal(status?.outdated ? 'outdated' : 'missing');
    }, 350);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [youtubeId]);

  const onHelperConnected = useCallback(() => {
    setHelperOk(true);
    setHelperModal(null);
    if (resumeAfterHelper.current) {
      resumeAfterHelper.current = false;
      startRef.current();
    }
  }, []);
  const closeHelperModal = useCallback(() => {
    resumeAfterHelper.current = false;
    setHelperModal(null);
  }, []);

  useEffect(() => {
    setPreviewReady(false);
    if (!file) {
      setPreviewUrl('');
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

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
    disabled: busy || useUrl,
  });

  const keytermList = () =>
    keyterms
      .split(',')
      .map((term) => term.trim())
      .filter(Boolean)
      .slice(0, 50);

  async function startFromUrl() {
    const link = url.trim();
    if (!link) return;
    setBusy(true);
    setError('');
    setPlanError(null);
    try {
      const { projectId } = await createClipsFromUrl({
        url: link,
        sourceLanguage: language,
        outputLanguage: script,
        keyterms: keytermList(),
        clipOptions: clipOptionsFrom(preset, maxClips),
        templateKey,
        aspect,
      });
      navigate(`/clips/${projectId}`);
    } catch (err) {
      const data = (err as { response?: { data?: ApiErrorPayload } }).response?.data;
      const plan = resolvePlanError(data);
      if (plan) setPlanError(plan);
      else setError(errorMessage(err, 'Couldn’t import that link — check it and try again'));
    } finally {
      setBusy(false);
    }
  }

  const step = (percent: number, status: string): UploadProgress => ({
    percent: Math.max(0, Math.min(100, Math.round(percent))),
    uploadedBytes: 0,
    totalBytes: 0,
    speedMBps: 0,
    etaSeconds: 0,
    status,
  });

  /**
   * A YouTube link through Asaan Caption Helper: the helper fetches only the
   * audio on this computer, and only that goes up to be transcribed. Null when
   * the link already has a Clips project (opened instead).
   */
  async function audioFromHelper(link: string, signal: AbortSignal): Promise<string | null> {
    setProgress(step(1, 'Getting the video ready…'));
    const existing = await findLinkedClips(link).catch(() => null);
    if (existing) {
      navigate(`/clips/${existing}`);
      return null;
    }
    const info = await helperVideoInfo(link, signal);
    const size = info.audio.size;
    setProgress(step(5, 'Getting the audio…'));
    const parts = await helperFetch(info.id, info.audio, 0, size - 1, {
      signal,
      onBytes: (got) => setProgress(step(5 + (got / size) * 65, 'Getting the audio…')),
    });
    const audio = new Blob(parts as BlobPart[], { type: 'audio/mp4' });
    return uploadLinkedAudio(audio, info, link, (p) => setProgress({ ...p, percent: Math.round(70 + p.percent * 0.3) }), signal);
  }

  async function start() {
    if (youtubeId) {
      const status = await findHelper();
      if (!status?.ready || status.outdated) {
        resumeAfterHelper.current = true;
        setHelperModal(status?.outdated ? 'outdated' : 'missing');
        return;
      }
      const link = trimmedUrl;
      return create((signal) => audioFromHelper(link, signal));
    }
    if (useUrl) return startFromUrl();
    const picked = file;
    if (!picked) return;
    return create(async (signal) => {
      const uploaded = await uploadProjectMedia(picked, setProgress, signal, {
        audioOnlyEnabled: flags.audioOnlyUploadEnabled,
        // Clips: only the sound goes up; the video never leaves this device.
        requireAudioOnly: true,
      });
      return uploaded.projectId;
    });
  }

  /** Upload the sound (`upload` gives the new project, or null when there is nothing to make), then find clips. */
  async function create(upload: (signal: AbortSignal) => Promise<string | null>) {
    setBusy(true);
    setError('');
    setPlanError(null);
    const abort = new AbortController();
    abortRef.current = abort;
    /** Set once the sound is uploaded: a later refusal (plan limits) removes it again. */
    let created: string | undefined;
    try {
      const projectId = await upload(abort.signal);
      if (!projectId) return;
      created = projectId;
      const card = templateByKey(templateKey);
      if (card) {
        await api
          .patch(
            `/projects/${projectId}/style`,
            buildExportStyle({ ...card.preset, templateKey: card.key }, { defaultAspect: '9:16' }),
          )
          .catch(() => undefined);
      }
      if (aspect !== '9:16') await styleAllClips(projectId, { aspect }).catch(() => undefined);
      await api.post(`/projects/${projectId}/transcribe`, {
        purpose: 'clips',
        sourceLanguage: language,
        outputLanguage: script,
        keyterms: keyterms
          .split(',')
          .map((term) => term.trim())
          .filter(Boolean)
          .slice(0, 50),
        clipOptions: clipOptionsFrom(preset, maxClips),
      });
      created = undefined;
      navigate(`/clips/${projectId}`);
    } catch (err) {
      // A refused transcribe (plan limits) leaves no half-made Clips video behind — its sound on the
      // server, its copy here. A timeout or 5xx may have queued the job (and held its quota): keep it.
      if (created && refusedByServer(err)) {
        const id = created;
        void api.delete(`/projects/${id}`).catch(() => undefined);
        void deleteSource(id).catch(() => undefined);
      }
      const data = (err as { response?: { data?: ApiErrorPayload } }).response?.data;
      const plan = resolvePlanError(data);
      if (plan) setPlanError(plan);
      else if (err instanceof ClipsDeviceError) setError(err.message);
      else if (err instanceof HelperError) {
        setError(err.message);
        if (err.code === 'missing') setHelperModal('missing');
      }
      else if ((err as { name?: string }).name !== 'CanceledError' && (err as { name?: string }).name !== 'AbortError') {
        setError(errorMessage(err, 'Something went wrong — please try again'));
      }
      setProgress(null);
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  useEffect(() => {
    startRef.current = () => void start();
  });

  const durationLabel = preset === 'short' ? '15–30 sec' : preset === 'long' ? '45–90 sec' : '20–60 sec';

  return (
    <div className="clips-page clips-new clips-create-page clips-portal-page">
      <div className="clips-create-glow clips-create-glow-a" aria-hidden="true" />
      <div className="clips-create-glow clips-create-glow-b" aria-hidden="true" />
      <div className="caption-portal-scene clips-portal-scene" aria-hidden="true">
        <div className="caption-portal-backdrop" />
        <div className="caption-filmstrip caption-filmstrip-left">
          {[0, 1, 2, 3].map((frame) => <span key={frame} style={{ '--film-frame': frame } as React.CSSProperties} />)}
        </div>
        <div className="caption-filmstrip caption-filmstrip-right">
          {[0, 1, 2, 3].map((frame) => <span key={frame} style={{ '--film-frame': frame + 4 } as React.CSSProperties} />)}
        </div>
        <div className="caption-portal-waves">
          <svg viewBox="0 0 1600 320" preserveAspectRatio="none">
            {[0, 1, 2, 3, 4, 5].map((line) => (
              <path
                key={line}
                d={`M-40 ${178 + line * 8} C 120 ${36 + line * 5}, 235 ${298 - line * 6}, 425 ${190 + line * 4} S 720 ${118 + line * 7}, 905 ${194 - line * 3} S 1240 ${292 - line * 8}, 1640 ${128 + line * 6}`}
              />
            ))}
          </svg>
          <i />
        </div>
      </div>

      <header className="clips-cinematic-header">
        <div className="clips-cinematic-title">
          <span className="clips-cinematic-eyebrow"><WandSparkles size={13} /> Viral Clips Studio</span>
          <h1>Your best moments, <span>ready to publish.</span></h1>
          <p>Turn long videos into engaging clips with AI reframing and polished captions.</p>
          <Link to="/clips/library" className="clips-create-library-link">
            View clip library <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </div>
        <ol className="clips-cinematic-steps" aria-label="Clip creation steps">
          {['Upload', 'Direct', 'Style', 'Generate'].map((label, index) => (
            <li key={label} className={index === 0 ? 'is-active' : file && index < 3 ? 'is-ready' : ''}>
              <span>{index + 1}</span>
              <strong>{label}</strong>
            </li>
          ))}
        </ol>
      </header>

      {error && <div className="error-banner" role="alert">{error}</div>}
      {planError && <UpgradeBanner info={planError} />}

      <main className="clips-cinematic-canvas" aria-label="Create Viral Clips">
        <section className="clips-cinematic-preview" aria-label="Clip framing preview">
          <div className="clips-preview-media">
            <img src="/media/caption-studio-host.jpg" alt="Creator speaking in a podcast studio" />
            <div className="clips-preview-vignette" aria-hidden="true" />
            <div className="clips-preview-badge"><WandSparkles size={13} /> AI framing preview</div>
            <div className="clips-preview-crop" aria-hidden="true">
              <span>9:16 Viral Clip</span>
              <div className="clips-preview-caption">Make every <em>moment</em><br />impossible to miss.</div>
            </div>
            <div className="clips-preview-controls" aria-hidden="true">
              <Play size={19} fill="currentColor" />
              <span>12:24 / 45:10</span>
              <div className="clips-preview-track"><i /></div>
              <Volume2 size={18} />
              <Maximize2 size={18} />
            </div>
          </div>
          <div className="clips-preview-filmstrip" aria-hidden="true">
            {Array.from({ length: 12 }, (_, index) => (
              <span key={index} className={index === 6 ? 'is-current' : ''}>
                <img src="/media/caption-studio-host.jpg" alt="" />
              </span>
            ))}
          </div>
        </section>

        <div className="clips-cinematic-bands">
          <section className="clips-cinematic-band clips-source-band">
            <header className="clips-band-heading">
              <span>1</span>
              <div><h2>Source and language</h2><p>Add your video and guide the transcript.</p></div>
            </header>

            <div
              {...getRootProps()}
              className={`clips-inline-upload${isDragActive ? ' is-dragging' : ''}${file ? ' has-file' : ''}${busy || useUrl ? ' is-disabled' : ''}`}
            >
              <input {...getInputProps()} aria-label="Choose a long video" disabled={busy || useUrl} />
              <span className={`clips-inline-upload-icon${file ? ' has-preview' : ''}`}>
                {!file && (
                  <span className="caption-upload-beats" aria-hidden="true">
                    {Array.from({ length: 28 }, (_, beat) => (
                      <i
                        key={beat}
                        style={{
                          '--beat-angle': `${beat * (360 / 28)}deg`,
                          '--beat-delay': `${beat * -46}ms`,
                          '--beat-size': `${5 + (beat % 5) * 1.35}px`,
                        } as React.CSSProperties}
                      />
                    ))}
                  </span>
                )}
                {file && previewUrl ? (
                  <>
                    <video
                      className={previewReady ? 'is-ready' : ''}
                      src={previewUrl}
                      muted
                      playsInline
                      preload="metadata"
                      onLoadedData={() => setPreviewReady(true)}
                      onSeeked={() => setPreviewReady(true)}
                      onError={() => setPreviewReady(false)}
                      onLoadedMetadata={(event) => {
                        const video = event.currentTarget;
                        if (Number.isFinite(video.duration) && video.duration > 0.2) {
                          video.currentTime = Math.min(1, video.duration * 0.08);
                        }
                      }}
                    />
                    <span className={`clips-upload-preview-fallback${previewReady ? ' is-hidden' : ''}`}>
                      <FileVideo2 size={24} />
                      <i />
                    </span>
                    <span className="clips-upload-preview-check"><CheckCircle2 size={16} /></span>
                  </>
                ) : (
                  <UploadCloud size={22} />
                )}
              </span>
              <span className="clips-inline-upload-copy">
                {file && <em><CheckCircle2 size={12} /> Video selected</em>}
                <strong>{isDragActive ? 'Drop your video here' : file ? file.name : 'Drop your long video here'}</strong>
                <small>{file ? `${formatSize(file.size)} · Ready to upload` : 'Drag and drop, or browse · MP4, MOV, MKV or WEBM'}</small>
              </span>
              <span className="clips-inline-upload-action">{file ? 'Replace' : 'Browse'}</span>
              {file && !busy && (
                <button
                  type="button"
                  onClick={(event) => { event.stopPropagation(); setFile(null); }}
                  aria-label="Remove selected video"
                >
                  <X size={16} aria-hidden="true" />
                </button>
              )}
            </div>

            {urlImportOn && (
              <>
                <div className="clips-source-or" role="separator" aria-label="or">
                  <span>or paste a link</span>
                </div>
                <label className="clip-field clips-url-field">
                  <span className="clips-url-label"><Link2 size={14} aria-hidden="true" /> Video link</span>
                  <input
                    type="url"
                    inputMode="url"
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    placeholder="https://youtube.com/watch?v=…"
                    disabled={busy}
                    aria-label="Video link"
                    aria-invalid={urlInvalid || undefined}
                  />
                  {urlInvalid ? (
                    <small className="clips-url-note is-error" role="alert">Enter a full link starting with https://</small>
                  ) : youtubeId && helperOk ? (
                    <small className="clips-helper-chip" role="status">
                      <CheckCircle2 size={12} aria-hidden="true" /> Helper connected. Only the audio is fetched now, on this computer.
                    </small>
                  ) : (
                    <small className="clips-url-note">YouTube, TikTok, Instagram, Vimeo or a direct MP4 — single videos, not playlists.</small>
                  )}
                </label>
              </>
            )}

            <div className="clips-source-fields">
              <label className="clip-field">
                <span>Spoken language</span>
                <PremiumSelect
                  value={language}
                  options={SPOKEN_LANGUAGE_OPTIONS}
                  onChange={setLanguage}
                  disabled={busy}
                  ariaLabel="Spoken language"
                />
              </label>
              <label className="clip-field">
                <span>Caption language</span>
                <PremiumSelect
                  value={script}
                  options={CAPTION_LANGUAGE_OPTIONS}
                  onChange={setScript}
                  disabled={busy}
                  ariaLabel="Caption language"
                />
              </label>
            </div>
            <label className="clip-field clips-create-keyterms">
              <span>Names and special words <i>Optional</i></span>
              <input
                type="text"
                value={keyterms}
                onChange={(event) => setKeyterms(event.target.value)}
                placeholder="e.g. Lahore, Dawood, CaptionFlow"
                disabled={busy}
              />
            </label>

            {progress && (
              <div className="clips-create-progress" aria-live="polite">
                <div className="clips-create-progress-row"><span>{progress.status}</span><strong>{progress.percent}%</strong></div>
                <div className="progress-bar"><div style={{ width: `${progress.percent}%` }} /></div>
                <button type="button" onClick={() => abortRef.current?.abort()}>Cancel upload</button>
              </div>
            )}
          </section>

          <section className="clips-cinematic-band clips-recipe-band">
            <header className="clips-band-heading">
              <span>2</span>
              <div><h2>Clip recipe</h2><p>Choose the pacing and number of suggestions.</p></div>
            </header>
            <ClipOptionsForm
              preset={preset}
              maxClips={maxClips}
              disabled={busy}
              onPreset={setPreset}
              onMaxClips={setMaxClips}
            />
            <div className="clip-field clips-create-format-field">
              <span>Output format</span>
              <ClipFormatToggle value={aspect} disabled={busy} onChange={(value) => value && setAspect(value)} />
            </div>
            <div className="clips-smart-note">
              <WandSparkles size={16} />
              <span><strong>Smart defaults are on.</strong> AI will rank hooks, reframe speakers, and remove weak openings.</span>
            </div>
          </section>

          <section className="clips-cinematic-band clips-style-band">
            <header className="clips-band-heading">
              <span>3</span>
              <div><h2>Caption style</h2><p>Pick a starting look. Every clip stays editable.</p></div>
            </header>
            <ClipTemplatePicker
              templateKey={templateKey}
              allowVideoStyle={false}
              disabled={busy}
              onPick={(key) => key && setTemplateKey(key)}
            />
          </section>
        </div>

        <footer className="clips-cinematic-submit">
          <div className="clips-submit-summary">
            <span className="clips-create-submit-icon"><Captions size={19} aria-hidden="true" /></span>
            <span><strong>{maxClips} clips</strong><small>Estimated output</small></span>
            <i />
            <span><strong>{durationLabel} each</strong><small>Clip duration</small></span>
            <i />
            <span><strong>{aspect} {aspect === '9:16' ? 'Vertical' : 'Landscape'}</strong><small>Output format</small></span>
          </div>
          <div className="clips-submit-assurance"><ShieldCheck size={16} /> Source stays private</div>
          <button
            type="button"
            className="btn primary clips-create-cta"
            disabled={!canSubmit}
            onClick={() => void start()}
          >
            {busy ? (youtubeId ? 'Getting your video…' : useUrl ? 'Importing your link…' : 'Preparing your video…') : <>Create Viral Clips <ArrowRight size={17} aria-hidden="true" /></>}
          </button>
        </footer>
      </main>
      {helperModal && <HelperInstallModal reason={helperModal} onConnected={onHelperConnected} onClose={closeHelperModal} />}
    </div>
  );
}
