/**
 * The set of games this deployment hosts.
 *
 * Both halves of the app need one: the server to route a table to its rules,
 * the client to render a game picker and mount the right UI. The registry is
 * therefore built here and populated by whoever owns the composition root, so
 * neither half hard-codes a list of games.
 */

import type { AnyGamePlugin, GameDescriptor } from './plugin.js';
import type { GameKey } from './types.js';

export class GameRegistry {
  private readonly games = new Map<GameKey, AnyGamePlugin>();

  constructor(plugins: readonly AnyGamePlugin[] = []) {
    for (const plugin of plugins) this.register(plugin);
  }

  register(plugin: AnyGamePlugin): void {
    const key = plugin.descriptor.key;
    if (this.games.has(key)) {
      throw new Error(`Two games are registered under the key '${key}'`);
    }
    this.games.set(key, plugin);
  }

  has(key: GameKey): boolean {
    return this.games.has(key);
  }

  get(key: GameKey): AnyGamePlugin | undefined {
    return this.games.get(key);
  }

  /**
   * Like `get`, but throws. Use at call sites that have already established
   * the key is real (a loaded table, a validated message) so a silent
   * `undefined` cannot turn into a table that accepts no actions.
   */
  require(key: GameKey): AnyGamePlugin {
    const plugin = this.games.get(key);
    if (!plugin) throw new Error(`No game is registered under the key '${key}'`);
    return plugin;
  }

  get keys(): GameKey[] {
    return [...this.games.keys()];
  }

  get all(): AnyGamePlugin[] {
    return [...this.games.values()];
  }

  /** Data-only projection, safe to serialise to the portal. */
  descriptors(): GameDescriptor[] {
    return this.all.map((g) => g.descriptor);
  }
}
