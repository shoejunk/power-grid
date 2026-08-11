import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
/* The design system first, then the portal's own layouts on top of it. A
   game's stylesheet arrives later, with that game's UI module. */
import '@tt/ui/styles/index.scss';
import './portal/portal.scss';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Missing #root element — index.html is out of sync with main.tsx.');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/**
 * Retire the boot splash only once React has actually painted.
 *
 * Two rAFs: the first fires after React's commit is scheduled, the second
 * after the browser has painted it. Fading out at that point means there is
 * never a frame of unstyled or empty content between the splash and the app
 * (quality bar V8).
 */
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    const boot = document.getElementById('boot');
    if (!boot) return;
    boot.dataset.hidden = 'true';
    window.setTimeout(() => boot.remove(), 500);
  });
});
