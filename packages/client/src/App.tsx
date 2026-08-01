import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { useEffect } from 'react';

import { net, useGameStore } from './net';
import { DUR, springSoft } from './styles/motion';
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
        Cross-fade, not `mode="wait"`: `.pg-route` is absolutely positioned, so
        the outgoing and incoming screens can occupy the same box and dissolve
        into each other. That removes the empty frame a sequential transition
        leaves behind, and avoids the StrictMode double-mount that can wedge a
        waiting AnimatePresence in development.
      */}
      <ErrorBoundary>
        <AnimatePresence initial={false}>
          <motion.div
            key={route}
            id="pg-main"
            className="pg-route"
            /*
             * Deliberately concrete props rather than a variant set: variants
             * propagate `exit` down the whole screen, and every descendant's
             * exit animation then has to resolve before AnimatePresence will
             * unmount the screen. A single opacity/scale pair on the container
             * is both cheaper and impossible to wedge. Each screen still runs
             * its own entrance stagger internally.
             */
            initial={{ opacity: 0, scale: 0.99 }}
            animate={{ opacity: 1, scale: 1, transition: springSoft }}
            exit={{ opacity: 0, scale: 1.006, transition: { duration: DUR.base } }}
          >
            {renderRoute(route)}
          </motion.div>
        </AnimatePresence>
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
