/**
 * Board preview harness — development only, never imported by the app.
 *
 * `GameScreen` is owned by another agent and currently mounts `<BoardMount />`
 * with no children, so this page reproduces the match grid's board cell at the
 * exact dimensions the real screen gives it and seeds the real zustand store.
 * That means what is verified here is the shipping code path, not a mock:
 * `GameBoard` still reads `useGameStore((s) => s.gameState)` and would still
 * send through `net.action`.
 *
 * Served by Vite at /src/board/dev/preview.html
 */

import { createRoot } from 'react-dom/client';

/*
 * `?reduced` forces the reduced-motion branch so M5 can be verified without
 * changing an OS setting. Patched before React mounts, because the board reads
 * the media query once on mount. Harness-only — the board itself has no such
 * override and always asks the real media query.
 */
if (new URLSearchParams(window.location.search).has('reduced')) {
  const real = window.matchMedia.bind(window);
  window.matchMedia = ((query: string) =>
    query.includes('prefers-reduced-motion')
      ? {
          matches: true,
          media: query,
          onchange: null,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
          addListener: () => undefined,
          removeListener: () => undefined,
          dispatchEvent: () => false,
        }
      : real(query)) as typeof window.matchMedia;
}

import { useGameStore } from '@/net';
import '@/styles/index.scss';

import { GameBoard } from '../GameBoard';
import { PREVIEW_PLAYER_ID, previewState } from './scenario';

useGameStore.setState({
  gameState: previewState(),
  myPlayerId: PREVIEW_PLAYER_ID,
  route: 'game',
  connectionStatus: 'connected',
});

/**
 * `?solo` fills the whole viewport with the board alone. The browser-pane
 * screenshot is capped near 800x450, so inspecting fine detail means sizing the
 * viewport to the board's real cell size and capturing it 1:1 rather than
 * photographing a 1280-wide page and losing half the pixels to downscaling.
 */
const SOLO = new URLSearchParams(window.location.search).has('solo');

function Harness(): JSX.Element {
  if (SOLO) {
    return (
      <div className="pgb-dev__solo">
        <GameBoard />
      </div>
    );
  }
  return (
    <div className="pgb-dev">
      <header className="pgb-dev__chrome">
        <span>POWER GRID — board preview</span>
        <span>Round 4 · Step 2 · Phase 4 Build</span>
      </header>
      <div className="pgb-dev__grid">
        <div className="pgb-dev__hud">HUD</div>
        <div className="pgb-dev__rail">Turn order</div>
        <div className="pgb-dev__board">
          <GameBoard />
        </div>
        <div className="pgb-dev__log">Rules log</div>
        <div className="pgb-dev__phase">Phase panel</div>
      </div>
    </div>
  );
}

const root = document.getElementById('root');
if (root) {
  try {
    createRoot(root).render(<Harness />);
  } catch (err) {
    root.textContent = `render failed: ${String(err)}`;
  }
} else {
  document.body.insertAdjacentHTML('beforeend', '<pre>no #root</pre>');
}

window.addEventListener('error', (e) => {
  document.title = `ERR ${e.message}`;
});
window.addEventListener('unhandledrejection', (e) => {
  document.title = `REJ ${String((e as PromiseRejectionEvent).reason)}`;
});
