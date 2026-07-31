/**
 * Integration tests. Every one of these boots the real HTTP + WebSocket server
 * on an ephemeral port with a real on-disk SQLite database and drives it with
 * real `ws` clients. Nothing is mocked except the rules engine, which is
 * injected so the tests assert *server* behaviour rather than Power Grid rules.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RunningServer } from '../server.js';
import { boot, closeAll, createGame, joinGame, makeDataDir, normaliseState, removeDataDir } from './helpers.js';
import { TestClient } from './testClient.js';

describe('Power Grid multiplayer server', () => {
  let dataDir: string;
  let server: RunningServer;
  const openClients: TestClient[] = [];

  const track = <T extends { client: TestClient }>(seated: T): T => {
    openClients.push(seated.client);
    return seated;
  };

  beforeEach(async () => {
    dataDir = makeDataDir();
    server = await boot({ dataDir });
  });

  afterEach(async () => {
    await closeAll(...openClients.splice(0));
    await server.close();
    removeDataDir(dataDir);
  });

  /* ================================================================ *
   * 1. Create → join by code → lobby broadcast → start
   * ================================================================ */

  describe('lobby lifecycle', () => {
    it('creates a game, mints a 6-character code, and seats the host', async () => {
      const host = track(await createGame(server, 'Ada'));

      expect(host.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
      expect(host.sessionToken).toBeTruthy();
      expect(host.lobby.started).toBe(false);
      expect(host.lobby.hostId).toBe(host.playerId);
      expect(host.lobby.players).toHaveLength(1);
      expect(host.lobby.players[0]).toMatchObject({ name: 'Ada', isHost: true, connected: true });
    });

    it('lets a second player join by code and broadcasts the lobby to everyone', async () => {
      const host = track(await createGame(server, 'Ada'));
      host.client.clear();

      const guest = track(await joinGame(server, host.code, 'Grace'));

      // The host learns about the new arrival without asking.
      const broadcast = await host.client.waitLobby((l) => l.players.length === 2);
      expect(broadcast.lobby.players.map((p) => p.name)).toEqual(['Ada', 'Grace']);
      // Requirement 3: colours are unique.
      const colors = broadcast.lobby.players.map((p) => p.color);
      expect(new Set(colors).size).toBe(colors.length);
      expect(guest.playerId).not.toBe(host.playerId);
    });

    it('accepts the join code case-insensitively', async () => {
      const host = track(await createGame(server, 'Ada'));
      const guest = track(await joinGame(server, host.code.toLowerCase(), 'Grace'));
      expect(guest.playerId).toBeTruthy();
    });

    it('rejects an unknown code, a full table, and a game already started', async () => {
      const host = track(await createGame(server, 'Ada', { playerCount: 2 }));

      const stranger = await TestClient.connect(server.wsUrl);
      openClients.push(stranger);
      stranger.send({ t: 'joinGame', code: 'ZZZZZZ', name: 'Nobody' });
      expect((await stranger.wait('error')).code).toBe('noSuchGame');

      track(await joinGame(server, host.code, 'Grace')); // table now 2/2
      stranger.clear();
      stranger.send({ t: 'joinGame', code: host.code, name: 'Late' });
      expect((await stranger.wait('error')).code).toBe('gameFull');
    });

    it('enforces host-only settings, ready flags, bots and kicking', async () => {
      const host = track(await createGame(server, 'Ada'));
      const guest = track(await joinGame(server, host.code, 'Grace'));

      // A non-host cannot change settings.
      guest.client.clear();
      guest.client.send({ t: 'updateSettings', settings: { mapId: 'usa' } });
      expect((await guest.client.wait('error')).code).toBe('notHost');

      // The host can.
      host.client.clear();
      host.client.send({ t: 'updateSettings', settings: { mapId: 'usa', experiencedStart: true } });
      const settingsLobby = await host.client.waitLobby((l) => l.settings.mapId === 'usa');
      expect(settingsLobby.lobby.settings.experiencedStart).toBe(true);

      // Ready flags propagate.
      host.client.clear();
      guest.client.send({ t: 'setReady', ready: true });
      const readyLobby = await host.client.waitLobby((l) =>
        l.players.some((p) => p.id === guest.playerId && p.ready),
      );
      expect(readyLobby.lobby.players.find((p) => p.id === guest.playerId)?.ready).toBe(true);

      // Host adds a bot.
      host.client.clear();
      host.client.send({ t: 'addBot' });
      const botLobby = await host.client.waitLobby((l) => l.players.some((p) => p.isBot));
      expect(botLobby.lobby.players.filter((p) => p.isBot)).toHaveLength(1);

      // Host kicks the guest.
      host.client.clear();
      host.client.send({ t: 'removePlayer', playerId: guest.playerId });
      const kickedLobby = await host.client.waitLobby((l) => !l.players.some((p) => p.id === guest.playerId));
      expect(kickedLobby.lobby.players.map((p) => p.name)).toEqual(['Ada', 'Bot 1']);
      expect((await guest.client.wait('error')).code).toBe('kicked');
    });

    it('refuses to start until everyone is ready, then starts and broadcasts state', async () => {
      const host = track(await createGame(server, 'Ada'));
      const guest = track(await joinGame(server, host.code, 'Grace'));

      host.client.clear();
      host.client.send({ t: 'startGame' });
      expect((await host.client.wait('error')).code).toBe('notReady');

      guest.client.send({ t: 'setReady', ready: true });
      await host.client.waitLobby((l) => l.players.every((p) => p.ready || p.isHost));

      host.client.clear();
      guest.client.clear();
      host.client.send({ t: 'startGame' });

      const hostState = await host.client.wait('state');
      const guestState = await guest.client.wait('state');
      expect(hostState.state.code).toBe(host.code);
      expect(hostState.state.playerOrder).toHaveLength(2);
      expect(guestState.state.activePlayerId).toBe(hostState.state.activePlayerId);
      expect(Object.keys(hostState.state.players)).toContain(guest.playerId);

      // A non-host cannot start...
      guest.client.clear();
      guest.client.send({ t: 'startGame' });
      expect((await guest.client.wait('error')).code).toBe('notHost');

      // ...and even the host cannot start twice.
      host.client.clear();
      host.client.send({ t: 'startGame' });
      expect((await host.client.wait('error')).code).toBe('gameStarted');
    });

    it('never gives two players the same colour, and rejects a taken colour', async () => {
      const host = track(await createGame(server, 'Ada'));
      const guest = track(await joinGame(server, host.code, 'Grace'));

      const hostColor = host.lobby.players[0]?.color;
      guest.client.clear();
      guest.client.send({ t: 'setColor', color: hostColor });
      expect((await guest.client.wait('error')).code).toBe('colorTaken');

      guest.client.clear();
      guest.client.send({ t: 'setColor', color: 'purple' });
      const lobby = await guest.client.waitLobby((l) =>
        l.players.some((p) => p.id === guest.playerId && p.color === 'purple'),
      );
      expect(lobby.lobby.players.find((p) => p.id === guest.playerId)?.color).toBe('purple');
    });

    it('mints unique join codes across many games', async () => {
      const codes = new Set<string>();
      for (let i = 0; i < 25; i++) {
        const g = track(await createGame(server, `Host ${i}`));
        codes.add(g.code);
      }
      expect(codes.size).toBe(25);
    });
  });

  /* ================================================================ *
   * 2. Authority — out-of-turn and illegal actions
   * ================================================================ */

  describe('server authority', () => {
    async function startedGame() {
      const host = track(await createGame(server, 'Ada'));
      const guest = track(await joinGame(server, host.code, 'Grace'));
      guest.client.send({ t: 'setReady', ready: true });
      await host.client.waitLobby((l) => l.players.every((p) => p.ready || p.isHost));
      host.client.clear();
      guest.client.clear();
      host.client.send({ t: 'startGame' });
      const state = (await host.client.wait('state')).state;
      await guest.client.wait('state');
      return { host, guest, state };
    }

    it('rejects an action from a player when it is not their turn', async () => {
      const { host, guest, state } = await startedGame();
      // The stub engine seats the host first.
      expect(state.activePlayerId).toBe(host.playerId);

      guest.client.clear();
      guest.client.send({ t: 'action', action: { type: 'passNomination' }, nonce: 'n-42' });

      const rejected = await guest.client.wait('actionRejected');
      expect(rejected.nonce).toBe('n-42');
      expect(rejected.reason).toMatch(/not your turn/i);
    });

    it('rejects an action that the engine says is illegal, with the engine reason', async () => {
      const { host } = await startedGame();
      host.client.clear();
      // Plant 99 is not in the market.
      host.client.send({ t: 'action', action: { type: 'nominatePlant', plantId: 99, bid: 99 }, nonce: 'n-1' });
      const rejected = await host.client.wait('actionRejected');
      expect(rejected.nonce).toBe('n-1');
      expect(rejected.reason).toMatch(/not in the current market/i);
    });

    it('rejects actions from a socket that is not in any game', async () => {
      const stranger = await TestClient.connect(server.wsUrl);
      openClients.push(stranger);
      stranger.send({ t: 'action', action: { type: 'passNomination' } });
      expect((await stranger.wait('error')).code).toBe('notInGame');
    });

    it('applies a legal action and broadcasts the new state to every seat', async () => {
      const { host, guest } = await startedGame();
      host.client.clear();
      guest.client.clear();
      host.client.send({ t: 'action', action: { type: 'nominatePlant', plantId: 4, bid: 4 } });

      const hostState = await host.client.waitState((s) => s.activePlayerId === guest.playerId);
      const guestState = await guest.client.waitState((s) => s.activePlayerId === guest.playerId);
      expect(hostState.state.players[host.playerId]?.money).toBe(46);
      expect(guestState.state.players[host.playerId]?.plants).toHaveLength(1);
    });

    it('redacts the face-down plant stack before broadcasting', async () => {
      const { host } = await startedGame();
      const state = host.client.received.find((m) => m.t === 'state');
      expect(state).toBeDefined();
      if (state?.t !== 'state') throw new Error('unreachable');
      // Length is public; identities are not.
      expect(state.state.plantMarket.stack.length).toBe(5);
      expect(state.state.plantMarket.stack.every((id) => id === -1)).toBe(true);
      // The server's own copy still knows the real cards.
      const room = server.hub.roomByCode(host.code);
      expect(room?.state?.plantMarket.stack).toEqual([20, 21, 22, 23, 24]);
    });

    it('relays chat to every seated player', async () => {
      const { host, guest } = await startedGame();
      guest.client.clear();
      host.client.send({ t: 'chat', text: 'good luck' });
      const chat = await guest.client.wait('chat');
      expect(chat).toMatchObject({ from: host.playerId, name: 'Ada', text: 'good luck' });
    });
  });

  /* ================================================================ *
   * 3. Reconnection
   * ================================================================ */

  describe('reconnection', () => {
    it('restores a player mid-game — mid-turn — to an identical state', async () => {
      const host = track(await createGame(server, 'Ada'));
      const guest = track(await joinGame(server, host.code, 'Grace'));
      guest.client.send({ t: 'setReady', ready: true });
      await host.client.waitLobby((l) => l.players.every((p) => p.ready || p.isHost));
      host.client.send({ t: 'startGame' });
      await host.client.wait('state');
      await guest.client.wait('state');

      // Host acts, so it becomes the guest's turn and the state is non-trivial.
      host.client.send({ t: 'action', action: { type: 'nominatePlant', plantId: 5, bid: 7 } });
      const before = (await guest.client.waitState((s) => s.activePlayerId === guest.playerId)).state;
      expect(before.players[host.playerId]?.money).toBe(43);

      // Tab crash: no close frame, just a dead socket, while it is their turn.
      guest.client.kill();
      await host.client.waitLobby((l) => l.players.some((p) => p.id === guest.playerId && !p.connected));

      // …and they come back with their session token.
      const resumed = await TestClient.connect(server.wsUrl);
      openClients.push(resumed);
      resumed.send({ t: 'rejoin', sessionToken: guest.sessionToken });

      const welcome = await resumed.wait('welcome');
      expect(welcome.playerId).toBe(guest.playerId);
      expect(welcome.sessionToken).toBe(guest.sessionToken);

      const after = (await resumed.wait('state')).state;
      expect(normaliseState(after)).toEqual(normaliseState(before));
      expect(after.activePlayerId).toBe(guest.playerId);

      // And they can act immediately — the seat never lost the turn.
      resumed.clear();
      resumed.send({ t: 'action', action: { type: 'passNomination' } });
      const acted = await resumed.waitState((s) => s.activePlayerId === host.playerId);
      expect(acted.state.round).toBe(2);
    });

    it('keeps the seat, money and plants of a player who disconnects', async () => {
      const host = track(await createGame(server, 'Ada'));
      const guest = track(await joinGame(server, host.code, 'Grace'));
      guest.client.send({ t: 'setReady', ready: true });
      await host.client.waitLobby((l) => l.players.every((p) => p.ready || p.isHost));
      host.client.send({ t: 'startGame' });
      await host.client.wait('state');
      await guest.client.wait('state');
      host.client.send({ t: 'action', action: { type: 'nominatePlant', plantId: 3, bid: 3 } });
      await guest.client.waitState((s) => s.activePlayerId === guest.playerId);

      await guest.client.close();
      const lobby = await host.client.waitLobby((l) =>
        l.players.some((p) => p.id === guest.playerId && !p.connected),
      );
      // Requirement 5: never removed, only marked offline.
      expect(lobby.lobby.players).toHaveLength(2);

      const room = server.hub.roomByCode(host.code);
      expect(room?.seat(guest.playerId)).toBeDefined();
      expect(room?.state?.players[host.playerId]?.money).toBe(47);
      expect(room?.state?.activePlayerId).toBe(guest.playerId);
    });

    it('resumes a lobby (not yet started) from a session token', async () => {
      const host = track(await createGame(server, 'Ada'));
      track(await joinGame(server, host.code, 'Grace'));

      host.client.kill();
      const resumed = await TestClient.connect(server.wsUrl);
      openClients.push(resumed);
      resumed.send({ t: 'hello', sessionToken: host.sessionToken });

      const welcome = await resumed.wait('welcome');
      expect(welcome.playerId).toBe(host.playerId);
      const lobby = await resumed.wait('lobby');
      expect(lobby.lobby.players).toHaveLength(2);
      expect(lobby.lobby.started).toBe(false);
    });

    it('reports no session for an unknown or absent token', async () => {
      const fresh = await TestClient.connect(server.wsUrl);
      openClients.push(fresh);
      fresh.send({ t: 'hello' });
      expect((await fresh.wait('error')).code).toBe('noSession');

      fresh.clear();
      fresh.send({ t: 'rejoin', sessionToken: 'not-a-real-token' });
      expect((await fresh.wait('error')).code).toBe('unknownSession');
    });

    it('lets a rejoin take over the seat from a stale socket', async () => {
      const host = track(await createGame(server, 'Ada'));
      const second = await TestClient.connect(server.wsUrl);
      openClients.push(second);
      second.send({ t: 'rejoin', sessionToken: host.sessionToken });
      await second.wait('welcome');
      // The original socket is closed by the server, not left fighting for the seat.
      await expect(host.client.wait('lobby', 1500)).rejects.toThrow();
    });

    it('refuses a brand-new join to a started game but still allows rejoin by token', async () => {
      const host = track(await createGame(server, 'Ada'));
      const guest = track(await joinGame(server, host.code, 'Grace'));
      guest.client.send({ t: 'setReady', ready: true });
      await host.client.waitLobby((l) => l.players.every((p) => p.ready || p.isHost));
      host.client.send({ t: 'startGame' });
      await guest.client.wait('state');

      const late = await TestClient.connect(server.wsUrl);
      openClients.push(late);
      late.send({ t: 'joinGame', code: host.code, name: 'Late' });
      expect((await late.wait('error')).code).toBe('gameStarted');

      guest.client.kill();
      const back = await TestClient.connect(server.wsUrl);
      openClients.push(back);
      back.send({ t: 'rejoin', sessionToken: guest.sessionToken });
      expect((await back.wait('welcome')).playerId).toBe(guest.playerId);
    });
  });

  /* ================================================================ *
   * 4. Host promotion
   * ================================================================ */

  describe('host promotion', () => {
    it('promotes the longest-seated connected player when the host disconnects', async () => {
      const host = track(await createGame(server, 'Ada'));
      const first = track(await joinGame(server, host.code, 'Grace'));
      const second = track(await joinGame(server, host.code, 'Linus'));

      first.client.clear();
      second.client.clear();
      host.client.kill();

      const lobby = await first.client.waitLobby((l) => l.hostId !== host.playerId);
      expect(lobby.lobby.hostId).toBe(first.playerId);
      expect(lobby.lobby.players.find((p) => p.id === first.playerId)?.isHost).toBe(true);

      // The new host really has host powers.
      first.client.clear();
      first.client.send({ t: 'updateSettings', settings: { mapId: 'usa' } });
      const updated = await first.client.waitLobby((l) => l.settings.mapId === 'usa');
      expect(updated.lobby.hostId).toBe(first.playerId);
    });

    it('promotes on an explicit leaveGame and frees the seat in a lobby', async () => {
      const host = track(await createGame(server, 'Ada'));
      const guest = track(await joinGame(server, host.code, 'Grace'));

      guest.client.clear();
      host.client.send({ t: 'leaveGame' });

      const lobby = await guest.client.waitLobby((l) => l.players.length === 1);
      expect(lobby.lobby.hostId).toBe(guest.playerId);
      expect(lobby.lobby.players[0]?.name).toBe('Grace');
    });

    it('keeps a game in progress alive and promotes when the host leaves mid-game', async () => {
      const host = track(await createGame(server, 'Ada'));
      const guest = track(await joinGame(server, host.code, 'Grace'));
      guest.client.send({ t: 'setReady', ready: true });
      await host.client.waitLobby((l) => l.players.every((p) => p.ready || p.isHost));
      host.client.send({ t: 'startGame' });
      await guest.client.wait('state');

      guest.client.clear();
      host.client.kill();

      const lobby = await guest.client.waitLobby((l) => l.hostId === guest.playerId);
      // The departed host keeps their seat — requirement 5 beats host churn.
      expect(lobby.lobby.players).toHaveLength(2);
      expect(lobby.lobby.players.find((p) => p.id === host.playerId)?.connected).toBe(false);
      expect(server.hub.roomByCode(host.code)?.state?.players[host.playerId]).toBeDefined();
    });
  });

  /* ================================================================ *
   * 5. Disconnected-player turn timer
   * ================================================================ */

  describe('disconnected turn timer', () => {
    it('plays a safe default move for a disconnected player, but never for a connected one', async () => {
      const fastDir = makeDataDir();
      const fast = await boot({ dataDir: fastDir, turnTimeoutMs: 150 });
      try {
        const host = await createGame(fast, 'Ada');
        const guest = await joinGame(fast, host.code, 'Grace');
        guest.client.send({ t: 'setReady', ready: true });
        await host.client.waitLobby((l) => l.players.every((p) => p.ready || p.isHost));
        host.client.send({ t: 'startGame' });
        await host.client.wait('state');
        await guest.client.wait('state');

        // It is the host's turn and the host is connected: nothing should happen.
        await new Promise((r) => setTimeout(r, 400));
        expect(fast.hub.roomByCode(host.code)?.state?.activePlayerId).toBe(host.playerId);

        // Now the host vanishes on their own turn.
        host.client.kill();
        const moved = await guest.client.waitState((s) => s.activePlayerId === guest.playerId, 3000);
        expect(moved.state.players[host.playerId]?.phaseStatus).toBe('passed');

        await closeAll(host.client, guest.client);
      } finally {
        await fast.close();
        removeDataDir(fastDir);
      }
    });
  });

  /* ================================================================ *
   * 6. Robustness
   * ================================================================ */

  describe('robustness', () => {
    it('answers malformed frames with an error instead of dying', async () => {
      const c = await TestClient.connect(server.wsUrl);
      openClients.push(c);

      c.sendRaw('this is not json');
      expect((await c.wait('error')).code).toBe('badJson');

      c.clear();
      c.sendRaw('[1,2,3]');
      expect((await c.wait('error')).code).toBe('badMessage');

      c.clear();
      c.sendRaw(JSON.stringify({ t: 'nonsense' }));
      expect((await c.wait('error')).code).toBe('unknownMessage');

      c.clear();
      c.sendRaw(JSON.stringify({ t: 'action', action: { type: 'buildCity' } }));
      expect((await c.wait('error')).code).toBe('badAction');

      // Still alive and well.
      c.clear();
      c.send({ t: 'ping' });
      expect((await c.wait('pong')).t).toBe('pong');
    });

    it('serves a health endpoint and a join-code lookup', async () => {
      const host = track(await createGame(server, 'Ada'));

      const health = await (await fetch(`${server.url}/health`)).json();
      expect(health.ok).toBe(true);
      expect(health.persistence.backend).toBe('sqlite');
      expect(health.games).toBeGreaterThanOrEqual(1);

      const lookup = await (await fetch(`${server.url}/api/games/${host.code}`)).json();
      expect(lookup).toMatchObject({ ok: true, code: host.code, started: false, joinable: true });

      const missing = await fetch(`${server.url}/api/games/ZZZZZZ`);
      expect(missing.status).toBe(404);
    });

    it('drops an oversized frame without taking the server down', async () => {
      const small = await boot({ dataDir: makeDataDir(), maxPayloadBytes: 256 });
      try {
        const c = await TestClient.connect(small.wsUrl);
        c.sendRaw(JSON.stringify({ t: 'chat', text: 'x'.repeat(2000) }));
        await new Promise((r) => setTimeout(r, 200));
        // The socket is closed by `ws` for exceeding maxPayload; the server lives.
        const health = await (await fetch(`${small.url}/health`)).json();
        expect(health.ok).toBe(true);
        await c.close();
      } finally {
        await small.close();
      }
    });
  });
});
