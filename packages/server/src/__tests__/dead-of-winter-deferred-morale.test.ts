import { afterEach, describe, expect, it } from 'vitest';
import {
  deadOfWinter,
  type GameState,
  type PendingChoice,
  type PlayerId,
} from '@game/dead-of-winter';
import type { SeatSeed } from '@tt/core';
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

const registry = () => createRegistry([deadOfWinter]);

const SEAT_COLORS = ['ember', 'frost', 'moss'] as const;

function pureSeats(): SeatSeed[] {
  return SEAT_COLORS.map((color, index) => ({
    playerId: `p${index + 1}`,
    name: `P${index + 1}`,
    color,
    isBot: false,
  }));
}

function pureSetupContext(seed: string) {
  return {
    gameId: `dow-deferred-${seed}`,
    code: 'DOWDEF',
    hostId: 'p1',
    seed,
    now: 1_000,
  };
}

function finishPureSetup(initial: GameState): GameState {
  let state = initial;
  for (let guard = 0; state.phase === 'setup' && guard < 100; guard += 1) {
    const choice = state.pendingChoices[0];
    if (!choice?.playerId) throw new Error('Pure setup choice has no player');
    const legal = choice.options.filter((option) => option.legal);
    const count = Math.max(1, choice.minPicks ?? 1);
    if (legal.length < count) throw new Error(`Pure setup has too few legal options: ${choice.kind}`);
    state = deadOfWinter.applyAction(
      state,
      choice.playerId,
      {
        type: 'resolveChoice',
        choiceId: choice.id,
        optionIds: legal.slice(0, count).map((option) => option.id),
      },
      1_000,
    );
  }
  if (state.phase !== 'playerTurns') throw new Error('Pure setup did not reach player turns');
  return state;
}

function firstLegalChoice(state: GameState, choice: PendingChoice): GameState {
  const legal = choice.options.filter((option) => option.legal);
  const count = Math.max(1, choice.minPicks ?? 1);
  if (legal.length < count) throw new Error(`No legal option for ${choice.kind}`);
  const playerId = choice.playerId;
  if (!playerId) throw new Error(`Choice ${choice.kind} has no player`);
  return deadOfWinter.applyAction(
    state,
    playerId,
    {
      type: 'resolveChoice',
      choiceId: choice.id,
      optionIds: legal.slice(0, count).map((option) => option.id),
    },
    1_000,
  );
}

function reachDeferredMorale(initial: GameState): GameState | null {
  let state = finishPureSetup(initial);
  for (let guard = 0; guard < 200; guard += 1) {
    const overrun = state.pendingChoices.find((choice) => choice.kind === 'overrunCasualty');
    if (state.deferMoraleCheck && overrun && state.effectStack.length > 0) return state;

    const choice = state.pendingChoices[0];
    if (choice) {
      if (choice.playerId === null) {
        const voter = state.vote?.electorate.find((id) => state.vote?.votes[id] === undefined);
        if (!voter) throw new Error('Open vote choice has no uncommitted voter');
        state = deadOfWinter.applyAction(state, voter, { type: 'castVote', vote: false }, 1_000);
      } else {
        state = firstLegalChoice(state, choice);
      }
      continue;
    }

    if (state.vote) {
      const voter = state.vote.electorate.find((id) => state.vote?.votes[id] === undefined);
      if (!voter) throw new Error('Vote was present without an open electorate seat');
      state = deadOfWinter.applyAction(state, voter, { type: 'castVote', vote: false }, 1_000);
      continue;
    }

    const playerId = deadOfWinter.activePlayerOf(state);
    if (!playerId || state.phase !== 'playerTurns') return null;
    state = deadOfWinter.applyAction(state, playerId, { type: 'endTurn' }, 1_000);
  }
  return null;
}

function findDeferredMoraleSeed(): string {
  for (let attempt = 0; attempt < 2_000; attempt += 1) {
    const seed = `DOW-DEFERRED-MORALE-${attempt}`;
    const settings = {
      ...deadOfWinter.defaultSettings(),
      playerCount: 3,
      seed,
      mainObjectiveId: 'mo-stockpile',
      includeBetrayalObjective: false,
    };
    const initial = deadOfWinter.createGame(pureSetupContext(seed), settings, pureSeats());
    if (reachDeferredMorale(initial)) return seed;
  }
  throw new Error('Could not find a deterministic setup that pauses on a tied overrun casualty');
}

