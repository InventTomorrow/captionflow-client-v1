import { useCallback, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { useNavigate } from 'react-router-dom';
import { uploadVideo, type UploadProgress, validateVideoFile } from '../lib/uploader';
import { useAuthStore } from '../stores/authStore';
import { resolvePlanError, type ApiErrorPayload, type PlanErrorInfo } from '../lib/planErrors';
import { UpgradeBanner } from '../components/UpgradeBanner';

function formatSize(bytes: number) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  return `${(bytes / 1e6).toFixed(2)} MB`;
}

function CloudUploadIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 13v8" />
      <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
      <path d="m8 17 4-4 4 4" />
    </svg>
  );
}

function VideoIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5" />
      <rect x="2" y="6" width="14" height="12" rx="2" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
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
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
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
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275Z" />
    </svg>
  );
}

function BoltIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
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
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
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
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
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
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

export function UploadPage() {
  const navigate = useNavigate();
  const limits = useAuthStore((s) => s.user?.limits);
  const plan = useAuthStore((s) => s.user?.plan);
  const planName = useAuthStore((s) => s.user?.planName);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState('');
  const [planError, setPlanError] = useState<PlanErrorInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const uploading = Boolean(progress && progress.percent < 100) || busy;
  const maxGb = limits?.maxFileSizeGb ?? 1;

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
    disabled: uploading,
  });

  async function startCaptioning() {
    if (!file || uploading) return;
    setError('');
    setPlanError(null);
    setBusy(true);
    abortRef.current = new AbortController();
    try {
      const projectId = await uploadVideo(file, setProgress, abortRef.current.signal);
      navigate(`/projects/${projectId}/editor`);
    } catch (e) {
      if ((e as Error).name === 'AbortError') setError('Upload cancelled');
      else {
        const res = (e as { response?: { data?: ApiErrorPayload } })?.response?.data;
        const planErr = resolvePlanError(res);
        if (planErr) setPlanError(planErr);
        else setError(res?.message || (e instanceof Error ? e.message : 'Upload failed'));
      }
      setProgress(null);
    } finally {
      setBusy(false);
    }
  }

  function removeFile() {
    if (uploading) return;
    setFile(null);
    setError('');
    setProgress(null);
  }

  return (
    <div className="up-page">
      <div className="up-glow" aria-hidden="true" />

      <div className="up-container">
        <div className="up-page-title">
          <span className="up-eyebrow">New project</span>
          <h1>Upload video</h1>
          <p className="up-subtitle">
            MP4, MOV, AVI, MKV, WEBM — Max {maxGb}GB
            {plan ? ` · Plan: ${planName || plan}` : ''}
            {limits?.minutesPerMonth != null ? ` · ${limits.minutesPerMonth} min/month` : ''}
          </p>
        </div>

        {error && <div className="error-banner">{error}</div>}
        {planError && <UpgradeBanner info={planError} />}

        <div
          {...getRootProps()}
          className={`up-dropzone ${isDragActive ? 'dragging' : ''} ${uploading ? 'disabled' : ''}`}
        >
          <input {...getInputProps()} />
          <div className="up-dropzone-icon">
            <CloudUploadIcon />
          </div>
          <p className="up-dropzone-title">
            {isDragActive ? 'Drop to select' : 'Drag & drop a video, or click to browse'}
          </p>
          <p className="up-dropzone-hint">Supports files up to {maxGb}GB</p>
        </div>

        {file && (
          <div className="up-file-list">
            <div className="up-file-item">
              <div className="up-file-thumb">
                <VideoIcon />
              </div>
              <div className="up-file-info">
                <p className="up-file-name">{file.name}</p>
                <p className="up-file-size">{formatSize(file.size)}</p>
              </div>
              {!uploading && (
                <button
                  type="button"
                  className="up-file-remove"
                  aria-label="Remove file"
                  onClick={removeFile}
                >
                  <XIcon />
                </button>
              )}
            </div>

            {progress && (
              <div className="up-progress">
                <div className="progress-bar">
                  <div style={{ width: `${progress.percent}%` }} />
                </div>
                <div className="up-progress-meta">
                  {progress.status} · {progress.percent}% · {formatSize(progress.uploadedBytes)} /{' '}
                  {formatSize(progress.totalBytes)}
                  {progress.speedMBps > 0 &&
                    ` · ${progress.speedMBps} MB/s · ETA ${progress.etaSeconds}s`}
                </div>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => abortRef.current?.abort()}
                >
                  Cancel
                </button>
              </div>
            )}

            {!progress && (
              <button
                type="button"
                className="up-btn-caption"
                disabled={busy}
                onClick={() => void startCaptioning()}
              >
                {busy ? 'Starting…' : 'Start captioning'}
              </button>
            )}
          </div>
        )}

        <div className="up-features">
          <div className="up-feature-card">
            <div className="up-feature-icon">
              <SparkleIcon />
            </div>
            <h3 className="up-feature-title">Auto-captions</h3>
            <p className="up-feature-desc">AI-generated subtitles tuned for long-form content.</p>
          </div>
          <div className="up-feature-card">
            <div className="up-feature-icon">
              <BoltIcon />
            </div>
            <h3 className="up-feature-title">Fast processing</h3>
            <p className="up-feature-desc">Get your captions back in minutes, not hours.</p>
          </div>
          <div className="up-feature-card">
            <div className="up-feature-icon">
              <GlobeIcon />
            </div>
            <h3 className="up-feature-title">50+ languages</h3>
            <p className="up-feature-desc">Translate and localize captions automatically.</p>
          </div>
        </div>

        <div className="up-security-note">
          <CheckCircleIcon />
          <span>Your files are processed securely and never shared.</span>
        </div>
      </div>
    </div>
  );
}
