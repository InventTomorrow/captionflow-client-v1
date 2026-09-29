import { useEffect, useState } from 'react';

/**
 * True while the page is scrolling, and for a beat after it stops.
 *
 * The landing page's decorative loops (card motifs, sparks, glows) each run
 * on their own compositor layer. Pausing them is not enough on an integrated
 * GPU — a paused animation keeps its layer, and it is the sheer number of
 * layers moving under a scroll that makes it stutter. Components that gate
 * their loops on `is-visible` also gate them on this, so the loops are
 * removed outright while the page moves and restart, in sync, once it
 * settles. One listener serves every subscriber.
 */

const SETTLE_MS = 160;

let scrolling = false;
let timer = 0;
let bound = false;
const listeners = new Set<(held: boolean) => void>();

function notify(value: boolean) {
  if (scrolling === value) return;
  scrolling = value;
  listeners.forEach((l) => l(value));
}

function bind() {
  if (bound || typeof window === 'undefined') return;
  bound = true;
  window.addEventListener(
    'scroll',
    () => {
      notify(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => notify(false), SETTLE_MS);
    },
    { passive: true },
  );
}

export function useScrollHold(): boolean {
  const [held, setHeld] = useState(scrolling);
  useEffect(() => {
    bind();
    listeners.add(setHeld);
    setHeld(scrolling);
    return () => {
      listeners.delete(setHeld);
    };
  }, []);
  return held;
}
