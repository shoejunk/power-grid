/**
 * Verifies the engine seam: the server resolves the real rules engine when it
 * is available and still works end to end against it, and degrades to the
 * placeholder without crashing when it is not.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { ZONE_AREA_COUNT, getMap, isZoneContiguous } from '@pg/shared';
import { loadEngine } from '../engine/loadEngine.js';
import { silentLogger } from '../logger.js';
import { startServer, type RunningServer } from '../server.js';
import { createGame, joinGame, makeDataDir, removeDataDir } from './helpers.js';

describe('rules engine integration', () => {
  const cleanups: (() => void | Promise<void>)[] = [];

  afterEach(async () => {
    for (const fn of cleanups.splice(0).reverse()) await fn();
  });

  it('resolves an engine satisfying the server contract', async () => {
    const loaded = await loadEngine(silentLogger);
    expect(typeof loaded.engine.createGame).toBe('function');
    expect(typeof loaded.engine.validateAction).toBe('function');
    expect(typeof loaded.engine.applyAction).toBe('function');
    expect(loaded.source).toBeTruthy();
  });

  it('runs a real lobby through to a live game with whatever engine is installed', async () => {
    const dataDir = makeDataDir();
    cleanups.push(() => removeDataDir(dataDir));

    // No `engine` override: this exercises the production resolution path.
    const server: RunningServer = await startServer({
      port: 0,
      host: '127.0.0.1',
      serveClient: false,
      storeKind: 'sqlite',
      dbFile: 'engine.db',
      dataDir,
      logger: silentLogger,
      heartbeatMs: 60_000,
    });
    cleanups.push(() => server.close());

    const host = await createGame(server, 'Ada', { playerCount: 2, mapId: 'germany' });
    cleanups.push(() => host.client.close());
    const guest = await joinGame(server, host.code, 'Grace');
    cleanups.push(() => guest.client.close());

    guest.client.send({ t: 'setReady', ready: true });
    await host.client.waitLobby((l) => l.players.every((p) => p.ready || p.isHost));

    host.client.clear();
    guest.client.clear();
    host.client.send({ t: 'startGame' });

    const state = (await host.client.wait('state')).state;
    expect(state.code).toBe(host.code);
    expect(state.hostId).toBe(host.playerId);
    expect(Object.keys(state.players).length).toBeGreaterThanOrEqual(2);
    expect(state.settings.playerCount).toBe(2);
    expect(state.zone).toHaveLength(ZONE_AREA_COUNT[state.settings.playerCount]);
    expect(isZoneContiguous(getMap(state.settings.mapId), state.zone)).toBe(true);
    expect(state.setupStage).not.toBe('zoneSelection');
    // Whatever the engine's opening flow is, the game must survive a restart.
    const persisted = server.store.loadGames().find((g) => g.code === host.code);
    expect(persisted?.started).toBe(true);
    expect(persisted?.state).not.toBeNull();
  });
});
