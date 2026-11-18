import { useEffect } from 'react';
import { hideBootLoader } from '../lib/bootLoader';

/**
 * App pages drop the boot loader (index.html) once React has drawn its first
 * screen: after the commit, so a PageLoader drawn in that first screen still
 * sees the boot loader up and takes over seamlessly. The landing page keeps
 * the boot loader until its hero is ready (LandingPage.tsx).
 */
export function BootLoaderDone() {
  useEffect(() => {
    if (window.location.pathname !== '/') hideBootLoader();
  }, []);
  return null;
}
