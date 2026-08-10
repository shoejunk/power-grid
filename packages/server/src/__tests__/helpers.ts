/**
 * Shared harness for the integration tests: boots a real server on an
 * ephemeral port with a throwaway on-disk database, and tears it down.
 *
 * The registry injected here holds only the stub game, so the tests exercise
 * the server against a title it knows nothing about. That is the point — a
 * server that had grown knowledge of a shipping game would fail here.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { erase, GameRegistry, type LobbyState } from '@tt/core';
import { silentLogger } from '../logger.js';
import { startServer, type RunningServer, type StartServerOptions } from '../server.js';
import { STUB_GAME_KEY, stubGame, type StubState } from './stubGame.js';
import { TestClient } from './testClient.js';

export function makeDataDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tt-server-test-'));
}

export function removeDataDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows sometimes holds the file briefly; the OS will clean up /tmp. */
  }
}

export function stubRegistry(): GameRegistry {
  return new GameRegistry([erase(stubGame)]);
}

/** Boots the real server. Everything except the injected bits is production code. */
export function boot(overrides: StartServerOptions = {}): Promise<RunningServer> {
  return startServer({
    port: 0,
    host: '127.0.0.1',
    serveClient: false,
    storeKind: 'sqlite',
    dbFile: 'test.db',
    registry: stubRegistry(),
    logger: silentLogger,
    // Long enough that no test races the timers unless it opts in.
    heartbeatMs: 60_000,
    botDelayMs: 30,
    ...overrides,
  });
}

export interface SeatedClient {
  client: TestClient;
  playerId: string;
  sessionToken: string;
}

/** Connects, creates a game, and returns the host's seat plus the join code. */
export async function createGame(
  server: RunningServer,
  name = 'Host',
  settings: Record<string, unknown> = {},
  gameKey: string = STUB_GAME_KEY,
): Promise<SeatedClient & { code: string; lobby: LobbyState }> {
  const client = await TestClient.connect(server.wsUrl);
  client.send({
    t: 'createGame',
    gameKey,
    name,
    settings: { tableSize: 4, variant: 'plain', seed: 'TEST-SEED', ...settings },
  });
  const welcome = await client.wait('welcome');
  const lobby = await client.wait('lobby');
  return {
    client,
    playerId: welcome.playerId,
    sessionToken: welcome.sessionToken,
    code: lobby.lobby.code,
    lobby: lobby.lobby,
  };
}

/** Connects and joins an existing game by code. */
export async function joinGame(
  server: RunningServer,
  code: string,
  name: string,
): Promise<SeatedClient> {
  const client = await TestClient.connect(server.wsUrl);
  client.send({ t: 'joinGame', code, name });
  const welcome = await client.wait('welcome');
  await client.wait('lobby');
  return { client, playerId: welcome.playerId, sessionToken: welcome.sessionToken };
}

/**
 * Normalises the volatile presence fields so two snapshots taken at different
 * moments can be compared for genuine equality of *game* state.
 */
export function normaliseState(state: StubState): StubState {
  const copy = structuredClone(state);
  for (const player of Object.values(copy.players)) {
    player.lastSeen = 0;
    player.connected = false;
  }
  return copy;
}

export async function closeAll(...clients: (TestClient | undefined)[]): Promise<void> {
  await Promise.all(clients.map((c) => c?.close()));
}
