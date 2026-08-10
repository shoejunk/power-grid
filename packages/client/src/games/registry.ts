import type { GameKey } from '@tt/core';
import { useEffect, useState } from 'react';

import type { GameUiModule } from './types';

/**
 * The client's composition root for games.
 *
 * The one file in the client that names individual titles, and it does nothing
 * but name them. Each entry is a dynamic import, so a player who only ever
 * opens the portal downloads neither game's rules engine, art or stylesheet.
 *
 * Adding a game is a line here plus a module implementing `GameUiModule`.
 */
const LOADERS: Record<GameKey, () => Promise<{ default: GameUiModule }>> = {
  'power-grid': () => import('./power-grid'),
  'dead-of-winter': () => import('./dead-of-winter'),
};

export const GAME_KEYS: readonly GameKey[] = Object.keys(LOADERS);

export function hasGameUi(gameKey: string): boolean {
  return gameKey in LOADERS;
}

/**
 * Modules already fetched, so re-entering a game (or moving lobby → match)
 * does not flash a spinner for something that is already in memory.
 */
const cache = new Map<GameKey, GameUiModule>();
const inFlight = new Map<GameKey, Promise<GameUiModule>>();

export function loadGameUi(gameKey: GameKey): Promise<GameUiModule> {
  const cached = cache.get(gameKey);
  if (cached) return Promise.resolve(cached);

  const existing = inFlight.get(gameKey);
  if (existing) return existing;

  const loader = LOADERS[gameKey];
  if (!loader) return Promise.reject(new Error(`No UI is registered for the game '${gameKey}'.`));

  const promise = loader()
    .then((mod) => {
      cache.set(gameKey, mod.default);
      return mod.default;
    })
    .finally(() => inFlight.delete(gameKey));

  inFlight.set(gameKey, promise);
  return promise;
}

export interface GameUiState {
  module: GameUiModule | null;
  loading: boolean;
  error: Error | null;
}

/**
 * Loads the UI for a game key.
 *
 * Returns the cached module synchronously on the first render when there is
 * one, which is what keeps a lobby → match transition from blinking.
 */
export function useGameUi(gameKey: GameKey | null): GameUiState {
  const [state, setState] = useState<GameUiState>(() => ({
    module: gameKey ? (cache.get(gameKey) ?? null) : null,
    loading: gameKey !== null && !cache.has(gameKey),
    error: null,
  }));

  useEffect(() => {
    if (gameKey === null) {
      setState({ module: null, loading: false, error: null });
      return undefined;
    }

    const cached = cache.get(gameKey);
    if (cached) {
      setState({ module: cached, loading: false, error: null });
      return undefined;
    }

    let live = true;
    setState({ module: null, loading: true, error: null });
    loadGameUi(gameKey)
      .then((module) => {
        if (live) setState({ module, loading: false, error: null });
      })
      .catch((error: unknown) => {
        if (live) {
          setState({
            module: null,
            loading: false,
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      });
    return () => {
      live = false;
    };
  }, [gameKey]);

  return state;
}
