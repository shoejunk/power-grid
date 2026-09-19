import { expect, it } from 'vitest';
import { GameRegistry, erase } from '@tt/core';
import { powerGrid, type GameState } from '@game/power-grid';
import { boot, closeAll, createGame, joinGame, makeDataDir, removeDataDir } from './helpers.js';
import { TestClient } from './testClient.js';

it('lets the host watch an all-bot game, blocks human moves, and preserves spectator control on resume', async () => {
  const dataDir = makeDataDir();
  const options = { dataDir, registry: new GameRegistry([erase(powerGrid)]), botDelayMs: 5 };
  let server = await boot(options);
  const host = await createGame(server, 'Watcher', { playerCount: 2 }, 'power-grid');
  let resumed: TestClient | undefined;
  try {
    host.client.send({ t: 'setHostController', controller: 'jev' });
    expect((await host.client.wait('error')).code).toBe('jevUnavailable');
    host.client.send({ t: 'setHostController', controller: 'standard' });
    await host.client.waitLobby(l => l.players[0]!.isBot);
    host.client.send({ t: 'setHostController', controller: 'human' });
    await host.client.waitLobby(l => !l.players[0]!.isBot);
    host.client.send({ t: 'setHostController', controller: 'standard' });
    await host.client.waitLobby(l => l.players[0]!.isBot);
    host.client.send({ t: 'addBot' });
    await host.client.waitLobby(l => l.players.length === 2 && l.players.every(p => p.isBot));
    host.client.send({ t: 'startGame' });
    await host.client.waitState<GameState>(s => s.round >= 2, 15000);
    host.client.send({ t: 'action', action: { type: 'passBuilding' } });
    expect((await host.client.wait('actionRejected')).reason).toContain('watching');
    host.client.send({ t: 'setHostController', controller: 'human' });
    expect((await host.client.wait('error')).code).toBe('gameStarted');
    await closeAll(host.client);
    await server.close();
    server = await boot(options);
    expect(server.hub.roomByCode(host.code)!.seats.every(s => s.isBot)).toBe(true);
    resumed = await TestClient.connect(server.wsUrl);
    resumed.send({ t: 'rejoin', sessionToken: host.sessionToken });
    await resumed.wait('welcome');
    await resumed.waitLobby(l => l.hostId === host.playerId && l.players.every(p => p.isBot));
    await resumed.waitState<GameState>(s => s.phase === 'gameOver', 30000);
  } finally {
    await closeAll(host.client, ...(resumed ? [resumed] : []));
    await server.close();
    removeDataDir(dataDir);
  }
}, 45000);

it('does not let guests change the host controller', async () => {
  const dataDir = makeDataDir();
  const server = await boot({ dataDir, registry: new GameRegistry([erase(powerGrid)]) });
  const host = await createGame(server, 'Host', { playerCount: 2 }, 'power-grid');
  const guest = await joinGame(server, host.code, 'Guest');
  try {
    guest.client.send({ t: 'setHostController', controller: 'standard' });
    expect((await guest.client.wait('error')).code).toBe('notHost');
  } finally {
    await closeAll(host.client, guest.client);
    await server.close();
    removeDataDir(dataDir);
  }
});
