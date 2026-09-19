import { expect, it } from 'vitest';
import { boot, closeAll, createGame, joinGame, makeDataDir, removeDataDir } from './helpers.js';
import type { TestClient } from './testClient.js';
import type { StubState } from './stubGame.js';

it('reports current turns for saved seats as play advances, without joining the table', async () => {
  const dataDir = makeDataDir();
  const server = await boot({ dataDir });
  const clients: TestClient[] = [];
  try {
    const host = await createGame(server, 'Ada', { tableSize: 2 });
    const guest = await joinGame(server, host.code, 'Grace');
    clients.push(host.client, guest.client);
    const lookup = async (token: string) => {
      const response = await fetch(`${server.url}/api/games/code/${host.code}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(response.headers.get('cache-control')).toBe('no-store');
      return (await response.json()).isYourTurn;
    };
    expect(await lookup(host.sessionToken)).toBe(false);
    host.client.clear();
    guest.client.clear();
    host.client.send({ t: 'startGame' });
    let state = (await host.client.waitAnyState()).state;
    await guest.client.waitAnyState();
    const assertTurns = async () => {
      expect(await lookup(host.sessionToken)).toBe(state.activePlayerId === host.playerId);
      expect(await lookup(guest.sessionToken)).toBe(state.activePlayerId === guest.playerId);
      expect(await lookup('invalid-token')).toBe(false);
    };
    await assertTurns();
    const previous = state.activePlayerId;
    host.client.clear();
    guest.client.clear();
    (previous === host.playerId ? host.client : guest.client).send({ t: 'action', action: { type: 'pass' } });
    state = (await host.client.waitAnyState()).state;
    await guest.client.waitAnyState();
    expect(state.activePlayerId).not.toBe(previous);
    await assertTurns();
    expect(server.hub.isSessionTurn('another-game', host.sessionToken)).toBe(false);
    expect(server.hub.claimLegacySession(host.sessionToken, 'account-a')).toBe(true);
    expect(server.hub.gamesForAccount('account-a')[0]?.isYourTurn).toBe(state.activePlayerId === host.playerId);
    expect(await lookup(host.sessionToken)).toBe(false);
    const room = server.hub.roomById(host.lobby.gameId)!;
    // Even a terminal snapshot retaining its last active player has no turn.
    (room.state as StubState).phase = 'over';
    expect(await lookup(host.sessionToken)).toBe(false);
    expect(await lookup(guest.sessionToken)).toBe(false);
    expect(server.hub.gamesForAccount('account-a')[0]?.isYourTurn).toBe(false);
  } finally {
    await closeAll(...clients);
    await server.close();
    removeDataDir(dataDir);
  }
});
