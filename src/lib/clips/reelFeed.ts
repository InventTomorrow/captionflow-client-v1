/**
 * clips/reelFeed.ts — pure helpers for the reels feed (components/clips/ReelFeed.tsx):
 * which reels mount a live player, keyboard steps, and where a clip sits on
 * the long video's timeline. Plus the remembered Reels/Grid choice.
 */

/**
 * Reels that mount a live player: the active one and the next (so a swipe
 * lands on a video that is already seeking). Everything else is a poster, so a
 * feed of many clips plays one long file at a time.
 */
export function reelMountSet(active: number, count: number): number[] {
  if (count <= 0) return [];
  const a = Math.min(Math.max(0, Math.trunc(active)), count - 1);
  return a + 1 < count ? [a, a + 1] : [a];
}

/** The reel `delta` steps from `current`, kept inside the feed. */
export function stepReel(current: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(Math.max(0, current + delta), count - 1);
}

/** Smallest visible width (percent) of a clip on the source bar. */
const MIN_SPAN_PCT = 0.6;

/** A clip's place on the whole video's bar, in percent (left edge, width). */
export function sourceSpan(start: number, end: number, duration: number): { left: number; width: number } {
  if (!(duration > 0)) return { left: 0, width: 0 };
  const clamp = (t: number) => Math.min(Math.max(0, t), duration);
  const s = clamp(start);
  const e = Math.max(s, clamp(end));
  const width = Math.max(MIN_SPAN_PCT, ((e - s) / duration) * 100);
  const left = Math.min((s / duration) * 100, 100 - width);
  return { left: Math.max(0, left), width: Math.min(width, 100) };
}

/** 65 → "1:05"; 4324 → "1:12:04". */
export function formatSourceTime(sec: number): string {
  const total = Number.isFinite(sec) && sec > 0 ? Math.floor(sec) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export type ClipsView = 'reels' | 'grid';
const VIEW_KEY = 'cf_clips_view';

/** The Reels/Grid choice this browser last made (Reels when unknown or storage is blocked). */
export function readClipsView(): ClipsView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'reels';
  } catch {
    return 'reels';
  }
}

export function writeClipsView(view: ClipsView): void {
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    /* private mode / blocked storage: the choice just isn't remembered */
  }
}
