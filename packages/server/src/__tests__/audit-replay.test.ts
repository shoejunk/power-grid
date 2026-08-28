/**
 * Generic server audit/replay boundary.
 *
 * This deliberately uses the real WebSocket server, SQLite store, and a game
 * plugin the server does not know anything about. The audit stream must be the
 * durable record of game moves, not a second interpretation of chat or socket
 * presence, and replay must rebuild the same authoritative game state.
 */

import { afterEach, describe, expect, it } from 'vitest';
import type { GameAuditEvent, PersistedGame } from '../persistence/types.js';
import { replayPersistedGame } from '../persistence/replay.js';
import type { RunningServer } from '../server.js';
import {
  boot,
  closeAll,
  createGame,
  joinGame,
  makeDataDir,
  normaliseState,
  removeDataDir,
} from './helpers.js';
import { TestClient } from './testClient.js';
import { stubGame, type StubState } from './stubGame.js';

const actionOne = { type: 'claim', itemId: 6, cost: 9 } as const;
const actionTwo = { type: 'pass' } as const;
const actionAfterRestart = { type: 'claim', itemId: 3, cost: 3 } as const;

function stateFrom(record: PersistedGame): StubState {
  if (record.state === null || record.state === undefined) {
    throw new Error('expected a started table with persisted state');
  }
  return record.state as StubState;
}

function expectTimestampInWindow(at: number, lowerBound: number, upperBound: number): void {
  expect(at).toBeGreaterThanOrEqual(lowerBound);
  expect(at).toBeLessThanOrEqual(upperBound);
}

