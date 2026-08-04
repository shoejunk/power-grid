import { MotionConfig } from 'framer-motion';
import { useEffect } from 'react';

import { net, useGameStore } from './net';
import { CreateGame } from './screens/CreateGame';
import { GameScreen } from './screens/GameScreen';
import { JoinGame } from './screens/JoinGame';
import { Lobby } from './screens/Lobby';
import { MainMenu } from './screens/MainMenu';
import { ErrorBoundary, Toaster } from './ui';

/**
 * Application shell.
 *
 * Routing is store state rather than the URL: a Power Grid seat is bound to a
 * session token, not to a path, and deep-linking into a lobby you are not
 * seated in is meaningless. `AnimatePresence` cross-fades between screens so a
 * route change is never a hard cut (quality bar M1).
 */
export function App(): JSX.Element {
  const route = useGameStore((s) => s.route);

  /* Open the socket once, for the lifetime of the app. The socket owns its own
     reconnection; we only tear it down on unload. */
  useEffect(() => {
    net.start();
    return () => net.stop();
  }, []);

  /* Reconnect the instant the tab is refocused or the OS reports the network
     is back, instead of waiting out the current backoff window. */
  useEffect(() => {
    const wake = (): void => {
      if (document.visibilityState === 'visible') net.retry();
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    return () => {
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
    };
  }, []);

  return (
    /*
     * `reducedMotion="user"` is the global switch for framer-motion: with it,
     * every transform/layout animation in the app collapses to an opacity
     * fade when the OS asks for reduced motion, while opacity and colour
     * transitions still run so state changes stay legible. The SCSS side
     * mirrors this through the --pg-dur-* tokens (quality bar M5).
     */
    <MotionConfig reducedMotion="user">
      <a className="pg-skip-link" href="#pg-main">
        Skip to main content
      </a>

      {/*
        A plain keyed <div>. No AnimatePresence, and no motion on this wrapper.

        Both were correctness hazards under React StrictMode's double-invoke,
        and both were measured rather than suspected:

        · With AnimatePresence, two `.pg-route` elements stayed mounted
          indefinitely — the OUTGOING screen stranded at opacity 1 and the
          INCOMING one stuck at opacity 0. Clicking "Create game" left the menu
          on screen forever. The exit also scaled past 1.0, costing 3px of
          horizontal document overflow on every route change.
        · Dropping to a keyed `motion.div` fixed the stranding, but the
          entrance still never ran: the remount applied `initial` and never
          advanced to `animate`, leaving the new screen invisible at opacity 0.

        Route transitions therefore own no animation at all. Each screen runs
        its own entrance stagger internally, so arrivals are still animated
        (quality bar M1) — the wrapper simply cannot wedge them any more.
      */}
      <ErrorBoundary>
        <div key={route} id="pg-main" className="pg-route">
          {renderRoute(route)}
        </div>
      </ErrorBoundary>

      <Toaster />
    </MotionConfig>
  );
}

function renderRoute(route: ReturnType<typeof useGameStore.getState>['route']): JSX.Element {
  switch (route) {
    case 'create':
      return <CreateGame />;
    case 'join':
      return <JoinGame />;
    case 'lobby':
      return <Lobby />;
    case 'game':
      return <GameScreen />;
    case 'menu':
    default:
      return <MainMenu />;
  }
}
