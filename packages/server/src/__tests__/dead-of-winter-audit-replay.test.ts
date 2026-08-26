import { afterEach, describe, expect, it } from 'vitest';
import { deadOfWinter, type GameState, type PendingChoice, type PlayerId } from '@game/dead-of-winter';
import { erase } from '@tt/core';
import { createRegistry } from '../games.js';
import { replayPersistedGame } from '../persistence/replay.js';
import type { RunningServer } from '../server.js';
import { boot, closeAll, createGame, joinGame, makeDataDir, removeDataDir } from './helpers.js';
import { TestClient } from './testClient.js';

interface Seated {
  client: TestClient;
  playerId: PlayerId;
  sessionToken: string;
}

const registry = () => createRegistry([erase(deadOfWinter)]);

function normalizePresence(state: GameState): GameState {
  const copy = structuredClone(state);
  for (const player of Object.values(copy.players)) {
    player.connected = false;
    player.lastSeen = 0;
  }
  return copy;
}

function ownChoice(state: GameState, playerId: PlayerId, kind: PendingChoice['kind']): PendingChoice {
  const choice = state.pendingChoices.find((candidate) => candidate.playerId === playerId && candidate.kind === kind);
  if (!choice) throw new Error(`Missing ${kind} choice for ${playerId}`);
  return choice;
}

async function answerChoice(seat: Seated, kind: PendingChoice['kind']): Promise<void> {
  const state = seat.client.lastState<GameState>() ?? (await seat.client.waitAnyState<GameState>()).state;
  const choice = ownChoice(state, seat.playerId, kind);
  const legal = choice.options.filter((option) => option.legal);
  const minPicks = choice.minPicks ?? 1;
  if (legal.length < minPicks) throw new Error(`No legal ${kind} option for ${seat.playerId}`);
  seat.client.clear();
  seat.client.send({
    t: 'action',
    action: {
      type: 'resolveChoice',
      choiceId: choice.id,
      optionIds: legal.slice(0, minPicks).map((option) => option.id),
    },
  });
  await seat.client.waitAnyState<GameState>();
}

function privateIdentities(state: GameState, playerId: PlayerId): string[] {
  const player = state.players[playerId];
  if (!player) throw new Error(`Missing player ${playerId}`);
  return [...player.hand, ...player.secretObjectiveIds];
}

