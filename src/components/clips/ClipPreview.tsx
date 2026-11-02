/**
 * ClipPreview — one clip played live in a 9:16 box: the original video, framed
 * by the clip's crop track (object-position, updated per frame), looping
 * inside [start, end], with the clip's captions drawn by the same overlay
 * components the editor uses. The caption layer covers the whole 9:16 box,
 * exactly like the export canvas, so preview and render place captions alike.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { CaptionOverlay } from '../CaptionOverlay';
import KineticCaptionLayer from '../KineticCaptionLayer';
import { deriveDisplayCaptions } from '../../lib/displayCaptions';
import { isKineticTemplate } from '../../lib/kinetic/engine';
import { sliceCaptionsToRange } from '../../lib/clips/sliceCaptions';
import { aspectDims, type ClipAspect } from '../../lib/clips/clipMath';
import { coverObjectPosition, cropXAt, type CropTrack } from '../../lib/clips/cropTrack';
import type { EditorStyle } from '../../lib/export/styleSnapshot';
import type { Caption } from '../../stores/captionStore';

const noop = () => undefined;

/** Cut to the clip at word level, on the playing file's timeline — the overlay reads video.currentTime. */
function clipCaptions(captions: Caption[], start: number, end: number, offset: number): Caption[] {
  const shift = (t: number) => t + start - offset;
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
  /** The clip, in source seconds. */
  start: number;
  end: number;
  /** Source time at `src`'s 0:00: 0 for the whole original, the part's start for a clip's part of a linked video. */
  offset?: number;
  captions: Caption[];
  style: EditorStyle;
  /** null = letterbox the whole frame ('Fit', or a landscape clip). */
  track: CropTrack | null;
  /** Output frame of the clip (default vertical). */
  aspect?: ClipAspect;
  /** Decoded poster to show instantly (and behind the video) while it loads. */
  poster?: string;
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
  start: clipStart,
  end: clipEnd,
  offset = 0,
  captions,
  style,
  track,
  aspect = '9:16',
  poster,
  playing,
  muted = true,
  className,
  onTime,
  videoRef: externalRef,
}: ClipPreviewProps) {
  // Where the clip sits in the playing file.
  const start = clipStart - offset;
  const end = clipEnd - offset;
  // Until the source has enough data to paint a frame, show a skeleton (the
  // stream can take a moment, especially for a URL import still downloading).
  const [ready, setReady] = useState(false);
  const ownRef = useRef<HTMLVideoElement | null>(null);
  const videoRef = externalRef ?? ownRef;
  const boxRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef(track);
  trackRef.current = track;
  const dimsRef = useRef(aspectDims(aspect));
  dimsRef.current = aspectDims(aspect);
  const onTimeRef = useRef(onTime);
  onTimeRef.current = onTime;

  const display = useMemo(
    () => deriveDisplayCaptions(clipCaptions(captions, clipStart, clipEnd, offset), style.displayMode, style.displayWords),
    [captions, clipStart, clipEnd, offset, style.displayMode, style.displayWords],
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
        const [aw, ah] = dimsRef.current;
        v.style.objectPosition = coverObjectPosition(v.videoWidth, v.videoHeight, aw, ah, cropXAt(t, v.currentTime - start));
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

  // Drop the skeleton once the first frame can paint; raise it again for a new source.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    setReady(v.readyState >= 2);
    const onReady = () => setReady(true);
    v.addEventListener('loadeddata', onReady);
    v.addEventListener('canplay', onReady);
    return () => {
      v.removeEventListener('loadeddata', onReady);
      v.removeEventListener('canplay', onReady);
    };
  }, [videoRef, src]);

  const template = style.template;
  return (
    <div className={`clip-preview${aspect === '16:9' ? ' is-landscape' : ''}${ready ? '' : ' is-loading'}${className ? ` ${className}` : ''}`}>
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        crossOrigin={credentials ? 'use-credentials' : undefined}
        muted={muted}
        playsInline
        preload="metadata"
        style={{ objectFit: track ? 'cover' : 'contain' }}
      />
      {!ready && <span className="clip-preview-skeleton" aria-hidden="true" />}
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
