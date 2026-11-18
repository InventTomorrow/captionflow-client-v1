import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { hideBootLoader } from './lib/bootLoader';
import './index.css';
import './clips.css';
// The landing page's minimal look across the app (loaded last on purpose).
import './theme-minimal.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);

// The loading screen (index.html): app pages drop it once rendered; the landing page
// keeps it until its hero is ready (LandingPage.tsx). Never longer than 8 s, whatever happens.
if (window.location.pathname !== '/') requestAnimationFrame(() => hideBootLoader());
window.setTimeout(hideBootLoader, 8000);
