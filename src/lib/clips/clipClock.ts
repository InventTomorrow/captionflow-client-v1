/**
 * clips/clipClock.ts — a clip opened in the editor is its own project but has
 * no video file of its own: the editor plays the ORIGINAL video, and these
 * helpers make it look like the clip alone.
 *
 * - clipClock: the editor's video, seen through the clip — currentTime 0 is
 *   the clip's in-point, duration is the clip's length, seeks stay inside.
 * - clipFraming: how the original is cropped to the clip (live in the
 *   preview with CSS, at export by the render worker).
 * - shiftCaptions: the clip's captions (0:00-based) placed back on the
 *   original's timeline for the export worker's trim.
 * - clipFontFactor: caption size for a frame filled by a crop, measured
 *   against the frame's shorter side so a template keeps its size and its
 *   single line on a tall frame.
 */
import type { Caption } from '../../stores/captionStore';
import type { CropTrack } from './cropTrack';

export interface ClipWindow {
  start: number;
  end: number;
}

/** The original video seen through the clip: 0..length, never outside it. */
export function clipClock(video: HTMLVideoElement, win: ClipWindow): HTMLVideoElement {
  const len = Math.max(0, win.end - win.start);
  return new Proxy(video, {
    get(target, prop) {
      if (prop === 'currentTime') return Math.min(len, Math.max(0, target.currentTime - win.start));
      if (prop === 'duration') return len;
      if (prop === 'ended') return target.ended || target.currentTime >= win.end - 0.02;
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
    set(target, prop, value) {
      if (prop === 'currentTime') {
        target.currentTime = Math.min(win.end, Math.max(win.start, Number(value) + win.start));
        return true;
      }
      return Reflect.set(target, prop, value, target);
    },
  });
}

/** Captions moved by `by` seconds (words too); the input is not changed. */
export function shiftCaptions(captions: Caption[], by: number): Caption[] {
  return captions.map((c) => ({
    ...c,
    start: +(c.start + by).toFixed(3),
    end: +(c.end + by).toFixed(3),
    words: c.words?.map((w) => ({ ...w, start: +(w.start + by).toFixed(3), end: +(w.end + by).toFixed(3) })),
  }));
}

/** How the original fills the clip's frame: a crop following a track, or the whole frame. */
export function clipFraming(crop: { mode: 'auto' | 'manual' | 'none'; x: number; track?: CropTrack }):
  | { mode: 'cover'; track: CropTrack }
  | { mode: 'contain' } {
  if (crop.mode === 'none') return { mode: 'contain' };
  if (crop.mode === 'manual') return { mode: 'cover', track: [[0, crop.x]] };
  return { mode: 'cover', track: crop.track?.length ? crop.track : [[0, 0.5]] };
}

/** "9:16" → [9, 16]; anything else → null. */
export function parseAspect(aspect: string | undefined | null): [number, number] | null {
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(String(aspect ?? ''));
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/**
 * Caption size factor for a clip frame. Caption size is authored in pixels of
 * a 1080 frame and scaled by the frame's height; on a tall frame filled by a
 * crop (1080×1920) that grows every template 1.78× against the width and
 * breaks single-line templates. Measuring against the shorter side instead
 * keeps the authored size on the 1080-wide frame: factor = width ÷ height for
 * portrait frames. Square, landscape and Fit (no crop) keep the authored size.
 */
export function clipFontFactor(aspect: string | undefined | null, cover: boolean): number {
  const a = parseAspect(aspect);
  if (!cover || !a) return 1;
  return Math.min(1, a[0] / a[1]);
}
