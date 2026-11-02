/**
 * ClipCard — one clip in a grid: poster (made on this device, lazily, only
 * once the card is near the viewport), score, length, title and hook. Hover
 * or tap swaps the poster for the live preview the grid passes in — only one
 * card plays at a time. Actions are one row of icon buttons (labelled for
 * screen readers, 44 px targets) that never wraps; the title opens the clip.
 * In selection mode the poster toggles the clip's checkbox instead.
 */
import { Captions, Check, Clapperboard, Download, Film, SquarePen, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { getClipThumb } from '../../lib/clips/thumbs';
import type { Clip } from '../../lib/clips/api';
import type { RenderState } from '../../stores/clipsStore';
import { clipAspect, formatClipLength, scoreTone } from '../../lib/clips/clipMath';

interface ClipCardProps {
  clip: Clip;
  projectId: string;
  /** The project's video kind — lets the poster decode from the server stream when the device has no copy. */
  videoKind?: string;
  /** Live preview to show instead of the poster (this card is the active one). */
  preview?: ReactNode;
  /** This device can play the clip (hover preview). */
  hasSource: boolean;
  /** Rendering is possible (default: hasSource) — a linked video's clip fetches its part first. */
  canRender?: boolean;
  /** Posters to show while no frame of the clip is on this device (a linked video's own), best first. */
  fallbackPosters?: string[];
  showProject?: boolean;
  showReason?: boolean;
  render?: RenderState;
  /** Selection mode: undefined = off; true/false = this card's checkbox. */
  selected?: boolean;
  onToggleSelect?(): void;
  onActivate(clipId: string | null): void;
  onOpen(): void;
  onEditCaptions?(): void;
  onRender?(): void;
  onDownload?(): void;
  onDelete?(): void;
}

export function ClipCard({
  clip,
  projectId,
  videoKind,
  preview,
  hasSource,
  canRender = hasSource,
  fallbackPosters,
  showProject,
  showReason,
  render,
  selected,
  onToggleSelect,
  onActivate,
  onOpen,
  onEditCaptions,
  onRender,
  onDownload,
  onDelete,
}: ClipCardProps) {
  const ref = useRef<HTMLLIElement | null>(null);
  /** undefined = not tried yet; null = no poster possible on this device. */
  const [thumb, setThumb] = useState<string | null | undefined>(undefined);
  const [near, setNear] = useState(false);
  const [fallbackIdx, setFallbackIdx] = useState(0);
  const fallback = fallbackPosters?.[fallbackIdx];
  const selecting = selected !== undefined;

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
    void getClipThumb(projectId, clip, videoKind).then((url) => !cancelled && setThumb(url));
    return () => {
      cancelled = true;
    };
  }, [near, projectId, clip, videoKind]);

  const tone = scoreTone(clip.score);
  const length = formatClipLength(clip.end - clip.start);
  const rendering = render?.status === 'rendering' || render?.status === 'queued';
  const rendered = clip.status === 'rendered' || render?.status === 'done';
  const name = clip.title || 'Untitled clip';
  const landscape = clipAspect(clip) === '16:9';

  function onMediaClick() {
    if (selecting) onToggleSelect?.();
    else if (preview || !hasSource) onOpen();
    else onActivate(clip._id);
  }

  return (
    <li
      ref={ref}
      className={`clip-card${preview ? ' is-playing' : ''}${selected ? ' is-selected' : ''}`}
      onMouseEnter={() => hasSource && !selecting && onActivate(clip._id)}
      onMouseLeave={() => onActivate(null)}
    >
      <button
        type="button"
        className={`clip-card-media${landscape ? ' is-landscape' : ''}`}
        onClick={onMediaClick}
        onFocus={() => hasSource && !selecting && onActivate(clip._id)}
        aria-pressed={selecting ? selected : undefined}
        aria-label={selecting ? `Select ${name}` : `${name}, ${length}, score ${clip.score}. Play, then open`}
      >
        {preview ??
          (thumb ? (
            <img src={thumb} alt="" loading="lazy" className="clip-card-poster" />
          ) : thumb === undefined ? (
            <span className="clip-card-skeleton" aria-hidden="true" />
          ) : fallback ? (
            <img
              src={fallback}
              alt=""
              loading="lazy"
              className="clip-card-poster"
              onError={() => setFallbackIdx((i) => i + 1)}
            />
          ) : (
            <span className="clip-card-placeholder" aria-hidden="true">
              <Film size={26} />
            </span>
          ))}
        <span className={`clip-score clip-score-${tone}`}>{clip.score}</span>
        <span className="clip-length">{length}</span>
        {selecting && (
          <span className={`clip-check${selected ? ' is-on' : ''}`} aria-hidden="true">
            {selected && <Check size={16} strokeWidth={3} />}
          </span>
        )}
        {rendered && !rendering && <span className="clip-rendered">Rendered</span>}
        {landscape && <span className="clip-format-chip">16:9</span>}
        {rendering && (
          <span className="clip-render-bar" role="progressbar" aria-valuenow={Math.round(render?.percent ?? 0)} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${Math.max(3, render?.percent ?? 0)}%` }} />
          </span>
        )}
      </button>
      <div className="clip-card-body">
        <h3 className="clip-card-title" title={clip.title}>
          <button type="button" className="clip-card-title-btn" onClick={onOpen} dir="auto">
            {name}
          </button>
        </h3>
        {clip.hook && (
          <p className="clip-card-hook" dir="auto">
            “{clip.hook}”
          </p>
        )}
        {showProject && clip.project?.name && <p className="clip-card-project">{clip.project.name}</p>}
        {clip.editProjectId && <span className="clip-chip-editor">Edited in editor</span>}
        {showReason && clip.reason && (
          <details className="clip-why clip-card-why">
            <summary>Why this clip</summary>
            <p className="clip-card-reason" dir="auto">
              {clip.reason}
            </p>
          </details>
        )}
        {render?.status === 'error' && <p className="clip-card-error" role="alert">{render.error}</p>}
        <div className="clip-card-actions">
          <button type="button" className="clip-act clip-act-wide" onClick={onOpen} aria-label={`Edit ${name}`} title="Edit clip">
            <SquarePen size={18} aria-hidden="true" />
          </button>
          {onEditCaptions && (
            <button type="button" className="clip-act" onClick={onEditCaptions} aria-label="Open in editor" title="Open in editor">
              <Captions size={18} aria-hidden="true" />
            </button>
          )}
          {rendered && !rendering && onDownload ? (
            <button type="button" className="clip-act" onClick={onDownload} aria-label="Download MP4" title="Download MP4">
              <Download size={18} aria-hidden="true" />
            </button>
          ) : (
            onRender && (
              <button
                type="button"
                className="clip-act"
                onClick={onRender}
                disabled={!canRender || rendering}
                aria-label={rendering ? `Rendering ${Math.round(render?.percent ?? 0)}%` : 'Render clip'}
                title="Render clip"
              >
                {rendering ? <span className="clip-act-pct">{Math.round(render?.percent ?? 0)}%</span> : <Clapperboard size={18} aria-hidden="true" />}
              </button>
            )
          )}
          {onDelete && (
            <button type="button" className="clip-act clip-act-danger" onClick={onDelete} aria-label="Delete clip" title="Delete clip">
              <Trash2 size={18} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
