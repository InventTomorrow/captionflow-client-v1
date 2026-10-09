/**
 * ClipCard — one clip in a grid: poster (made on this device, lazily, only
 * once the card is near the viewport), score, length, title and hook. Hover
 * or tap swaps the poster for the live preview the grid passes in — only one
 * card plays at a time. Every action is a real button (keyboard + 44 px).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { getClipThumb } from '../../lib/clips/thumbs';
import type { Clip } from '../../lib/clips/api';
import type { RenderState } from '../../stores/clipsStore';
import { formatClipLength, scoreTone } from '../../lib/clips/clipMath';

interface ClipCardProps {
  clip: Clip;
  projectId: string;
  /** Live preview to show instead of the poster (this card is the active one). */
  preview?: ReactNode;
  /** This device has the original video (posters + renders possible). */
  hasSource: boolean;
  showProject?: boolean;
  showReason?: boolean;
  render?: RenderState;
  onActivate(clipId: string | null): void;
  onOpen(): void;
  onRender?(): void;
  onDownload?(): void;
  onDelete?(): void;
}

export function ClipCard({
  clip,
  projectId,
  preview,
  hasSource,
  showProject,
  showReason,
  render,
  onActivate,
  onOpen,
  onRender,
  onDownload,
  onDelete,
}: ClipCardProps) {
  const ref = useRef<HTMLLIElement | null>(null);
  /** undefined = not tried yet; null = no poster possible on this device. */
  const [thumb, setThumb] = useState<string | null | undefined>(undefined);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setNear(true), {
      rootMargin: '400px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!near) return;
    let cancelled = false;
    void getClipThumb(projectId, clip).then((url) => !cancelled && setThumb(url));
    return () => {
      cancelled = true;
    };
  }, [near, projectId, clip]);

  const tone = scoreTone(clip.score);
  const length = formatClipLength(clip.end - clip.start);
  const rendering = render?.status === 'rendering' || render?.status === 'queued';
  const rendered = clip.status === 'rendered' || render?.status === 'done';

  return (
    <li
      ref={ref}
      className={`clip-card${preview ? ' is-playing' : ''}`}
      onMouseEnter={() => hasSource && onActivate(clip._id)}
      onMouseLeave={() => onActivate(null)}
    >
      <button
        type="button"
        className="clip-card-media"
        onClick={() => (preview || !hasSource ? onOpen() : onActivate(clip._id))}
        onFocus={() => hasSource && onActivate(clip._id)}
        aria-label={`${clip.title || 'Clip'}, ${length}, score ${clip.score}. Open clip`}
      >
        {preview ??
          (thumb ? (
            <img src={thumb} alt="" loading="lazy" />
          ) : (
            <span className="clip-card-placeholder">
              {thumb === null || !hasSource ? 'Original video not on this device' : ''}
            </span>
          ))}
        <span className={`clip-score clip-score-${tone}`}>{clip.score}</span>
        <span className="clip-length">{length}</span>
        {rendered && !rendering && <span className="clip-rendered">Rendered</span>}
        {rendering && (
          <span className="clip-render-bar" role="progressbar" aria-valuenow={Math.round(render?.percent ?? 0)} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${Math.max(3, render?.percent ?? 0)}%` }} />
          </span>
        )}
      </button>
      <div className="clip-card-body">
        <h3 className="clip-card-title" title={clip.title}>
          {clip.title || 'Untitled clip'}
        </h3>
        {clip.hook && <p className="clip-card-hook">“{clip.hook}”</p>}
        {showReason && clip.reason && <p className="clip-card-reason">{clip.reason}</p>}
        {showProject && clip.project?.name && <p className="clip-card-project">{clip.project.name}</p>}
        {render?.status === 'error' && <p className="clip-card-error" role="alert">{render.error}</p>}
        <div className="clip-card-actions">
          <button type="button" className="btn ghost clip-btn" onClick={onOpen}>
            Edit
          </button>
          {onRender && (
            <button type="button" className="btn ghost clip-btn" onClick={onRender} disabled={!hasSource || rendering}>
              {rendering ? `${Math.round(render?.percent ?? 0)}%` : rendered ? 'Re-render' : 'Render'}
            </button>
          )}
          {onDownload && rendered && (
            <button type="button" className="btn ghost clip-btn" onClick={onDownload}>
              Download
            </button>
          )}
          {onDelete && (
            <button type="button" className="btn ghost clip-btn clip-btn-danger" onClick={onDelete} aria-label="Delete clip">
              Delete
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
