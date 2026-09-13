import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryGameStore } from '../persistence/memoryStore.js';
import { SqliteGameStore } from '../persistence/sqliteStore.js';
import type { AccountRecord, AuthSessionRecord } from '../persistence/types.js';
import { boot, closeAll, makeDataDir, removeDataDir } from './helpers.js';
import { TestClient } from './testClient.js';

const AUTH_TOKEN = 'auth-cookie-for-test';
const ACCOUNT: AccountRecord = {
  accountId: 'google-sub-ada',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  createdAt: 10,
  lastSeen: 10,
};
const AUTH_SESSION: AuthSessionRecord = {
  token: AUTH_TOKEN,
  accountId: ACCOUNT.accountId,
  createdAt: 10,
  lastSeen: 10,
  expiresAt: Date.now() + 60_000,
};

const cookieOptions = { headers: { Cookie: `tt.auth=${AUTH_TOKEN}` } };

describe('Google account game identity', () => {
  const servers: { close(): Promise<void> }[] = [];
  const dataDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
    for (const dir of dataDirs.splice(0)) removeDataDir(dir);
  });

  it('requires Google authentication when configured', async () => {
    const server = await boot({
      googleClientId: 'client-id',
      googleClientSecret: 'client-secret',
      googleAuthRequired: true,
    });
    servers.push(server);

    const start = await fetch(`${server.url}/auth/google/start`, { redirect: 'manual' });
    expect(start.status).toBe(302);
    expect(start.headers.get('location')).toMatch(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/);
    expect(start.headers.get('set-cookie')).toMatch(/tt\.googleState=.*HttpOnly/);

    const client = await TestClient.connect(server.wsUrl);
    client.send({ t: 'createGame', gameKey: 'stub', name: 'Ada', settings: {} });
    expect(await client.wait('error')).toMatchObject({ code: 'authRequired' });
    await client.close();
  });

  it('lists saved games on a new machine and resumes only the selected one', async () => {
    const dataDir = makeDataDir();
    dataDirs.push(dataDir);
    const seedStore = new SqliteGameStore(path.join(dataDir, 'test.db'));
    seedStore.saveAccount(ACCOUNT);
    seedStore.saveAuthSession(AUTH_SESSION);
    seedStore.close();

    const server = await boot({
      dataDir,
      googleClientId: 'client-id',
      googleClientSecret: 'client-secret',
      googleAuthRequired: true,
    });
    servers.push(server);

    const firstMachine = await TestClient.connect(server.wsUrl, cookieOptions);
    firstMachine.send({
      t: 'createGame',
      gameKey: 'stub',
      name: 'Ada',
      settings: { tableSize: 2 },
    });
    const created = await firstMachine.wait('welcome');
    const lobby = await firstMachine.wait('lobby');
    expect(created.accountId).toBe(ACCOUNT.accountId);
    expect(server.store.loadSessions()).toEqual([
      expect.objectContaining({ accountId: ACCOUNT.accountId, playerId: created.playerId }),
    ]);

    // A signed-in browser lands on its game list rather than being forced into
    // whichever table happened to update most recently.
    await server.close();
    const restarted = await boot({
      dataDir,
      googleClientId: 'client-id',
      googleClientSecret: 'client-secret',
      googleAuthRequired: true,
    });
    servers.push(restarted);
    const thirdMachine = await TestClient.connect(restarted.wsUrl, cookieOptions);
    thirdMachine.send({ t: 'hello' });
    expect((await thirdMachine.wait('error')).code).toBe('noSession');

    const me = await fetch(`${restarted.url}/api/auth/me`, {
      headers: { Cookie: `tt.auth=${AUTH_TOKEN}` },
    });
    expect(await me.json()).toMatchObject({
      configured: true,
      authenticated: true,
      account: { id: ACCOUNT.accountId, email: ACCOUNT.email },
      games: [{ gameId: lobby.lobby.gameId, playerName: 'Ada' }],
    });

    thirdMachine.send({ t: 'resumeGame', gameId: lobby.lobby.gameId });
    const resumed = await thirdMachine.wait('welcome');
    expect(resumed.playerId).toBe(created.playerId);
    expect(resumed.accountId).toBe(ACCOUNT.accountId);
    expect((await thirdMachine.wait('lobby')).lobby.gameId).toBe(lobby.lobby.gameId);

    await closeAll(firstMachine, thirdMachine);
  });

  it('does not let one account resume another account\'s seat', async () => {
    const store = new MemoryGameStore();
    store.saveAccount(ACCOUNT);
    store.saveAuthSession(AUTH_SESSION);
    store.saveAccount({ ...ACCOUNT, accountId: 'google-sub-grace', email: 'grace@example.com', name: 'Grace' });
    store.saveAuthSession({
      ...AUTH_SESSION,
      token: 'grace-auth-cookie',
      accountId: 'google-sub-grace',
    });
    const server = await boot({
      store,
      googleClientId: 'client-id',
      googleClientSecret: 'client-secret',
      googleAuthRequired: true,
    });
    servers.push(server);

    const ada = await TestClient.connect(server.wsUrl, cookieOptions);
    ada.send({ t: 'createGame', gameKey: 'stub', name: 'Ada', settings: { tableSize: 2 } });
    const created = await ada.wait('welcome');
    await ada.wait('lobby');
    expect(created.accountId).toBe(ACCOUNT.accountId);

    const grace = await TestClient.connect(server.wsUrl, {
      headers: { Cookie: 'tt.auth=grace-auth-cookie' },
    });
    grace.send({ t: 'hello' });
    expect((await grace.wait('error')).code).toBe('noSession');
    await closeAll(ada, grace);
  });

  it('keeps one account seated in multiple games and lets it switch from the game list', async () => {
    const store = new MemoryGameStore();
    store.saveAccount(ACCOUNT);
    store.saveAuthSession(AUTH_SESSION);
    const server = await boot({
      store,
      googleClientId: 'client-id',
      googleClientSecret: 'client-secret',
      googleAuthRequired: true,
    });
    servers.push(server);

    const ada = await TestClient.connect(server.wsUrl, cookieOptions);
    ada.send({ t: 'createGame', gameKey: 'stub', name: 'Ada', settings: { tableSize: 2 } });
    const firstWelcome = await ada.wait('welcome');
    const firstLobby = await ada.wait('lobby');

    ada.send({ t: 'createGame', gameKey: 'stub', name: 'Ada', settings: { tableSize: 2 } });
    const secondWelcome = await ada.wait('welcome');
    const secondLobby = await ada.wait('lobby');

    expect(secondLobby.lobby.gameId).not.toBe(firstLobby.lobby.gameId);
    expect(server.hub.roomById(firstLobby.lobby.gameId)?.seat(firstWelcome.playerId)).toBeDefined();
    expect(server.hub.roomById(firstLobby.lobby.gameId)?.isConnected(firstWelcome.playerId)).toBe(false);
    expect(server.hub.roomById(secondLobby.lobby.gameId)?.isConnected(secondWelcome.playerId)).toBe(true);

    const me = await fetch(`${server.url}/api/auth/me`, cookieOptions);
    const payload = (await me.json()) as { games: Array<{ gameId: string }> };
    expect(payload.games.map((game) => game.gameId).sort()).toEqual(
      [firstLobby.lobby.gameId, secondLobby.lobby.gameId].sort(),
    );

    ada.send({ t: 'viewGames' });
    expect(await ada.wait('viewingGames')).toMatchObject({
      gameId: secondLobby.lobby.gameId,
      quit: false,
    });

    ada.send({ t: 'resumeGame', gameId: firstLobby.lobby.gameId });
    expect((await ada.wait('welcome')).playerId).toBe(firstWelcome.playerId);
    expect((await ada.wait('lobby')).lobby.gameId).toBe(firstLobby.lobby.gameId);

    await closeAll(ada);
  });
});
