/**
 * ClipModeBar — the strip at the top of the captions editor while it works on
 * one clip (/projects/:id/editor?clip=…): which clip, its range, where style
 * changes go, and the way back. Text edits are shared with the full video (one
 * transcript), so the bar says so instead of surprising anyone later.
 */
import { ArrowLeft, Captions, Check, ChevronLeft, ChevronRight, CircleAlert, Layers, LoaderCircle } from 'lucide-react';
import type { Clip } from '../../lib/clips/api';
import { formatClipLength } from '../../lib/clips/clipMath';
import type { ClipLookSaveState } from '../../lib/clips/useClipMode';

const clock = (s: number) => formatClipLength(s);

interface ClipModeBarProps {
  clip: Clip;
  index: number;
  count: number;
  saveState: ClipLookSaveState;
  applyingAll: boolean;
  appliedAll: boolean;
  onPrev?(): void;
  onNext?(): void;
  onApplyAll(): void;
  onBack(): void;
  onFullVideo(): void;
}

export function ClipModeBar({
  clip,
  index,
  count,
  saveState,
  applyingAll,
  appliedAll,
  onPrev,
  onNext,
  onApplyAll,
  onBack,
  onFullVideo,
}: ClipModeBarProps) {
  return (
    <section className="clip-mode-bar" aria-label="Editing one clip">
      <div className="clip-mode-main">
        <button type="button" className="clip-mode-back" onClick={onBack}>
          <ArrowLeft size={16} aria-hidden="true" />
          Back to clip
        </button>
        <span className="clip-mode-badge">
          <Captions size={14} aria-hidden="true" />
          Clip {index + 1} of {count}
        </span>
        <span className="clip-mode-title" title={clip.title} dir="auto">
          {clip.title || 'Untitled clip'}
        </span>
        <span className="clip-mode-range">
          {clock(clip.start)}–{clock(clip.end)} · {formatClipLength(clip.end - clip.start)}
        </span>
        <span className="clip-mode-nav">
          <button type="button" className="clip-icon-btn" onClick={onPrev} disabled={!onPrev} aria-label="Previous clip">
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <button type="button" className="clip-icon-btn" onClick={onNext} disabled={!onNext} aria-label="Next clip">
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </span>
      </div>
      <div className="clip-mode-side">
        <span className={`clip-mode-save is-${saveState}`} role="status" aria-live="polite">
          {saveState === 'saving' && (
            <>
              <LoaderCircle size={14} className="clip-spin" aria-hidden="true" /> Saving style to this clip…
            </>
          )}
          {saveState === 'saved' && (
            <>
              <Check size={14} aria-hidden="true" /> Style saved to this clip
            </>
          )}
          {saveState === 'error' && (
            <>
              <CircleAlert size={14} aria-hidden="true" /> Couldn’t save the style — try again
            </>
          )}
          {saveState === 'idle' && 'Style changes save to this clip only'}
        </span>
        <button type="button" className="btn ghost clip-mode-btn" onClick={onApplyAll} disabled={applyingAll || count < 2}>
          <Layers size={15} aria-hidden="true" />
          {applyingAll ? 'Applying…' : appliedAll ? 'Applied to all clips' : `Apply style to all ${count} clips`}
        </button>
        <button type="button" className="btn ghost clip-mode-btn" onClick={onFullVideo}>
          Full video
        </button>
      </div>
      <p className="clip-mode-note">
        Fixing a word or its timing here also fixes it in the full video and its other clips.
      </p>
    </section>
  );
}