function containsExactToken(serialized: string, identity: string): boolean {
  const escaped = identity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Za-z0-9_-])${escaped}($|[^A-Za-z0-9_-])`).test(serialized);
}

describe('Dead of Winter server audit and replay', () => {
  let dataDir: string | undefined;
  const clients: TestClient[] = [];
  const servers: RunningServer[] = [];

  afterEach(async () => {
    await closeAll(...clients.splice(0));
    for (const server of servers.splice(0).reverse()) await server.close();
    if (dataDir) removeDataDir(dataDir);
    dataDir = undefined;
  });

  it('replays real setup RNG and restores pending private choices across SQLite restart', async () => {
    dataDir = makeDataDir();
    const first = await boot({ dataDir, registry: registry() });
    servers.push(first);

    const host = await createGame(
      first,
      'Ada',
      { playerCount: 3, seed: 'DOW-AUDIT-E2E', mainObjectiveId: 'mo-stockpile' },
      deadOfWinter.descriptor.key,
    );
    clients.push(host.client);
    const grace = await joinGame(first, host.code, 'Grace');
    clients.push(grace.client);
    const linus = await joinGame(first, host.code, 'Linus');
    clients.push(linus.client);
    const seats = [host, grace, linus];

    grace.client.send({ t: 'setReady', ready: true });
    linus.client.send({ t: 'setReady', ready: true });
    await host.client.waitLobby((lobby) => lobby.players.every((player) => player.ready || player.isHost));
    for (const seat of seats) seat.client.clear();
    host.client.send({ t: 'startGame' });
    await Promise.all(seats.map((seat) => seat.client.wait('state')));

    const beforeRestart = first.store.loadGames().find((record) => record.code === host.code)!;
    const beforeState = beforeRestart.state as GameState;
    const beforeEvents = first.store.loadAuditEvents(beforeRestart.gameId);
    expect(beforeEvents).toHaveLength(1);
    expect(beforeEvents[0]?.type).toBe('start');
    expect(beforeRestart.auditSequence).toBe(1);
    expect(beforeState.rngCursor).toBeGreaterThan(0);
    expect(beforeState.pendingChoices.some((choice) => choice.kind === 'setupKeepSurvivors')).toBe(true);

    const targetId = beforeState.pendingChoices.find((choice) => choice.kind === 'setupKeepSurvivors')!.playerId!;
    const target = seats.find((seat) => seat.playerId === targetId)!;
    const other = seats.find((seat) => seat.playerId !== targetId)!;
    const identities = privateIdentities(beforeState, targetId);
    expect(identities.length).toBeGreaterThan(0);
    const replayBefore = replayPersistedGame(deadOfWinter, beforeRestart, beforeEvents) as GameState;
    expect(normalizePresence(replayBefore)).toEqual(normalizePresence(beforeState));

    const tokens = Object.fromEntries(seats.map((seat) => [seat.playerId, seat.sessionToken]));
    const code = host.code;
    await closeAll(...clients.splice(0));
    await first.close();
    servers.splice(servers.indexOf(first), 1);

    const second = await boot({ dataDir, registry: registry() });
    servers.push(second);
    const restored = second.hub.roomByCode(code)!;
    expect(restored.started).toBe(true);
    expect((restored.state as GameState).pendingChoices).toEqual(beforeState.pendingChoices);
    expect((restored.state as GameState).rngCursor).toBe(beforeState.rngCursor);
    expect(second.store.loadAuditEvents(beforeRestart.gameId)).toEqual(beforeEvents);

    const targetBack: Seated = { client: await TestClient.connect(second.wsUrl), playerId: targetId, sessionToken: tokens[targetId]! };
    clients.push(targetBack.client);
    targetBack.client.send({ t: 'rejoin', sessionToken: targetBack.sessionToken });
    expect((await targetBack.client.wait('welcome')).playerId).toBe(targetId);
    const targetView = (await targetBack.client.waitAnyState<GameState>()).state;
    expect(privateIdentities(targetView, targetId)).toEqual(identities);
    expect(ownChoice(targetView, targetId, 'setupKeepSurvivors').playerId).toBe(targetId);

    const otherBack: Seated = { client: await TestClient.connect(second.wsUrl), playerId: other.playerId, sessionToken: tokens[other.playerId]! };
    clients.push(otherBack.client);
    otherBack.client.send({ t: 'rejoin', sessionToken: otherBack.sessionToken });
    const otherView = (await otherBack.client.waitAnyState<GameState>()).state;
    const serializedOther = JSON.stringify(otherView);
    for (const identity of identities) expect(containsExactToken(serializedOther, identity)).toBe(false);
    expect(otherView.players[targetId]!.hand.every((iid) => iid.startsWith('hidden:'))).toBe(true);

    const thirdBack: Seated = { client: await TestClient.connect(second.wsUrl), playerId: linus.playerId, sessionToken: tokens[linus.playerId]! };
    clients.push(thirdBack.client);
    thirdBack.client.send({ t: 'rejoin', sessionToken: thirdBack.sessionToken });
    await thirdBack.client.waitAnyState<GameState>();
    const resumedSeats = [targetBack, otherBack, thirdBack];
    for (const seat of resumedSeats) await answerChoice(seat, 'setupKeepSurvivors');
    for (const seat of resumedSeats) await answerChoice(seat, 'setupChooseLeader');
    const playing = await Promise.all(
      resumedSeats.map((seat) => seat.client.waitState<GameState>((state) => state.phase === 'playerTurns' && state.turn !== null)),
    );
    const actorId = playing[0]!.state.activePlayerId!;
    const actor = resumedSeats.find((seat) => seat.playerId === actorId)!;
    const actorState = playing.find((message) => message.state.activePlayerId === actorId)!.state;
    const action = deadOfWinter.defaultActionFor!(actorState, actorId)!;
    expect(deadOfWinter.validateAction(actorState, actorId, action).ok).toBe(true);
    actor.client.clear();
    actor.client.send({ t: 'action', action });
    await actor.client.waitState<GameState>((state) => state.log.length > actorState.log.length);

    const finalRecord = second.store.loadGames().find((record) => record.gameId === beforeRestart.gameId)!;
    const finalEvents = second.store.loadAuditEvents(finalRecord.gameId);
    expect(finalEvents.map((event) => event.sequence)).toEqual(
      finalEvents.map((_, index) => index + 1),
    );
    expect(finalEvents[0]?.type).toBe('start');
    expect(finalEvents.slice(1).every((event) => event.type === 'action')).toBe(true);
    expect(finalRecord.auditSequence).toBe(finalEvents.length);
    const replayFinal = replayPersistedGame(deadOfWinter, finalRecord, finalEvents) as GameState;
    expect(normalizePresence(replayFinal)).toEqual(normalizePresence(finalRecord.state as GameState));
  });
});