function ownPending(state: GameState | undefined, playerId: PlayerId): PendingChoice | undefined {
  return state?.pendingChoices.find((choice) => choice.playerId === playerId);
}

async function waitActionState(seat: Seated): Promise<void> {
  const message = await seat.client.waitWhere(
    (candidate) => candidate.t === 'state' || candidate.t === 'actionRejected',
    4_000,
    'action result',
  );
  if (message.t === 'actionRejected') throw new Error(`Action rejected: ${message.reason}`);
}

async function answerOwnPending(seat: Seated): Promise<boolean> {
  const state = seat.client.lastState<GameState>();
  const choice = ownPending(state, seat.playerId);
  if (!choice) return false;
  const legal = choice.options.filter((option) => option.legal);
  const count = Math.max(1, choice.minPicks ?? 1);
  if (legal.length < count) throw new Error(`No legal option for ${choice.kind}`);
  seat.client.clear();
  seat.client.send({
    t: 'action',
    action: {
      type: 'resolveChoice',
      choiceId: choice.id,
      optionIds: legal.slice(0, count).map((option) => option.id),
    },
  });
  await waitActionState(seat);
  return true;
}

async function driveNextAction(seats: Seated[]): Promise<void> {
  for (const seat of seats) {
    if (await answerOwnPending(seat)) return;
  }

  for (const seat of seats) {
    const state = seat.client.lastState<GameState>();
    if (!state?.vote || state.vote.votes[seat.playerId] !== undefined) continue;
    seat.client.clear();
    seat.client.send({ t: 'action', action: { type: 'castVote', vote: false } });
    await waitActionState(seat);
    return;
  }

  const state = seats[0]!.client.lastState<GameState>();
  if (!state) throw new Error('No state available while driving the real table');
  const playerId = deadOfWinter.activePlayerOf(state);
  if (!playerId || state.phase !== 'playerTurns') {
    throw new Error(`Table stalled at ${state.phase}/${state.colonyStep ?? '-'}`);
  }
  const actor = seats.find((seat) => seat.playerId === playerId);
  if (!actor) throw new Error(`No socket for active player ${playerId}`);
  actor.client.clear();
  actor.client.send({ t: 'action', action: { type: 'endTurn' } });
  await waitActionState(actor);
}

function normalizePresence(state: GameState): GameState {
  const copy = structuredClone(state);
  for (const player of Object.values(copy.players)) {
    player.connected = false;
  }
  return copy;
}

