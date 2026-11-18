import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { BootLoaderDone } from './components/BootLoaderDone';
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
        <BootLoaderDone />
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);

// Whatever happens, the boot loader never stays longer than 8 s.
window.setTimeout(hideBootLoader, 8000);
