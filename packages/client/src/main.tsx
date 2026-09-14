import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
/* The design system first, then the portal's own layouts on top of it. A
   game's stylesheet arrives later, with that game's UI module. */
import '@tt/ui/styles/index.scss';
import './portal/portal.scss';

/*
 * A player can keep this tab open while a new release replaces Vite's hashed
 * chunks. If code already running in the tab then opens a game, its dynamic
 * import may point at an asset from the previous release and fail with a 404.
 * Refresh once so the browser picks up the current HTML and chunk manifest.
 *
 * Keep a short session-scoped guard: a genuinely broken deployment should
 * surface its normal error state instead of trapping the player in a reload
 * loop.
 */
const CHUNK_RELOAD_KEY = 'tt.chunk-reload-at';
const CHUNK_RELOAD_COOLDOWN_MS = 10_000;

window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();

  const now = Date.now();
  const lastReload = Number.parseInt(sessionStorage.getItem(CHUNK_RELOAD_KEY) ?? '', 10);
  if (Number.isFinite(lastReload) && now - lastReload < CHUNK_RELOAD_COOLDOWN_MS) {
    console.error('[tabletop] lazy-loaded code still failed after refreshing', event.payload);
    return;
  }

  sessionStorage.setItem(CHUNK_RELOAD_KEY, String(now));
  window.location.reload();
});

window.setTimeout(() => {
  sessionStorage.removeItem(CHUNK_RELOAD_KEY);
}, CHUNK_RELOAD_COOLDOWN_MS);

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
