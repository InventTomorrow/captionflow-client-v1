/**
 * ClipPreview — one clip played live in a 9:16 box: the original video, framed
 * by the clip's crop track (object-position, updated per frame), looping
 * inside [start, end], with the clip's captions drawn by the same overlay
 * components the editor uses. The caption layer covers the whole 9:16 box,
 * exactly like the export canvas, so preview and render place captions alike.
 */
import { useEffect, useMemo, useRef } from 'react';
import { CaptionOverlay } from '../CaptionOverlay';
import KineticCaptionLayer from '../KineticCaptionLayer';
import { deriveDisplayCaptions } from '../../lib/displayCaptions';
import { isKineticTemplate } from '../../lib/kinetic/engine';
import { sliceCaptionsToRange } from '../../lib/clips/sliceCaptions';
import { cropRect, cropXAt, type CropTrack } from '../../lib/clips/cropTrack';
import type { EditorStyle } from '../../lib/export/styleSnapshot';
import type { Caption } from '../../stores/captionStore';

const noop = () => undefined;

/** Cut to the clip at word level, but keep source times — the overlay reads video.currentTime. */
function clipCaptions(captions: Caption[], start: number, end: number): Caption[] {
  const shift = (t: number) => t + start;
  return sliceCaptionsToRange(captions, start, end).map((c) => ({
    ...c,
    start: shift(c.start),
    end: shift(c.end),
    words: c.words?.map((w) => ({ ...w, start: shift(w.start), end: shift(w.end) })),
  }));
}

export interface ClipPreviewProps {
  src: string;
  /** The server stream needs the auth cookie. */
  credentials?: boolean;
  start: number;
  end: number;
  captions: Caption[];
  style: EditorStyle;
  /** null = letterbox the whole frame ('Fit'). */
  track: CropTrack | null;
  playing: boolean;
  muted?: boolean;
  className?: string;
  /** Clip-relative playhead, for a progress bar (called each animation frame while playing). */
  onTime?: (t: number) => void;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
}

export function ClipPreview({
  src,
  credentials,
  start,
  end,
  captions,
  style,
  track,
  playing,
  muted = true,
  className,
  onTime,
  videoRef: externalRef,
}: ClipPreviewProps) {
  const ownRef = useRef<HTMLVideoElement | null>(null);
  const videoRef = externalRef ?? ownRef;
  const boxRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef(track);
  trackRef.current = track;
  const onTimeRef = useRef(onTime);
  onTimeRef.current = onTime;

  const display = useMemo(
    () => deriveDisplayCaptions(clipCaptions(captions, start, end), style.displayMode, style.displayWords),
    [captions, start, end, style.displayMode, style.displayWords],
  );

  // Seek into the clip once the source can play; keep looping inside it; frame it.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const toStart = () => {
      if (Math.abs(v.currentTime - start) > 0.25) v.currentTime = start;
    };
    if (v.readyState >= 1) toStart();
    v.addEventListener('loadedmetadata', toStart);
    let raf = 0;
    const tick = () => {
      if (v.currentTime >= end || v.currentTime < start - 0.5) v.currentTime = start;
      const t = trackRef.current;
      if (t && v.videoWidth && v.videoHeight) {
        const r = cropRect(v.videoWidth, v.videoHeight, 9, 16, cropXAt(t, v.currentTime - start));
        const px = v.videoWidth > r.width ? r.left / (v.videoWidth - r.width) : 0.5;
        const py = v.videoHeight > r.height ? r.top / (v.videoHeight - r.height) : 0.5;
        v.style.objectPosition = `${(px * 100).toFixed(2)}% ${(py * 100).toFixed(2)}%`;
      }
      onTimeRef.current?.(Math.max(0, v.currentTime - start));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      v.removeEventListener('loadedmetadata', toStart);
    };
  }, [videoRef, start, end, src]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (playing) void v.play().catch(() => undefined);
    else v.pause();
  }, [playing, videoRef, src]);

  const template = style.template;
  return (
    <div className={`clip-preview${className ? ` ${className}` : ''}`}>
      <video
        ref={videoRef}
        src={src}
        crossOrigin={credentials ? 'use-credentials' : undefined}
        muted={muted}
        playsInline
        preload="metadata"
        style={{ objectFit: track ? 'cover' : 'contain' }}
      />
      <div className="clip-preview-captions" ref={boxRef} aria-hidden="true">
        {isKineticTemplate(template) ? (
          <KineticCaptionLayer
            captions={display}
            videoRef={videoRef}
            template={template}
            color={style.color}
            highlightColor={style.highlightColor}
            fontSize={style.fontSize}
            params={style.kinetic}
            behindPerson={false}
          />
        ) : (
          <CaptionOverlay
            captions={display}
            videoRef={videoRef}
            wrapRef={boxRef}
            style={style}
            displayMode={style.displayMode}
            selectedCaptionId={null}
            selectedWordIdx={null}
            onWordSelect={noop}
            onWordDelete={noop}
            onSaveText={noop}
            onChunkStyleCommit={noop}
            onChunkDelete={noop}
          />
        )}
      </div>
    </div>
  );
}
