import { useCallback, useEffect, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  FileVideo2,
  FolderOpen,
  ShieldCheck,
  UploadCloud,
  WandSparkles,
} from 'lucide-react';
import { uploadProjectMedia, type UploadProgress, validateVideoFile } from '../lib/uploader';
import { api } from '../lib/api';
import { CAPTION_LANGUAGE_OPTIONS, SPOKEN_LANGUAGE_OPTIONS } from '../lib/languageLabel';
import { useAuthStore } from '../stores/authStore';
import { useFlagsStore } from '../stores/flagsStore';
import { resolvePlanError, type ApiErrorPayload, type PlanErrorInfo } from '../lib/planErrors';
import { UpgradeBanner } from '../components/UpgradeBanner';
import { RecentVideos } from '../components/RecentVideos';
import { PremiumSelect } from '../components/PremiumSelect';

function formatSize(bytes: number) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  return `${(bytes / 1e6).toFixed(0)} MB`;
}

const COMPLETE_HOLD_MS = 950;
const RING_R = 52;
const RING_C = 2 * Math.PI * RING_R;
function parseKeyterms(text: string): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const part of text.split(/[,\n،]/)) {
    const term = part.replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!term || seen.has(term.toLowerCase())) continue;
    seen.add(term.toLowerCase());
    terms.push(term);
    if (terms.length === 50) break;
  }
  return terms;
}

function ProgressRing({ percent, tone }: { percent: number; tone?: 'error' }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <svg className="up-ring" viewBox="0 0 120 120" data-tone={tone} aria-hidden="true">
      <circle className="up-ring-track" cx="60" cy="60" r={RING_R} />
      <circle
        className="up-ring-fill"
        cx="60"
        cy="60"
        r={RING_R}
        strokeDasharray={RING_C}
        strokeDashoffset={RING_C * (1 - clamped / 100)}
      />
    </svg>
  );
}

