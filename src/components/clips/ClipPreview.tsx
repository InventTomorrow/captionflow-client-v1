/**
 * ClipPreview — one clip played live in a 9:16 box: the original video, framed
 * by the clip's crop track (object-position, updated per frame), looping
 * inside [start, end], with the clip's captions drawn by the same overlay
 * components the editor uses. The caption layer covers the whole 9:16 box,
 * exactly like the export canvas, so preview and render place captions alike.
 *
 * With a framing layout (clips/framing.ts) the same <video> keeps playing out
 * of sight and each frame is drawn onto a canvas by clips/layout.ts — the very
 * function the export worker draws with — so the preview is the render.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { CaptionOverlay } from '../CaptionOverlay';
import KineticCaptionLayer from '../KineticCaptionLayer';
import { deriveDisplayCaptions } from '../../lib/displayCaptions';
import { isKineticTemplate } from '../../lib/kinetic/engine';
import { sliceCaptionsToRange } from '../../lib/clips/sliceCaptions';
import { aspectDims, type ClipAspect } from '../../lib/clips/clipMath';
import { coverObjectPosition, cropXAt, type CropTrack } from '../../lib/clips/cropTrack';
import { framingKey, type ClipFramingV1 } from '../../lib/clips/framing';
import { drawLayout } from '../../lib/clips/layout';
import { playFallback } from '../../lib/clips/reelFeed';
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
  /** A framing layout to draw instead of the crop (vertical clips only). */
  framing?: ClipFramingV1 | null;
  /** Decoded poster to show instantly (and behind the video) while it loads. */
  poster?: string;
  playing: boolean;
  muted?: boolean;
  className?: string;
  /** Clip-relative playhead, for a progress bar (called each animation frame while playing). */
  onTime?: (t: number) => void;
  /** The browser refused play(): it now plays muted ('retry-muted'), or stays stopped ('paused'). */
  onPlayBlocked?: (outcome: 'retry-muted' | 'paused') => void;
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
  framing = null,
  poster,
  playing,
  muted = true,
  className,
  onTime,
  onPlayBlocked,
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
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const framingRef = useRef(framing);
  framingRef.current = framing;
  const [drawn, setDrawn] = useState(false);
  const onPlayBlockedRef = useRef(onPlayBlocked);
  onPlayBlockedRef.current = onPlayBlocked;

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
    let lastDraw = '';
    const tick = () => {
      if (v.currentTime >= end || v.currentTime < start - 0.5) v.currentTime = start;
      const t = trackRef.current;
      const layout = framingRef.current;
      const canvas = canvasRef.current;
      if (layout && canvas && v.videoWidth && v.videoHeight && v.readyState >= 2) {
        // Redraw when the frame, the layout or the box size changed — not on every idle tick.
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const cw = Math.max(2, Math.round(canvas.clientWidth * dpr));
        const ch = Math.max(2, Math.round(canvas.clientHeight * dpr));
        const key = `${v.currentTime}|${cw}x${ch}|${framingKey(layout)}`;
        if (key !== lastDraw) {
          if (canvas.width !== cw || canvas.height !== ch) {
            canvas.width = cw;
            canvas.height = ch;
          }
          const ctx = canvas.getContext('2d');
          if (ctx) {
            drawLayout(ctx, cw, ch, layout, v.videoWidth, v.videoHeight, (c, sx, sy, sw, sh, dx, dy, dw, dh) =>
              (c as CanvasRenderingContext2D).drawImage(v, sx, sy, sw, sh, dx, dy, dw, dh),
            );
            if (!lastDraw) setDrawn(true);
            lastDraw = key;
          }
        }
      } else if (t && v.videoWidth && v.videoHeight) {
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

  // A refused play() never leaves a stopped video that looks like it plays (iPhones refuse sound
  // on a video the person didn't tap): it plays muted instead, or the caller shows it paused.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (!playing) {
      v.pause();
      return;
    }
    void v.play().catch((err: unknown) => {
      const outcome = playFallback((err as { name?: string } | null)?.name, v.muted);
      if (outcome === 'retry-muted') {
        v.muted = true;
        onPlayBlockedRef.current?.('retry-muted');
        void v.play().catch((again: unknown) => {
          if (playFallback((again as { name?: string } | null)?.name, true) === 'paused') onPlayBlockedRef.current?.('paused');
        });
      } else if (outcome === 'paused') {
        onPlayBlockedRef.current?.('paused');
      }
    });
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
  const layout = aspect === '9:16' ? framing : null;
  return (
    <div
      className={`clip-preview${aspect === '16:9' ? ' is-landscape' : ''}${ready ? '' : ' is-loading'}${layout ? ' is-framed' : ''}${className ? ` ${className}` : ''}`}
    >
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
      {layout && (
        <>
          {poster && !drawn && <img className="clip-preview-poster" src={poster} alt="" aria-hidden="true" />}
          <canvas ref={canvasRef} className="clip-preview-canvas" aria-hidden="true" />
        </>
      )}
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
