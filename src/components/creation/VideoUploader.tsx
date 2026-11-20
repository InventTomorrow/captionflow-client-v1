import { useCallback, useEffect, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { CloudArrowUp, FolderOpen, WarningCircle, X } from '@phosphor-icons/react';
import { validateVideoFile, type UploadProgress } from '../../lib/uploader';

export function VideoUploader({ file, onFile, maxGb, disabled, progress, error, onError, onCancel }: {
  file: File | null;
  onFile(file: File | null): void;
  maxGb: number;
  disabled: boolean;
  progress: UploadProgress | null;
  error: string;
  onError(message: string): void;
  onCancel(): void;
}) {
  const [preview, setPreview] = useState('');
  useEffect(() => {
    if (!file) { setPreview(''); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const onDrop = useCallback((files: File[]) => {
    const picked = files[0];
    if (!picked) return;
    try {
      validateVideoFile(picked);
      if (picked.size > maxGb * 1024 ** 3) throw new Error(`Your plan allows videos up to ${maxGb} GB.`);
      onError('');
      onFile(picked);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Choose a supported video file.');
    }
  }, [maxGb, onError, onFile]);
  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    onDropRejected: () => onError('Choose an MP4, MOV, AVI, MKV, WEBM or FLV video.'),
    multiple: false,
    accept: { 'video/*': ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv'] },
    disabled,
    noClick: true,
    noKeyboard: true,
  });
  return (
    <section className="creation-upload-section" aria-label="Video upload">
      <div {...getRootProps()} className={`creation-uploader${isDragActive ? ' is-dragging' : ''}`}>
        <input {...getInputProps()} aria-label="Choose a video file" />
        <div className="creation-upload-icon">{preview ? <video src={preview} muted playsInline preload="metadata" aria-label="Selected video preview" controls /> : <CloudArrowUp size={28} aria-hidden="true" />}</div>
        <div className="creation-upload-copy">
          <h2>{file ? file.name : 'Drop your video here'}</h2>
          <p>{file ? `${(file.size / 1024 ** 2).toFixed(1)} MB · Ready to continue` : 'MP4, MOV, MKV or WEBM'}</p>
          {!file && <small>AVI and FLV are also supported · Up to {maxGb} GB on your plan</small>}
        </div>
        <button type="button" className="btn ghost creation-browse" disabled={disabled} onClick={open}><FolderOpen size={16} aria-hidden="true" />{file ? 'Replace file' : 'Browse files'}</button>
        {file && !disabled && <button type="button" className="creation-remove" onClick={() => onFile(null)} aria-label="Remove selected video"><X size={18} weight="bold" aria-hidden="true" /></button>}
      </div>
      {progress && <div className="creation-upload-progress" role="status" aria-live="polite">
        <div><span>{progress.status}</span><strong>{progress.percent}%</strong></div>
        <progress value={progress.percent} max={100} aria-label="Upload progress" />
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>}
      {error && <p className="creation-error" role="alert"><WarningCircle size={16} aria-hidden="true" />{error}</p>}
    </section>
  );
}