describe('Dead of Winter deferred morale persistence', () => {
  let dataDir: string | undefined;
  const clients: TestClient[] = [];
  const servers: RunningServer[] = [];

  afterEach(async () => {
    await closeAll(...clients.splice(0));
    for (const server of servers.splice(0).reverse()) await server.close();
    if (dataDir) removeDataDir(dataDir);
    dataDir = undefined;
  });

  it('drives a real round into deferred morale, restarts, replays, and resumes the same seat', async () => {
    dataDir = makeDataDir();
    const seed = findDeferredMoraleSeed();
    const first = await boot({ dataDir, registry: registry() });
    servers.push(first);

    const host = await createGame(
      first,
      'Ada',
      { playerCount: 3, seed, mainObjectiveId: 'mo-stockpile', includeBetrayalObjective: false },
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
    await Promise.all(seats.map((seat) => waitActionState(seat)));

    for (let guard = 0; guard < 100; guard += 1) {
      const state = host.client.lastState<GameState>();
      if (state?.phase !== 'setup') break;
      await driveNextAction(seats);
    }
    const setupState = host.client.lastState<GameState>();
    expect(setupState?.phase).toBe('playerTurns');

    for (let guard = 0; guard < 100; guard += 1) {
      const state = host.client.lastState<GameState>();
      if (
        state?.deferMoraleCheck &&
        state.effectStack.length > 0 &&
        state.pendingChoices.some((choice) => choice.kind === 'overrunCasualty')
      ) break;
      await driveNextAction(seats);
    }

    const pendingView = host.client.lastState<GameState>()!;
    expect(pendingView.deferMoraleCheck).toBe(true);
    expect(pendingView.effectStack.length).toBeGreaterThan(0);
    expect(pendingView.colonyStep).toBe('addZombies');
    expect(pendingView.pendingChoices.some((choice) => choice.kind === 'overrunCasualty')).toBe(true);

    const recordBefore = first.store.loadGames().find((record) => record.code === host.code)!;
    const authoritativeBefore = recordBefore.state as GameState;
    const eventsBefore = first.store.loadAuditEvents(recordBefore.gameId);
    expect(authoritativeBefore.deferMoraleCheck).toBe(true);
    expect(authoritativeBefore.effectStack.length).toBeGreaterThan(0);
    expect(authoritativeBefore.pendingChoices.some((choice) => choice.kind === 'overrunCasualty')).toBe(true);
    expect(
      eventsBefore.filter((event) => event.type === 'automatic').some((event) =>
        event.actor === 'system' &&
        event.trigger.length > 0 &&
        event.beforeState !== undefined &&
        event.afterState !== undefined &&
        event.publicExplanation.length > 0,
      ),
    ).toBe(true);
    expect(eventsBefore.every((event, index) => event.sequence === index + 1)).toBe(true);
    expect(recordBefore.auditSequence).toBe(eventsBefore.length);
    expect(normalizePresence(replayPersistedGame(deadOfWinter, recordBefore, eventsBefore) as GameState)).toEqual(
      normalizePresence(authoritativeBefore),
    );

    const casualtyOwnerId = authoritativeBefore.pendingChoices.find(
      (choice) => choice.kind === 'overrunCasualty',
    )!.playerId!;
    const casualtyOwner = seats.find((seat) => seat.playerId === casualtyOwnerId)!;
    const ownHand = [...authoritativeBefore.players[casualtyOwnerId]!.hand];
    const ownObjectives = [...authoritativeBefore.players[casualtyOwnerId]!.secretObjectiveIds];
    const token = casualtyOwner.sessionToken;
    const code = host.code;
    await closeAll(...clients.splice(0));
    await first.close();
    servers.splice(servers.indexOf(first), 1);

    const second = await boot({ dataDir, registry: registry() });
    servers.push(second);
    const restored = second.hub.roomByCode(code)!;
    const restoredState = restored.state as GameState;
    expect(restored.started).toBe(true);
    expect(restoredState.deferMoraleCheck).toBe(true);
    expect(restoredState.effectStack.length).toBe(authoritativeBefore.effectStack.length);
    expect(restoredState.pendingChoices).toEqual(authoritativeBefore.pendingChoices);
    expect(second.store.loadAuditEvents(recordBefore.gameId)).toEqual(eventsBefore);
    expect(normalizePresence(replayPersistedGame(deadOfWinter, recordBefore, eventsBefore) as GameState)).toEqual(
      normalizePresence(restoredState),
    );

    const hostBack = await TestClient.connect(second.wsUrl);
    clients.push(hostBack);
    hostBack.send({ t: 'rejoin', sessionToken: token });
    expect((await hostBack.wait('welcome')).playerId).toBe(casualtyOwnerId);
    const resumed = await hostBack.waitAnyState<GameState>();
    expect(resumed.state.players[casualtyOwnerId]!.hand).toEqual(ownHand);
    expect(resumed.state.players[casualtyOwnerId]!.secretObjectiveIds).toEqual(ownObjectives);
    const casualty = resumed.state.pendingChoices.find((choice) => choice.kind === 'overrunCasualty');
    expect(casualty).toBeDefined();
    const survivor = casualty!.options.find((option) => option.legal)!;
    hostBack.clear();
    hostBack.send({
      t: 'action',
      action: { type: 'resolveChoice', choiceId: casualty!.id, optionIds: [survivor.id] },
    });
    const continued = await hostBack.waitState<GameState>(
      (state) => state.log.length > resumed.state.log.length,
    );
    expect(continued.state.log.length).toBeGreaterThan(resumed.state.log.length);
  });
});
