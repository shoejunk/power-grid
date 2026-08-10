/**
 * The headline requirement: "If a player leaves and comes back the game should
 * persist" — including across a full server restart.
 *
 * These tests stop the server process's server object entirely (closing the
 * SQLite handle), boot a brand new one against the same file on disk, and then
 * reconnect real WebSocket clients. Nothing is carried over in memory.
 */

import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StubState } from './stubGame.js';
import type { RunningServer } from '../server.js';
import { boot, closeAll, createGame, joinGame, makeDataDir, normaliseState, removeDataDir } from './helpers.js';
import { TestClient } from './testClient.js';

describe('persistence across a full server restart', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = makeDataDir();
  });

  afterEach(() => {
    removeDataDir(dataDir);
  });

  it('resumes an in-progress game after the server is stopped and started again', async () => {
    /* ---------- first boot: play a bit ---------- */
    const first = await boot({ dataDir });

    const host = await createGame(first, 'Ada');
    const guest = await joinGame(first, host.code, 'Grace');
    guest.client.send({ t: 'setReady', ready: true });
    await host.client.waitLobby((l) => l.players.every((p) => p.ready || p.isHost));
    host.client.send({ t: 'startGame' });
    await host.client.wait('state');
    await guest.client.wait('state');

    // A real move, so the persisted state is distinguishable from a fresh setup.
    host.client.send({ t: 'action', action: { type: 'claim', itemId: 6, cost: 9 } });
    const before: StubState = (await guest.client.waitState((s) => s.activePlayerId === guest.playerId)).state;
    expect(before.players[host.playerId]?.credits).toBe(41);
    expect(before.round).toBe(1);

    const code = host.code;
    const hostToken = host.sessionToken;
    const guestToken = guest.sessionToken;

    await closeAll(host.client, guest.client);
    await first.close();

    // The database really is on disk.
    const dbPath = path.join(dataDir, 'test.db');
    expect(fs.existsSync(dbPath)).toBe(true);
    expect(fs.statSync(dbPath).size).toBeGreaterThan(0);

    /* ---------- second boot: a brand new server ---------- */
    const second = await boot({ dataDir });
    try {
      // The game is back before anybody connects.
      const restored = second.hub.roomByCode(code);
      expect(restored).toBeDefined();
      expect(restored?.started).toBe(true);
      expect(restored?.seats.map((s) => s.name)).toEqual(['Ada', 'Grace']);
      // Everyone starts disconnected after a restart.
      expect(Object.values(restored?.state?.players ?? {}).every((p) => !p.connected)).toBe(true);

      // The code lookup survives too.
      const lookup = await (await fetch(`${second.url}/api/games/code/${code}`)).json();
      expect(lookup).toMatchObject({ ok: true, started: true, players: 2 });

      // Both players come back with the tokens they were issued before the restart.
      const hostBack = await TestClient.connect(second.wsUrl);
      hostBack.send({ t: 'rejoin', sessionToken: hostToken });
      expect((await hostBack.wait('welcome')).playerId).toBe(host.playerId);
      await hostBack.wait('state');

      const guestBack = await TestClient.connect(second.wsUrl);
      guestBack.send({ t: 'rejoin', sessionToken: guestToken });
      expect((await guestBack.wait('welcome')).playerId).toBe(guest.playerId);
      const after: StubState = (await guestBack.wait('state')).state;

      // The headline assertion: byte-for-byte the same game.
      expect(normaliseState(after)).toEqual(normaliseState(before));
      expect(after.players[host.playerId]?.credits).toBe(41);
      expect(after.players[host.playerId]?.claimed).toEqual([6]);
      expect(after.activePlayerId).toBe(guest.playerId);

      // …and play continues exactly where it left off.
      guestBack.clear();
      hostBack.clear();
      guestBack.send({ t: 'action', action: { type: 'pass' } });
      const resumedPlay = await hostBack.waitState((s) => s.round === 2);
      expect(resumedPlay.state.activePlayerId).toBe(host.playerId);

      await closeAll(hostBack, guestBack);
    } finally {
      await second.close();
    }
  });

  it('restores a lobby that had not started yet, including chat and settings', async () => {
    const first = await boot({ dataDir });
    const host = await createGame(first, 'Ada', { variant: 'spiced', tableSize: 3 });
    const guest = await joinGame(first, host.code, 'Grace');
    guest.client.send({ t: 'setReady', ready: true });
    await host.client.waitLobby((l) => l.players.every((p) => p.ready || p.isHost));
    host.client.send({ t: 'chat', text: 'starting soon' });
    await guest.client.wait('chat');

    const code = host.code;
    const guestToken = guest.sessionToken;
    await closeAll(host.client, guest.client);
    await first.close();

    const second = await boot({ dataDir });
    try {
      const back = await TestClient.connect(second.wsUrl);
      back.send({ t: 'rejoin', sessionToken: guestToken });
      await back.wait('welcome');
      const lobby = (await back.wait('lobby')).lobby;

      expect(lobby.code).toBe(code);
      expect(lobby.started).toBe(false);
      expect((lobby.settings as StubSettings).variant).toBe('spiced');
      expect((lobby.settings as StubSettings).tableSize).toBe(3);
      expect(lobby.players.map((p) => p.name)).toEqual(['Ada', 'Grace']);
      expect(lobby.players.find((p) => p.id === guest.playerId)?.ready).toBe(true);

      // Chat history is replayed on resume.
      const chat = await back.wait('chat');
      expect(chat.text).toBe('starting soon');

      // The restored lobby can still be started by the (restored) host.
      const hostBack = await TestClient.connect(second.wsUrl);
      hostBack.send({ t: 'rejoin', sessionToken: host.sessionToken });
      await hostBack.wait('welcome');
      await hostBack.wait('lobby');
      hostBack.clear();
      hostBack.send({ t: 'startGame' });
      const state = await hostBack.wait('state');
      expect(state.state.order).toHaveLength(2);

      await closeAll(back, hostBack);
    } finally {
      await second.close();
    }
  });

  it('persists every applied action immediately, not on shutdown', async () => {
    const server = await boot({ dataDir });
    const host = await createGame(server, 'Ada');
    const guest = await joinGame(server, host.code, 'Grace');
    guest.client.send({ t: 'setReady', ready: true });
    await host.client.waitLobby((l) => l.players.every((p) => p.ready || p.isHost));
    host.client.send({ t: 'startGame' });
    await host.client.wait('state');
    host.client.send({ t: 'action', action: { type: 'claim', itemId: 3, cost: 3 } });
    await guest.client.waitState((s) => s.activePlayerId === guest.playerId);

    // Read the store directly — the write has already happened.
    const record = server.store.loadGames().find((g) => g.code === host.code);
    expect(record?.state?.players[host.playerId]?.credits).toBe(47);
    expect(record?.started).toBe(true);
    expect(record?.seats).toHaveLength(2);

    await closeAll(host.client, guest.client);
    await server.close();
  });

  it('falls back to atomic JSON persistence when asked, and round-trips a game', async () => {
    const first = await boot({ dataDir, storeKind: 'json' });
    expect(first.store.kind).toBe('json');

    const host = await createGame(first, 'Ada');
    const guest = await joinGame(first, host.code, 'Grace');
    guest.client.send({ t: 'setReady', ready: true });
    await host.client.waitLobby((l) => l.players.every((p) => p.ready || p.isHost));
    host.client.send({ t: 'startGame' });
    await host.client.wait('state');
    const guestToken = guest.sessionToken;
    await closeAll(host.client, guest.client);
    await first.close();

    expect(fs.existsSync(path.join(dataDir, 'test.json'))).toBe(true);

    const second = await boot({ dataDir, storeKind: 'json' });
    try {
      const back = await TestClient.connect(second.wsUrl);
      back.send({ t: 'rejoin', sessionToken: guestToken });
      expect((await back.wait('welcome')).playerId).toBe(guest.playerId);
      const state = await back.wait('state');
      expect(state.state.code).toBe(host.code);
      await back.close();
    } finally {
      await second.close();
    }
  });
});
