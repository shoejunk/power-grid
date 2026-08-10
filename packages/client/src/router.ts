import { useCallback, useSyncExternalStore } from 'react';

/**
 * URL routing.
 *
 * Small enough to own rather than depend on: three routes, no nesting, no
 * loaders. What matters is that the URL is now real — `/g/power-grid` and
 * `/join/ABC123` can be pasted into a chat window and they work.
 *
 * What the URL deliberately does *not* encode is the player's seat. A seat is
 * bound to the session token in localStorage, so a reload restores it whatever
 * the path says; the shell shows the lobby or the match because the server
 * said so, not because of where the browser happens to be pointing. That is
 * why `Route` has no 'lobby' or 'match' member.
 */

export type Route =
  /** The game picker. */
  | { name: 'portal' }
  /** A single game's detail page, where a table is created. */
  | { name: 'game'; gameKey: string }
  /** Join by code. `code` is pre-filled from the path when present. */
  | { name: 'join'; code: string | null }
  | { name: 'notFound'; path: string };

const JOIN_CODE = /^[A-Z0-9]{1,12}$/;
const GAME_KEY = /^[a-z0-9][a-z0-9-]{0,40}$/;

export function parseRoute(pathname: string): Route {
  const segments = pathname.split('/').filter(Boolean);

  if (segments.length === 0) return { name: 'portal' };

  if (segments[0] === 'g' && segments.length === 2 && GAME_KEY.test(segments[1]!)) {
    return { name: 'game', gameKey: segments[1]! };
  }

  if (segments[0] === 'join') {
    if (segments.length === 1) return { name: 'join', code: null };
    const code = segments[1]!.toUpperCase();
    if (segments.length === 2 && JOIN_CODE.test(code)) return { name: 'join', code };
  }

  return { name: 'notFound', path: pathname };
}

export function routeToPath(route: Route): string {
  switch (route.name) {
    case 'game':
      return `/g/${route.gameKey}`;
    case 'join':
      return route.code === null ? '/join' : `/join/${route.code}`;
    case 'notFound':
      return route.path;
    case 'portal':
    default:
      return '/';
  }
}

/* ------------------------------------------------------------------ *
 * History binding
 * ------------------------------------------------------------------ */

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('popstate', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('popstate', listener);
  };
}

/**
 * `useSyncExternalStore` needs a stable snapshot: returning a fresh object
 * every call would re-render forever. The pathname string is the snapshot, and
 * parsing happens once per change.
 */
const getSnapshot = (): string => window.location.pathname;

/** Programmatic navigation. `pushState` does not notify listeners itself. */
export function navigate(route: Route, options: { replace?: boolean } = {}): void {
  const path = routeToPath(route);
  if (path === window.location.pathname) return;
  if (options.replace) window.history.replaceState(null, '', path);
  else window.history.pushState(null, '', path);
  for (const listener of listeners) listener();
}

export function useRoute(): Route {
  const pathname = useSyncExternalStore(subscribe, getSnapshot, () => '/');
  return parseRoute(pathname);
}

/** Stable `navigate`, for use in effects and callbacks. */
export function useNavigate(): (route: Route, options?: { replace?: boolean }) => void {
  return useCallback(navigate, []);
}
