/**
 * The server's composition root for games.
 *
 * This is the one file that names individual titles, and it does nothing but
 * name them. Adding a game to the site is an import and a line in the array —
 * no other server file changes, because every other server file talks to
 * `GameRegistry` and `GamePlugin` rather than to a game.
 *
 * The imports are static rather than dynamic. The previous single-game server
 * probed for its engine at runtime and fell back to a placeholder when the
 * lookup failed, which meant a typo in a package name degraded silently into
 * "lobbies work, rules do not". A missing game is now a build error.
 */

import { erase, GameRegistry, type AnyGamePlugin } from '@tt/core';
import { deadOfWinter } from '@game/dead-of-winter';
import { powerGrid } from '@game/power-grid';

/** Every game this deployment hosts, in the order the portal lists them. */
export const GAMES: readonly AnyGamePlugin[] = [erase(powerGrid), erase(deadOfWinter)];

export function createRegistry(plugins: readonly AnyGamePlugin[] = GAMES): GameRegistry {
  return new GameRegistry(plugins);
}
