/**
 * PageLoader — the loading screen (the same look as index.html's #boot-loader:
 * logo + a thin kiwi line) for anything that keeps a page from showing: a page
 * whose code is still downloading, the session check, a page fetching the data
 * it needs before it can draw.
 *
 * - Full screen by default; `inline` fills the space under the app's top bar.
 * - Appears only once the wait passes `delayMs`, so fast loads never flicker.
 * - While the boot loader is still up (first visit) it shows at once with no
 *   fade, so the boot loader fading out reveals an identical screen.
 */
import { useEffect, useState } from 'react';
import { bootLoaderVisible } from '../lib/bootLoader';
import './PageLoader.css';

/**
 * Waits often come one after another (session check → feature flags → page code
 * → page data), each with its own PageLoader. A loader that takes over from one
 * on screen (or one that left a moment ago) shows at once, without the delay or
 * fade, so the chain reads as one loading screen instead of a blinking logo.
 */
let visibleLoaders = 0;
let lastHiddenAt = -Infinity;
const HANDOVER_MS = 400;
const takingOver = () => visibleLoaders > 0 || performance.now() - lastHiddenAt < HANDOVER_MS;

export function PageLoader({
  inline = false,
  delayMs = 200,
  label = 'Loading',
}: {
  inline?: boolean;
  delayMs?: number;
  label?: string;
}) {
  const [handover] = useState(() => bootLoaderVisible() || takingOver());
  const [shown, setShown] = useState(() => handover || delayMs <= 0);

  useEffect(() => {
    if (shown) return;
    const timer = window.setTimeout(() => setShown(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [shown, delayMs]);

  // Count this loader as on screen while it shows, so the next one can take over seamlessly.
  useEffect(() => {
    if (!shown) return;
    visibleLoaders += 1;
    return () => {
      visibleLoaders -= 1;
      lastHiddenAt = performance.now();
    };
  }, [shown]);

  return (
    <div
      className={`page-loader${inline ? ' page-loader-inline' : ''}${shown ? ' is-shown' : ''}${handover ? ' no-fade' : ''}`}
      role="status"
      aria-live="polite"
    >
      {shown && (
        <>
          <div className="page-loader-logo">
            <img src="/brand/loader-mark.webp" alt="" width={44} height={48} />
            <img src="/brand/loader-wordmark.webp" alt="" width={117} height={40} />
          </div>
          <div className="page-loader-track">
            <i />
          </div>
        </>
      )}
      <span className="page-loader-sr">{label}…</span>
    </div>
  );
}