export function UploadPage() {
  const navigate = useNavigate();
  const limits = useAuthStore((state) => state.user?.limits);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState('');
  const [planError, setPlanError] = useState<PlanErrorInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [sourceLanguage, setSourceLanguage] = useState('auto');
  const [outputLanguage, setOutputLanguage] = useState('keep_original');
  const [keyterms, setKeyterms] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewReady, setPreviewReady] = useState(false);
  const [setupStep, setSetupStep] = useState<1 | 2>(1);
  const abortRef = useRef<AbortController | null>(null);
  const doneTimer = useRef<number | undefined>(undefined);
  const loadFlags = useFlagsStore((state) => state.load);

  useEffect(() => {
    void loadFlags();
  }, [loadFlags]);

  useEffect(() => () => window.clearTimeout(doneTimer.current), []);

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

  const locked = busy || complete;
  const maxGb = limits?.maxFileSizeGb ?? 1;

  const onDrop = useCallback((files: File[]) => {
    const next = files[0];
    if (!next) return;
    setError('');
    setPlanError(null);
    try {
      validateVideoFile(next);
      setFile(next);
      setSetupStep(1);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Invalid file');
      setFile(null);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: false,
    accept: { 'video/*': ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv'] },
    disabled: locked,
  });

  async function startCaptioning() {
    if (!file || locked) return;
    setError('');
    setPlanError(null);
    setBusy(true);
    abortRef.current = new AbortController();
    try {
      await useFlagsStore.getState().load();
      const { flags } = useFlagsStore.getState();
      const { projectId, mode, localCopy } = await uploadProjectMedia(
        file,
        setProgress,
        abortRef.current.signal,
        { audioOnlyEnabled: flags.audioOnlyUploadEnabled },
      );
      console.info(`[upload] project ${projectId}: ${mode} upload, local copy ${localCopy ? 'kept' : 'not kept'}`);
      await api.post(`/projects/${projectId}/transcribe`, {
        sourceLanguage,
        outputLanguage,
        keyterms: parseKeyterms(keyterms),
      });
      setComplete(true);
      doneTimer.current = window.setTimeout(
        () => navigate(`/projects/${projectId}/editor`),
        COMPLETE_HOLD_MS,
      );
    } catch (uploadError) {
      setProgress(null);
      if ((uploadError as Error).name === 'AbortError') return;
      const response = (uploadError as { response?: { data?: ApiErrorPayload } })?.response?.data;
      const resolvedPlanError = resolvePlanError(response);
      if (resolvedPlanError) setPlanError(resolvedPlanError);
      else setError(response?.message || (uploadError instanceof Error ? uploadError.message : 'Upload failed'));
    } finally {
      setBusy(false);
    }
  }

  function clearFile() {
    if (locked) return;
    setFile(null);
    setError('');
    setPlanError(null);
    setProgress(null);
    setSetupStep(1);
  }

  const swallow = (action: () => void) => (event: React.MouseEvent) => {
    event.stopPropagation();
    action();
  };

  const failed = Boolean(error || planError);
  const uploadState = complete
    ? 'complete'
    : busy
      ? 'uploading'
      : failed
        ? 'error'
        : isDragActive
          ? 'dragging'
          : 'idle';
  const percent = progress?.percent ?? 0;

  return (
    <div className="up-page caption-page caption-cinematic-page caption-portal-page">
      <div className="caption-glow caption-glow-a" aria-hidden="true" />
      <div className="caption-glow caption-glow-b" aria-hidden="true" />
      <div className="caption-portal-scene" aria-hidden="true">
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
                style={{ '--wave-line': line } as React.CSSProperties}
                d={`M-40 ${178 + line * 8} C 120 ${36 + line * 5}, 235 ${298 - line * 6}, 425 ${190 + line * 4} S 720 ${118 + line * 7}, 905 ${194 - line * 3} S 1240 ${292 - line * 8}, 1640 ${128 + line * 6}`}
              />
            ))}
          </svg>
          <i />
        </div>
      </div>

      <div className="up-container caption-container caption-cinematic-container">
        <header className="caption-cinematic-header">
          <div className="caption-cinematic-title">
            <span className="caption-cinematic-eyebrow">Step {setupStep} of 2</span>
            <h1>
              {setupStep === 1 ? <>Bring your story <span>to life.</span></> : <>Choose how your story <span>speaks.</span></>}
            </h1>
            <p>{setupStep === 1 ? 'Upload once. We’ll prepare the rest.' : 'Set the language, then continue directly to Caption Studio.'}</p>
          </div>
          <ol className="caption-cinematic-steps" aria-label="Caption creation steps">
            {['Upload', 'Language', 'Studio'].map((label, index) => (
              <li
                key={label}
                className={
                  index === 0
                    ? setupStep === 1 && !busy && !complete ? 'is-active' : 'is-ready'
                    : index === 1
                      ? setupStep === 2 && !busy && !complete ? 'is-active' : setupStep === 2 ? 'is-ready' : ''
                      : busy || complete ? 'is-active' : ''
                }
              >
                <span>{index + 1}</span>
                <strong>{label}</strong>
              </li>
            ))}
          </ol>
        </header>

        {planError && <UpgradeBanner info={planError} />}

        <main
          className="caption-cinematic-canvas"
          aria-label="Create a caption project"
          data-has-file={file ? 'true' : 'false'}
        >
          <div className="caption-cinematic-bands caption-wizard-bands" data-step={setupStep}>
            {setupStep === 1 ? (
            <section className="caption-cinematic-band caption-source-band caption-wizard-panel">
              <header className="caption-band-heading caption-wizard-heading">
                <span>1</span>
                <div>
                  <small>Step 01 · Source</small>
                  <h2>Bring in your story.</h2>
                  <p>Drop a podcast, interview, stream, or any video with speech.</p>
                </div>
                <div className="caption-step-meter" aria-label="Step 1 of 2"><i /><strong>1 / 2</strong></div>
              </header>

              <div
                {...getRootProps()}
                className={`caption-cinematic-drop${isDragActive ? ' is-dragging' : ''}${file ? ' has-file' : ''}${locked ? ' is-locked' : ''}`}
                data-state={uploadState}
                aria-label="Choose a video to caption"
              >
                <input {...getInputProps()} />
                <div className="caption-drop-atmosphere" aria-hidden="true">
                  <i /><i /><i />
                </div>
                <span className="caption-drop-status caption-drop-status-left"><ShieldCheck size={13} /> Private intake</span>
                <span className="caption-drop-status caption-drop-status-right">Up to {maxGb}GB</span>

                {complete ? (
                  <div className="caption-cinematic-drop-state">
                    <span className="caption-cinematic-drop-icon is-success"><Check /></span>
                    <h3>Caption project created</h3>
                    <p>Opening your editor now.</p>
                    <div className="caption-progress"><span style={{ width: '100%' }} /></div>
                  </div>
                ) : busy ? (
                  <div className="caption-cinematic-drop-state">
                    <div className="caption-progress-ring"><ProgressRing percent={percent} /><strong>{percent}%</strong></div>
                    <h3>{progress?.status ?? 'Preparing your video'}</h3>
                    {file && <p className="caption-cinematic-file-name">{file.name}</p>}
                    <div className="caption-progress"><span style={{ width: `${percent}%` }} /></div>
                    <button type="button" className="caption-text-btn" onClick={swallow(() => abortRef.current?.abort())}>Cancel upload</button>
                  </div>
                ) : failed ? (
                  <div className="caption-cinematic-drop-state">
                    <span className="caption-cinematic-drop-icon is-error"><AlertCircle /></span>
                    <h3>We couldn’t prepare that video</h3>
                    <p>{error || planError?.message}</p>
                    <div className="caption-drop-actions">
                      {file && <button type="button" className="btn primary" onClick={swallow(() => void startCaptioning())}>Try again</button>}
                      <button type="button" className="btn ghost" onClick={swallow(clearFile)}>Choose another</button>
                    </div>
                  </div>
                ) : file ? (
                  <div className="caption-cinematic-drop-state">
                    <span className="caption-cinematic-drop-icon is-file has-preview">
                      {previewUrl && (
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
                      )}
                      <span className={`caption-upload-preview-fallback${previewReady ? ' is-hidden' : ''}`}>
                        <FileVideo2 />
                        <i />
                      </span>
                      <span className="caption-upload-preview-check"><CheckCircle2 size={18} /></span>
                    </span>
                    <span className="caption-ready"><CheckCircle2 /> Video selected</span>
                    <h3 className="caption-cinematic-file-name">{file.name}</h3>
                    <p>{formatSize(file.size)} · Preview generated · Ready for language setup</p>
                    <div className="caption-selected-actions">
                      <span><ShieldCheck size={14} /> Stored locally whenever possible</span>
                      <button type="button" className="caption-text-btn" onClick={swallow(clearFile)}>Choose another</button>
                    </div>
                  </div>
                ) : (
                  <div className="caption-cinematic-drop-state">
                    <span className="caption-drop-kicker">Your next project starts here</span>
                    <span className="caption-cinematic-drop-icon">
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
                      <UploadCloud />
                    </span>
                    <h3>{isDragActive ? 'Release to import' : 'Drop your story here'}</h3>
                    <p>{isDragActive ? 'Your video is ready to be added.' : 'Drag and drop anywhere in this space, or browse from your device.'}</p>
                    {!isDragActive && <span className="caption-browse"><FolderOpen /> Browse video</span>}
                    <div className="caption-formats" aria-label="Supported video formats"><span>MP4</span><span>MOV</span><span>MKV</span><span>WEBM</span></div>
                  </div>
                )}
              </div>

              <div className="caption-source-foot">
                <ShieldCheck />
                <span><strong>Your source stays yours.</strong> Only what is needed for transcription is uploaded.</span>
                <span className="caption-source-signal"><CheckCircle2 size={13} /> Instant video preview</span>
                <span className="caption-limit">Up to {maxGb}GB</span>
              </div>
            </section>
            ) : (
            <section className="caption-cinematic-band caption-language-band caption-wizard-panel">
              <header className="caption-band-heading caption-wizard-heading">
                <span>2</span>
                <div>
                  <small>Step 02 · Language</small>
                  <h2>Tell us how your video should speak.</h2>
                  <p>Choose the spoken and caption languages, then continue directly to the editor.</p>
                </div>
                <div className="caption-step-meter is-complete" aria-label="Step 2 of 2"><i /><strong>2 / 2</strong></div>
              </header>

              <div className="caption-language-layout">
                <aside className="caption-source-recap" aria-label="Selected source video">
                  <div className="caption-source-recap-media">
                    {previewUrl ? (
                      <video
                        src={previewUrl}
                        muted
                        playsInline
                        preload="metadata"
                        onLoadedMetadata={(event) => {
                          const video = event.currentTarget;
                          if (Number.isFinite(video.duration) && video.duration > 0.2) {
                            video.currentTime = Math.min(1, video.duration * 0.08);
                          }
                        }}
                      />
                    ) : <FileVideo2 />}
                    <span><CheckCircle2 size={14} /> Source ready</span>
                  </div>
                  <div className="caption-source-recap-copy">
                    <small>Selected video</small>
                    <strong>{file?.name}</strong>
                    <span>{file ? formatSize(file.size) : ''} · Ready to process</span>
                  </div>
                  <div className="caption-source-recap-flow" aria-hidden="true">
                    <span className="is-done"><Check size={12} /> Video</span>
                    <i />
                    <span className="is-current">Language</span>
                    <i />
                    <span>Editor</span>
                  </div>
                </aside>

                <div className="caption-language-main">
              <div className="caption-language-fields">
                <label>
                  <span>Spoken language</span>
                  <PremiumSelect
                    value={sourceLanguage}
                    options={SPOKEN_LANGUAGE_OPTIONS}
                    onChange={setSourceLanguage}
                    disabled={locked}
                    ariaLabel="Spoken language"
                  />
                </label>
                <label>
                  <span>Caption language</span>
                  <PremiumSelect
                    value={outputLanguage}
                    options={CAPTION_LANGUAGE_OPTIONS}
                    onChange={setOutputLanguage}
                    disabled={locked}
                    ariaLabel="Caption language"
                  />
                  <small>Choose the script and translation used in the editor.</small>
                </label>
                <label>
                  <span>Names and special words <i>Optional</i></span>
                  <input
                    type="text"
                    value={keyterms}
                    onChange={(event) => setKeyterms(event.target.value)}
                    placeholder="e.g. AsaanCaption, Lahore, Ali Raza"
                    maxLength={600}
                    disabled={locked}
                  />
                  <small>Separate names, brands, and places with commas.</small>
                </label>
              </div>
              {failed && (
                <div className="caption-wizard-error" role="alert">
                  <AlertCircle size={17} />
                  <span>{error || planError?.message}</span>
                </div>
              )}
              <div className="caption-language-ready">
                <WandSparkles size={18} />
                <span><strong>Next stop: Caption Studio.</strong> We’ll process this video and open it directly in the editor.</span>
              </div>
                </div>
              </div>
            </section>
            )}
          </div>

          <footer className="caption-cinematic-submit">
            <div className="caption-submit-summary">
              <span className="caption-submit-icon"><FileVideo2 size={19} /></span>
              <span>
                <strong>{file ? file.name : 'Choose a source video'}</strong>
                <small>{file ? `${formatSize(file.size)} · Ready for captions` : 'MP4, MOV, MKV or WEBM'}</small>
              </span>
              <i />
              <span><strong>50+ languages</strong><small>Automatic detection</small></span>
              <i />
              <span><strong>Up to {maxGb}GB</strong><small>Your plan limit</small></span>
            </div>
            <div className="caption-submit-assurance"><ShieldCheck size={16} /> Private by design</div>
            {setupStep === 2 && !locked && (
              <button type="button" className="caption-text-btn caption-wizard-back" onClick={() => setSetupStep(1)}>
                Back
              </button>
            )}
            {setupStep === 1 ? (
              <button
                type="button"
                className="btn primary caption-cinematic-cta"
                disabled={!file || locked}
                onClick={() => setSetupStep(2)}
              >
                Next: choose language <ArrowRight size={17} aria-hidden="true" />
              </button>
            ) : (
            <button
              type="button"
              className="btn primary caption-cinematic-cta"
              disabled={!file || locked}
              onClick={() => void startCaptioning()}
            >
              {complete
                ? 'Opening editor…'
                : busy
                  ? `Preparing · ${percent}%`
                  : <>Open Caption Studio <ArrowRight size={17} aria-hidden="true" /></>}
            </button>
            )}
          </footer>
        </main>

        <RecentVideos />
      </div>
    </div>
  );
}
