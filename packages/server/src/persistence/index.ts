/**
 * Store factory. Prefers `node:sqlite`; degrades to atomic JSON files if the
 * built-in driver is unavailable, so persistence is never silently lost.
 */

import path from 'node:path';
import type { ServerConfig } from '../config.js';
import type { Logger } from '../logger.js';
import { JsonFileGameStore } from './jsonStore.js';
import { MemoryGameStore } from './memoryStore.js';
import type { GameStore } from './types.js';

export * from './types.js';
export { JsonFileGameStore } from './jsonStore.js';
export { MemoryGameStore } from './memoryStore.js';
export { SqliteGameStore } from './sqliteStore.js';

export async function createStore(config: ServerConfig, logger: Logger): Promise<GameStore> {
  if (config.storeKind === 'memory') {
    logger.warn('Persistence disabled (PG_STORE=memory): games will NOT survive a restart.');
    return new MemoryGameStore();
  }

  const dbPath = path.join(config.dataDir, config.dbFile);

  if (config.storeKind === 'sqlite') {
    try {
      // Dynamic import: `node:sqlite` throws on Node builds without it, and we
      // want to fall back rather than crash the process at module-load time.
      const { SqliteGameStore } = await import('./sqliteStore.js');
      const store = new SqliteGameStore(dbPath);
      logger.info('Persistence ready', { backend: 'node:sqlite', file: store.location });
      return store;
    } catch (err) {
      logger.warn('node:sqlite unavailable — falling back to atomic JSON persistence', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const jsonPath = dbPath.replace(/\.db$/, '') + '.json';
  const store = new JsonFileGameStore(jsonPath);
  logger.info('Persistence ready', { backend: 'json-atomic', file: store.location });
  return store;
}
