/**
 * clips/clipMode.ts — the captions editor working on one clip ("clip mode",
 * /projects/:id/editor?clip=<id>): which captions belong to the clip, how
 * seeks and playback stay inside it, and how the 9:16 preview frames it the
 * way the clip renders (same rules as ClipPreview and the export worker).
 */
import { cropRect } from './cropTrack';

export interface ClipRange {
  start: number;
  end: number;
}

/** Seeks land this far before the clip's end, so the loop check doesn't fire straight away. */
const END_GUARD = 0.05;
/** Playback this far before the start is seek jitter, not a jump out of the clip. */
const START_SLACK = 0.25;

/**
 * [from, to) of the captions overlapping the clip, as indices into the list
 * (the editor keeps captions in time order, so this is the clip's slice).
 * A caption that only touches an edge stays out. Nothing in range → [0, 0].
 */
export function captionWindow(captions: ReadonlyArray<{ start: number; end: number }>, start: number, end: number): [number, number] {
  let from = -1;
  let to = -1;
  captions.forEach((c, i) => {
    if (c.end > start && c.start < end) {
      if (from < 0) from = i;
      to = i + 1;
    }
  });
  return from < 0 ? [0, 0] : [from, to];
}

/** Where a seek lands: inside the clip, never on its very last frame. */
export function clampToClip(t: number, range: ClipRange): number {
  return Math.min(Math.max(t, range.start), range.end - END_GUARD);
}

/** Playback reached the end (or slipped out before the start): where to jump back to; null = keep going. */
export function loopedTime(t: number, range: ClipRange): number | null {
  if (t >= range.end || t < range.start - START_SLACK) return range.start;
  return null;
}

/**
 * CSS object-position that shows, with object-fit: cover, the same
 * outW:outH window the render crops around centre `cx` (0..1 of the width).
 */
export function coverObjectPosition(videoW: number, videoH: number, outW: number, outH: number, cx: number): string {
  const r = cropRect(videoW, videoH, outW, outH, cx);
  const px = videoW > r.width ? r.left / (videoW - r.width) : 0.5;
  const py = videoH > r.height ? r.top / (videoH - r.height) : 0.5;
  return `${(px * 100).toFixed(2)}% ${(py * 100).toFixed(2)}%`;
}

/** The captions editor opened on one clip, optionally on a side panel (e.g. 'templates'). */
export function clipEditorUrl(projectId: string, clipId: string, panel?: string): string {
  return `/projects/${projectId}/editor?clip=${clipId}${panel ? `&panel=${panel}` : ''}`;
}
