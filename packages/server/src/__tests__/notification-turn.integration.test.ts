import { describe, expect, it } from 'vitest';
import type { RunningServer } from '../server.js';
import { boot, closeAll, createGame, joinGame, makeDataDir, removeDataDir } from './helpers.js';
import type { TestClient } from './testClient.js';

describe('turn alert integration', () => {
  it('rejects alert subscriptions and does not deliver turn notifications', async () => {
    const dataDir = makeDataDir();
    let server: RunningServer | undefined;
    const clients: TestClient[] = [];
    const delivered: Array<{ endpoint: string; payload: string; persistedActivePlayerId?: string }> = [];
    let gameId = '';
    try {
      server = await boot({
        dataDir,
        vapidPublicKey: 'test-public-key',
        vapidPrivateKey: 'test-private-key',
        vapidSubject: 'mailto:tests@example.invalid',
        notificationAdapters: {
          sendPush: async (subscription, payload) => {
            const persisted = server?.store.loadGames().find((game) => game.gameId === gameId);
            delivered.push({
              endpoint: subscription.endpoint,
              payload,
              ...(persisted?.state && typeof persisted.state === 'object' &&
                typeof (persisted.state as { activePlayerId?: unknown }).activePlayerId === 'string'
                ? { persistedActivePlayerId: (persisted.state as { activePlayerId: string }).activePlayerId }
                : {}),
            });
          },
        },
      });
      const host = await createGame(server, 'Ada', { tableSize: 2 });
      clients.push(host.client);
      gameId = host.lobby.gameId;
      const guest = await joinGame(server, host.code, 'Grace');
      clients.push(guest.client);

      for (const player of [host, guest]) {
        const response = await fetch(`${server.url}/api/notifications/push/subscribe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionToken: player.sessionToken,
            subscription: {
              endpoint: `https://push.example.test/${player.playerId}`,
              keys: { p256dh: 'A'.repeat(32), auth: 'B'.repeat(16) },
            },
          }),
        });
        expect(response.status).toBe(410);
      }

      guest.client.send({ t: 'setReady', ready: true });
      await host.client.waitWhere((message) => message.t === 'lobby' && message.lobby.players.every((player) => player.ready || player.isHost));
      host.client.clear();
      guest.client.clear();
      host.client.send({ t: 'startGame' });
      const [hostStart, guestStart] = await Promise.all([host.client.waitAnyState(), guest.client.waitAnyState()]);
      const firstPlayer = hostStart.state.activePlayerId;
      expect(guestStart.state.activePlayerId).toBe(firstPlayer);
      expect(delivered).toEqual([]);

      host.client.clear();
      guest.client.clear();
      const activeClient = firstPlayer === host.playerId ? host.client : guest.client;
      activeClient.send({ t: 'action', action: { type: 'pass' } });
      const [hostNext, guestNext] = await Promise.all([host.client.waitAnyState(), guest.client.waitAnyState()]);
      const nextPlayer = hostNext.state.activePlayerId;
      expect(nextPlayer).not.toBe(firstPlayer);
      expect(guestNext.state.activePlayerId).toBe(nextPlayer);
      expect(delivered).toEqual([]);
    } finally {
      await closeAll(...clients);
      await server?.close();
      removeDataDir(dataDir);
    }
  });
});
