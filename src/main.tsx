import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { IconContext } from '@phosphor-icons/react';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { BootLoaderDone } from './components/BootLoaderDone';
import { hideBootLoader } from './lib/bootLoader';
import './index.css';
import './clips.css';
// The landing page's minimal look across the app (loaded last on purpose).
import './theme-minimal.css';

/** App-wide icon look: Phosphor duotone (soft fill + crisp outline), 24px unless a component says otherwise. */
const ICONS = { weight: 'duotone', size: 24 } as const;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <IconContext.Provider value={ICONS}>
        <BrowserRouter>
          <App />
          <BootLoaderDone />
        </BrowserRouter>
      </IconContext.Provider>
    </ErrorBoundary>
  </StrictMode>,
);

// Brief feedback after a click, including buttons rendered in portal menus.
// The Web Animations API leaves each button's existing hover transitions intact.
document.addEventListener('click', (event) => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  const control = target.closest('button, input[type="button"], input[type="submit"], a.btn, [role="button"]');
  if (!control || !(control instanceof HTMLElement) || typeof control.animate !== 'function') return;
  if (control instanceof HTMLButtonElement && control.disabled) return;
  if (control instanceof HTMLInputElement && control.disabled) return;
  control.animate(
    [{ scale: '1' }, { scale: '0.965', offset: 0.42 }, { scale: '1' }],
    { duration: 190, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' },
  );
});

// Whatever happens, the boot loader never stays longer than 8 s.
window.setTimeout(hideBootLoader, 8000);
