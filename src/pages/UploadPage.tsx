import { useCallback, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { useNavigate } from 'react-router-dom';
import { uploadVideo, type UploadProgress, validateVideoFile } from '../lib/uploader';

export function UploadPage() {
  const navigate = useNavigate();
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const onDrop = useCallback(
    async (files: File[]) => {
      const file = files[0];
      if (!file) return;
      setError('');
      try {
        validateVideoFile(file);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Invalid file');
        return;
      }
      abortRef.current = new AbortController();
      try {
        const projectId = await uploadVideo(file, setProgress, abortRef.current.signal);
        // Land straight in the editor — it opens the "Prepare Your Media"
        // popup for language selection on freshly uploaded projects.
        navigate(`/projects/${projectId}/editor`);
      } catch (e) {
        if ((e as Error).name === 'AbortError') setError('Upload cancelled');
        else {
          const msg =
            (e as { response?: { data?: { message?: string } } })?.response?.data?.message ||
            (e instanceof Error ? e.message : 'Upload failed');
          setError(msg);
        }
      }
    },
    [navigate],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: false,
    accept: { 'video/*': ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv'] },
    disabled: Boolean(progress && progress.percent < 100),
  });

  return (
    <div className="page">
      <h1>Upload video</h1>
      <p className="muted">MP4, MOV, AVI, MKV, WEBM — Max 5GB</p>
      {error && <div className="error-banner">{error}</div>}
      <div {...getRootProps()} className={`dropzone ${isDragActive ? 'active' : ''}`}>
        <input {...getInputProps()} />
        <p>{isDragActive ? 'Drop to upload' : 'Drag & drop a video, or click to browse'}</p>
      </div>
      {progress && (
        <div className="progress-block">
          <div className="progress-bar">
            <div style={{ width: `${progress.percent}%` }} />
          </div>
          <div className="muted">
            {progress.status} · {progress.percent}% · {(progress.uploadedBytes / 1e9).toFixed(2)}GB /{' '}
            {(progress.totalBytes / 1e9).toFixed(2)}GB
            {progress.speedMBps > 0 && ` · ${progress.speedMBps} MB/s · ETA ${progress.etaSeconds}s`}
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
    </div>
  );
}
