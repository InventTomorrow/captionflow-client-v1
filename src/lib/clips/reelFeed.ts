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

/** The feed fills the screen under the page header — never shorter than this, never taller than the max. */
const FEED_MIN_PX = 480;
const FEED_MAX_PX = 980;
/** Below this it is never shrunk further (a very small window scrolls instead). */
const FEED_FLOOR_PX = 240;
/** Phones (and any short screen, like a phone held sideways) get a full screen under their app bar. */
const PHONE_MAX_WIDTH = 760;
const SHORT_MAX_HEIGHT = 560;

/**
 * Height of the reels feed, in px. Desktop: the screen left under the page
 * header (`top`, from the document's top). Phone, upright or sideways: a full
 * screen under the sticky app bar (`barH`) — the header above is taller than
 * a phone screen, so you scroll to the feed and it fills the view.
 */
export function feedHeightFor(v: { viewportW: number; viewportH: number; top: number; barH: number }): number {
  const underBar = v.viewportH - v.barH - 8;
  const phone = v.viewportW <= PHONE_MAX_WIDTH || v.viewportH <= SHORT_MAX_HEIGHT;
  const wanted = phone ? underBar : v.viewportH - v.top - 16;
  const floor = Math.max(FEED_FLOOR_PX, Math.min(FEED_MIN_PX, underBar));
  return Math.round(Math.min(FEED_MAX_PX, Math.max(floor, wanted)));
}

/**
 * What a reel does when the browser refuses play(). iPhones only allow sound
 * on a video the person tapped, so the next reel can be refused: it plays
 * muted instead (the mute button shows it; one tap brings the sound back).
 * Refused even muted (e.g. Low Power Mode) → shown paused, a tap plays it.
 * An AbortError just means a pause or seek interrupted play().
 */
export function playFallback(errorName: string | undefined, muted: boolean): 'retry-muted' | 'paused' | 'ignore' {
  if (errorName !== 'NotAllowedError') return 'ignore';
  return muted ? 'paused' : 'retry-muted';
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
