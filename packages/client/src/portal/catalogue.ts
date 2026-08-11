import type { GameDescriptor } from '@tt/core';
import { useEffect, useState } from 'react';

/**
 * The site's game catalogue.
 *
 * Fetched from the server rather than imported, so the portal advertises
 * exactly what *this deployment* hosts. Importing the descriptors would mean
 * the home page could offer a game the server cannot seat you at, which is a
 * worse failure than a spinner.
 *
 * Cached at module scope: the catalogue changes when the server is redeployed,
 * not while somebody is browsing.
 */

export interface CatalogueState {
  games: readonly GameDescriptor[];
  loading: boolean;
  error: string | null;
}

let cached: readonly GameDescriptor[] | null = null;
let inFlight: Promise<readonly GameDescriptor[]> | null = null;

interface GamesResponse {
  ok: boolean;
  games?: GameDescriptor[];
}

export function fetchCatalogue(): Promise<readonly GameDescriptor[]> {
  if (cached) return Promise.resolve(cached);
  if (inFlight) return inFlight;

  inFlight = fetch('/api/games')
    .then(async (response) => {
      if (!response.ok) throw new Error(`The server answered ${response.status}.`);
      const body = (await response.json()) as GamesResponse;
      if (!body.ok || !Array.isArray(body.games)) throw new Error('Malformed catalogue.');
      cached = body.games;
      return cached;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

export function useCatalogue(): CatalogueState {
  const [state, setState] = useState<CatalogueState>(() => ({
    games: cached ?? [],
    loading: cached === null,
    error: null,
  }));

  useEffect(() => {
    if (cached) return undefined;
    let live = true;
    fetchCatalogue()
      .then((games) => {
        if (live) setState({ games, loading: false, error: null });
      })
      .catch((error: unknown) => {
        if (live) {
          setState({
            games: [],
            loading: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    return () => {
      live = false;
    };
  }, []);

  return state;
}

/** A single descriptor, once the catalogue has arrived. */
export function useDescriptor(gameKey: string): {
  descriptor: GameDescriptor | null;
  loading: boolean;
  error: string | null;
} {
  const { games, loading, error } = useCatalogue();
  return {
    descriptor: games.find((g) => g.key === gameKey) ?? null,
    loading,
    error,
  };
}
