/**
 * The registry seam.
 *
 * Everything else in this suite runs against a stub game on purpose, to prove
 * the server is game-agnostic. This file does the opposite: it boots the
 * *real* registry and plays a real title through it, so a plugin that
 * satisfies the type but not the contract cannot ship.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { getMap, isZoneContiguous, ZONE_AREA_COUNT, type GameState } from '@game/power-grid';
import { createRegistry, GAMES } from '../games.js';
import { silentLogger } from '../logger.js';
import { startServer, type RunningServer } from '../server.js';
import { createGame, joinGame, makeDataDir, removeDataDir } from './helpers.js';

describe('game registry', () => {
  const cleanups: (() => void | Promise<void>)[] = [];

  afterEach(async () => {
    for (const fn of cleanups.splice(0).reverse()) await fn();
  });

  it('registers every built-in game under a unique key', () => {
    const registry = createRegistry();
    expect(registry.keys).toContain('power-grid');
    expect(registry.keys).toContain('dead-of-winter');
    expect(new Set(registry.keys).size).toBe(registry.keys.length);
  });

  it('publishes a portal-ready descriptor for every game', () => {
    for (const plugin of GAMES) {
      const d = plugin.descriptor;
      expect(d.key, 'key').toMatch(/^[a-z0-9-]+$/);
      expect(d.name.length, `${d.key} name`).toBeGreaterThan(0);
      expect(d.tagline.length, `${d.key} tagline`).toBeGreaterThan(0);
      expect(d.blurb.length, `${d.key} blurb`).toBeGreaterThan(0);
      expect(d.playTime.length, `${d.key} playTime`).toBeGreaterThan(0);
      expect(d.minPlayers, `${d.key} minPlayers`).toBeGreaterThanOrEqual(1);
      expect(d.maxPlayers, `${d.key} maxPlayers`).toBeGreaterThanOrEqual(d.minPlayers);
      // A table can only seat as many players as the game has colours for.
      expect(d.seatColors.length, `${d.key} seatColors`).toBeGreaterThanOrEqual(d.maxPlayers);
      expect(new Set(d.seatColors).size, `${d.key} duplicate colours`).toBe(d.seatColors.length);
      for (const channel of ['accent', 'backdrop', 'ink'] as const) {
        expect(d.theme[channel], `${d.key} theme.${channel}`).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it('rejects two games claiming the same key', () => {
    const [first] = GAMES;
    expect(first).toBeDefined();
    expect(() => createRegistry([first!, first!])).toThrow(/registered under the key/);
  });

  it('runs a real Power Grid lobby through to a live game', async () => {
    const dataDir = makeDataDir();
    cleanups.push(() => removeDataDir(dataDir));

    // No registry override: this exercises the production composition root.
    const server: RunningServer = await startServer({
      port: 0,
      host: '127.0.0.1',
      serveClient: false,
      storeKind: 'sqlite',
      dbFile: 'registry.db',
      dataDir,
      logger: silentLogger,
      heartbeatMs: 60_000,
    });
    cleanups.push(() => server.close());

    const host = await createGame(
      server,
      'Ada',
      { playerCount: 2, mapId: 'germany', experiencedStart: false, againstTheTrust: false },
      'power-grid',
    );
    cleanups.push(() => host.client.close());
    const guest = await joinGame(server, host.code, 'Grace');
    cleanups.push(() => guest.client.close());

    guest.client.send({ t: 'setReady', ready: true });
    await host.client.waitLobby((l) => l.players.every((p) => p.ready || p.isHost));

    host.client.clear();
    guest.client.clear();
    host.client.send({ t: 'startGame' });

    const frame = await host.client.waitAnyState<GameState>();
    expect(frame.gameKey).toBe('power-grid');
    const state = frame.state;

    expect(state.code).toBe(host.code);
    expect(state.hostId).toBe(host.playerId);
    expect(Object.keys(state.players)).toHaveLength(2);
    expect(state.settings.playerCount).toBe(2);
    // The plugin runs the engine's automatic zone draw during createGame, so a
    // started game is never still waiting on a region choice.
    expect(state.zone).toHaveLength(ZONE_AREA_COUNT[state.settings.playerCount]!);
    expect(isZoneContiguous(getMap(state.settings.mapId), state.zone)).toBe(true);
    expect(state.setupStage).not.toBe('zoneSelection');

    // The face-down supply stack must never reach a client.
    expect(state.plantMarket.stack.every((id) => id === -1)).toBe(true);

    // Whatever the opening flow is, the game must survive a restart.
    const persisted = server.store.loadGames().find((g) => g.code === host.code);
    expect(persisted?.gameKey).toBe('power-grid');
    expect(persisted?.started).toBe(true);
    expect(persisted?.state).not.toBeNull();
  });

  it('refuses to create a game this server does not host', async () => {
    const dataDir = makeDataDir();
    cleanups.push(() => removeDataDir(dataDir));
    const server = await startServer({
      port: 0,
      host: '127.0.0.1',
      serveClient: false,
      storeKind: 'memory',
      dataDir,
      logger: silentLogger,
      heartbeatMs: 60_000,
    });
    cleanups.push(() => server.close());

    const { TestClient } = await import('./testClient.js');
    const client = await TestClient.connect(server.wsUrl);
    cleanups.push(() => client.close());
    client.send({ t: 'createGame', gameKey: 'chess', name: 'Ada', settings: {} });
    expect((await client.wait('error')).code).toBe('noSuchGame');
  });
});
