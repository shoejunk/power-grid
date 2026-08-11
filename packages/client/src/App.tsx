import { GameTheme } from '@tt/ui';
import { MotionConfig } from 'framer-motion';
import { useEffect } from 'react';

import { useGameUi } from './games/registry';
import { net, Toaster, useGameStore } from './net';
import { JoinGame } from './portal/JoinGame';
import { Lobby } from './portal/Lobby';
import { Portal } from './portal/Portal';
import { GameDetail } from './portal/GameDetail';
import { NotFound } from './portal/NotFound';
import { useRoute } from './router';
import { ErrorBoundary } from '@tt/ui';

/**
 * Application shell.
 *
 * Two things decide what is on screen, and they are deliberately separate:
 *
 *   · the URL says where the player navigated — the portal, a game's page,
 *     a join link. It is real history, so those links can be shared.
 *   · the store says whether the player is *seated* at a table. A seat is
 *     bound to the session token in localStorage, not to a path, so a reload
 *     restores it whatever the address bar happens to say.
 *
 * A seat therefore wins over the URL: if the server has put us in a lobby or a
 * match, that is what we render. This is what makes reconnection invisible
 * (quality bar U9) without the URL having to encode a game id.
 */
export function App(): JSX.Element {
  const route = useRoute();
  const lobby = useGameStore((s) => s.lobby);
  const state = useGameStore((s) => s.state);
  const seatedGameKey = useGameStore((s) => s.gameKey);

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

  /* Which game's identity the whole shell wears: the one we are seated at,
     otherwise the one whose page we are looking at, otherwise none. */
  const themeKey = seatedGameKey ?? (route.name === 'game' ? route.gameKey : null);
  const { module: gameUi } = useGameUi(themeKey);

  const seated = lobby !== null || state !== null;
  const screenKey = seated ? (state !== null ? 'match' : 'lobby') : routeKey(route);

  return (
    /*
     * `reducedMotion="user"` is the global switch for framer-motion: with it,
     * every transform/layout animation in the app collapses to an opacity
     * fade when the OS asks for reduced motion, while opacity and colour
     * transitions still run so state changes stay legible. The SCSS side
     * mirrors this through the --tt-dur-* tokens (quality bar M5).
     */
    <MotionConfig reducedMotion="user">
      <a className="tt-skip-link" href="#tt-main">
        Skip to main content
      </a>

      <GameTheme descriptor={gameUi?.descriptor ?? null}>
        {/*
          A plain keyed <div>. No AnimatePresence, and no motion on this wrapper.

          Both were correctness hazards under React StrictMode's double-invoke,
          and both were measured rather than suspected:

          · With AnimatePresence, two `.tt-route` elements stayed mounted
            indefinitely — the OUTGOING screen stranded at opacity 1 and the
            INCOMING one stuck at opacity 0. Clicking "Create game" left the
            menu on screen forever. The exit also scaled past 1.0, costing 3px
            of horizontal document overflow on every route change.
          · Dropping to a keyed `motion.div` fixed the stranding, but the
            entrance still never ran: the remount applied `initial` and never
            advanced to `animate`, leaving the new screen invisible at opacity 0.

          Route transitions therefore own no animation at all. Each screen runs
          its own entrance stagger internally, so arrivals are still animated
          (quality bar M1) — the wrapper simply cannot wedge them any more.
        */}
        <ErrorBoundary>
          <div key={screenKey} id="tt-main" className="tt-route">
            <Screen />
          </div>
        </ErrorBoundary>
      </GameTheme>

      <Toaster />
    </MotionConfig>
  );
}

function routeKey(route: ReturnType<typeof useRoute>): string {
  switch (route.name) {
    case 'game':
      return `game:${route.gameKey}`;
    case 'join':
      return 'join';
    case 'notFound':
      return 'notFound';
    case 'portal':
    default:
      return 'portal';
  }
}

/**
 * Screen selection.
 *
 * Split out from `App` so the seat check and the route check read as one list
 * rather than as nested ternaries inside JSX.
 */
function Screen(): JSX.Element {
  const route = useRoute();
  const lobby = useGameStore((s) => s.lobby);
  const state = useGameStore((s) => s.state);

  /* A live match beats everything, including the URL. */
  if (state !== null) return <Match />;
  if (lobby !== null) return <Lobby />;

  switch (route.name) {
    case 'game':
      return <GameDetail gameKey={route.gameKey} />;
    case 'join':
      return <JoinGame initialCode={route.code} />;
    case 'notFound':
      return <NotFound path={route.path} />;
    case 'portal':
    default:
      return <Portal />;
  }
}

/**
 * The match, rendered by whichever game we are seated at.
 *
 * This is the whole of the shell's knowledge about playing a game: look up a
 * module by key and render its `Match`. Adding a game does not touch this.
 */
function Match(): JSX.Element {
  const gameKey = useGameStore((s) => s.gameKey);
  const { module, error } = useGameUi(gameKey);

  if (error) {
    return (
      <div className="tt-screen tt-crash">
        <p className="tt-lead">This game&rsquo;s interface failed to load.</p>
      </div>
    );
  }
  if (!module) return <div className="tt-screen" />;

  const GameMatch = module.Match;
  return <GameMatch />;
}
