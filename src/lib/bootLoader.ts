/**
 * bootLoader.ts — the loading screen in index.html (#boot-loader). It shows
 * as soon as the site is opened, before any app code has arrived. App pages
 * drop it once React has rendered (main.tsx); the landing page keeps it until
 * its fonts and hero image are ready (LandingPage.tsx), so visitors never
 * see the page half-drawn.
 */

let hidden = false;

/** Whether the loading screen is still up (false once it has started fading out). */
export function bootLoaderVisible(): boolean {
  return !hidden && !!document.getElementById('boot-loader');
}

/** Fade the loading screen out and remove it. Safe to call more than once. */
export function hideBootLoader(): void {
  if (hidden) return;
  hidden = true;
  const el = document.getElementById('boot-loader');
  if (!el) return;
  el.classList.add('is-done');
  const remove = () => el.remove();
  el.addEventListener('transitionend', remove, { once: true });
  window.setTimeout(remove, 800); // transitionend doesn't fire with reduced motion or a hidden tab
}

/**
 * Resolve when the landing page can be shown: the UI font and the hero image
 * are ready, but never later than `maxMs` (a slow connection still gets a page).
 */
export function landingAssetsReady(posterSrc: string, maxMs = 3000): Promise<void> {
  // Only the landing's own font (not every caption font the app's CSS knows about).
  const fonts = document.fonts
    ? Promise.all([document.fonts.load('400 16px "DM Sans"'), document.fonts.load('650 16px "DM Sans"')])
    : Promise.resolve();
  const poster = new Image();
  poster.src = posterSrc;
  const image = poster.decode ? poster.decode() : Promise.resolve();
  const settled = Promise.all([fonts, image]).then(
    () => undefined,
    () => undefined,
  );
  return Promise.race([settled, new Promise<void>((resolve) => window.setTimeout(resolve, maxMs))]);
}