describe('generic server audit and replay boundary', () => {
  let dataDir: string | undefined;

  afterEach(() => {
    if (dataDir) removeDataDir(dataDir);
    dataDir = undefined;
  });

  it('persists only game events, replays them, and survives a SQLite restart', async () => {
    dataDir = makeDataDir();
    let first: RunningServer | undefined;
    let second: RunningServer | undefined;
    const clients: TestClient[] = [];

    try {
      first = await boot({ dataDir });
      expect(first.store.kind).toBe('sqlite');

      const host = await createGame(first, 'Ada');
      clients.push(host.client);
      const guest = await joinGame(first, host.code, 'Grace');
      clients.push(guest.client);

      guest.client.send({ t: 'setReady', ready: true });
      await host.client.waitLobby((lobby) => lobby.players.every((p) => p.ready || p.isHost));

      host.client.clear();
      guest.client.clear();
      const startBefore = Date.now();
      host.client.send({ t: 'startGame' });
      await host.client.wait('state');
      await guest.client.wait('state');
      const startAfter = Date.now();

      const startedRecord = first.store.loadGames().find((game) => game.code === host.code);
      expect(startedRecord).toBeDefined();
      const gameId = startedRecord!.gameId;
      let events = first.store.loadAuditEvents(gameId);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        sequence: 1,
        type: 'start',
        hostId: host.playerId,
        settings: startedRecord!.settings,
        seats: startedRecord!.seats,
      });
      expect(events[0]?.type).toBe('start');
      if (events[0]?.type === 'start') {
        expectTimestampInWindow(events[0].at, startBefore, startAfter);
      }

      const actionOneBefore = Date.now();
      host.client.clear();
      guest.client.clear();
      host.client.send({ t: 'action', action: actionOne });
      await guest.client.waitState((state) => state.activePlayerId === guest.playerId);
      const actionOneAfter = Date.now();

      // Chat is persisted separately, but is not part of the game event log.
      host.client.send({ t: 'chat', text: 'audit boundary check' });
      await guest.client.waitWhere(
        (message) => message.t === 'chat' && message.text === 'audit boundary check',
        4000,
        'chat',
      );
      events = first.store.loadAuditEvents(gameId);
      expect(events).toHaveLength(3);
      expect(events.map((event) => event.type)).toEqual(['start', 'action', 'automatic']);
      expect(events[2]).toMatchObject({
        sequence: 3,
        actor: 'system',
        trigger: 'action-settled',
        publicExplanation: expect.any(String),
      });

      // An actual detach/reattach changes presence and must not add a replay event.
      await guest.client.close();
      await host.client.waitLobby((lobby) =>
        lobby.players.some((player) => player.id === guest.playerId && !player.connected),
      );
      expect(first.store.loadAuditEvents(gameId)).toHaveLength(3);

      const guestBack = await TestClient.connect(first.wsUrl);
      clients.push(guestBack);
      guestBack.send({ t: 'rejoin', sessionToken: guest.sessionToken });
      expect((await guestBack.wait('welcome')).playerId).toBe(guest.playerId);
      await guestBack.wait('state');
      expect(first.store.loadAuditEvents(gameId)).toHaveLength(3);

      const actionTwoBefore = Date.now();
      guestBack.clear();
      host.client.clear();
      guestBack.send({ t: 'action', action: actionTwo });
      await host.client.waitState((state) => state.round === 2 && state.activePlayerId === host.playerId);
      const actionTwoAfter = Date.now();

      const finalRecord = first.store.loadGames().find((game) => game.gameId === gameId);
      expect(finalRecord).toBeDefined();
      events = first.store.loadAuditEvents(gameId);
      expect(events.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5]);
      expect(events.map((event) => event.type)).toEqual(['start', 'action', 'automatic', 'action', 'automatic']);
      expect(events).toHaveLength(5);

      const actionEvents = events.filter(
        (event): event is Extract<GameAuditEvent, { type: 'action' }> => event.type === 'action',
      );
      expect(actionEvents).toHaveLength(2);
      expect(actionEvents[0]).toMatchObject({
        sequence: 2,
        playerId: host.playerId,
        action: actionOne,
      });
      expect(actionEvents[1]).toMatchObject({
        sequence: 4,
        playerId: guest.playerId,
        action: actionTwo,
      });
      expectTimestampInWindow(actionEvents[0]!.at, actionOneBefore, actionOneAfter);
      expectTimestampInWindow(actionEvents[1]!.at, actionTwoBefore, actionTwoAfter);
      expect(finalRecord!.chat).toEqual([
        expect.objectContaining({ from: host.playerId, text: 'audit boundary check' }),
      ]);

      const replayed = replayPersistedGame(stubGame, finalRecord!, events) as StubState;
      expect(JSON.stringify(normaliseState(replayed))).toBe(
        JSON.stringify(normaliseState(stateFrom(finalRecord!))),
      );

      const code = host.code;
      const hostToken = host.sessionToken;
      const guestToken = guest.sessionToken;
      const replayedBeforeRestart = replayed;

      await closeAll(...clients);
      clients.length = 0;
      await first.close();
      first = undefined;

      second = await boot({ dataDir });
      expect(second.store.kind).toBe('sqlite');
      const restored = second.hub.roomByCode(code);
      expect(restored).toBeDefined();
      expect(restored!.started).toBe(true);
      expect(second.store.loadAuditEvents(gameId)).toEqual(events);
      expect(JSON.stringify(normaliseState(restored!.state as StubState))).toBe(
        JSON.stringify(normaliseState(replayedBeforeRestart)),
      );

      const hostBack = await TestClient.connect(second.wsUrl);
      clients.push(hostBack);
      hostBack.send({ t: 'rejoin', sessionToken: hostToken });
      expect((await hostBack.wait('welcome')).playerId).toBe(host.playerId);
      await hostBack.wait('state');

      const actionAfterRestartBefore = Date.now();
      hostBack.clear();
      hostBack.send({ t: 'action', action: actionAfterRestart });
      await hostBack.waitState((state) => state.players[host.playerId]?.credits === 38);
      const actionAfterRestartAfter = Date.now();

      const continuedEvents = second.store.loadAuditEvents(gameId);
      expect(continuedEvents.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7]);
      const continuedAction = continuedEvents[5];
      expect(continuedAction).toMatchObject({
        sequence: 6,
        type: 'action',
        playerId: host.playerId,
        action: actionAfterRestart,
      });
      if (continuedAction?.type === 'action') {
        expectTimestampInWindow(continuedAction.at, actionAfterRestartBefore, actionAfterRestartAfter);
      }

      const continuedRecord = second.store.loadGames().find((game) => game.gameId === gameId);
      expect(continuedRecord).toBeDefined();
      const continuedReplay = replayPersistedGame(stubGame, continuedRecord!, continuedEvents) as StubState;
      expect(JSON.stringify(normaliseState(continuedReplay))).toBe(
        JSON.stringify(normaliseState(stateFrom(continuedRecord!))),
      );

      // Keep the second seat's token live through the restart path as well; it
      // proves the restart did not replace the persisted seat identity.
      const guestAfterRestart = await TestClient.connect(second.wsUrl);
      clients.push(guestAfterRestart);
      guestAfterRestart.send({ t: 'rejoin', sessionToken: guestToken });
      expect((await guestAfterRestart.wait('welcome')).playerId).toBe(guest.playerId);
    } finally {
      await closeAll(...clients);
      await second?.close();
      await first?.close();
    }
  });
});
