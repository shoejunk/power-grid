import { afterEach, describe, expect, it } from 'vitest';
import { erase, type CreateGameContext, type SeatSeed } from '@tt/core';
import {
  deadOfWinter,
  NON_COLONY_LOCATIONS,
  type GameAction,
  type GameState,
  type PendingChoice,
} from '@game/dead-of-winter';
import { createRegistry } from '../games.js';
import { hashReplayState, replayPersistedGame } from '../persistence/replay.js';
import type { GameAuditEvent } from '../persistence/types.js';
import type { RunningServer } from '../server.js';
import { boot, closeAll, createGame, joinGame, makeDataDir, removeDataDir } from './helpers.js';
import { TestClient } from './testClient.js';

interface Seated {
  client: TestClient;
  playerId: string;
}

const registry = () => createRegistry([erase(deadOfWinter)]);
const seatColors = ['ember', 'frost', 'moss'] as const;

function seats(): SeatSeed[] {
  return seatColors.map((color, index) => ({
    playerId: `p${index + 1}`,
    name: `P${index + 1}`,
    color,
    isBot: false,
  }));
}

function context(seed: string): CreateGameContext {
  return { gameId: `strict-a15-${seed}`, code: 'STRICTA15', hostId: 'p1', seed, now: 1_000 };
}

function setupState(seed: string): GameState {
  return deadOfWinter.createGame(
    context(seed),
    {
      ...deadOfWinter.defaultSettings(),
      playerCount: 3,
      seed,
      mainObjectiveId: 'mo-stockpile',
      includeBetrayalObjective: false,
    },
    seats(),
  );
}

function firstLegalPicks(choice: PendingChoice): string[] {
  const count = Math.max(1, choice.minPicks ?? 1);
  return choice.options.filter((option) => option.legal).slice(0, count).map((option) => option.id);
}

function finishSetup(initial: GameState): GameState {
  let state = initial;
  for (let guard = 0; state.phase === 'setup' && guard < 100; guard += 1) {
    const choice = state.pendingChoices[0];
    if (!choice?.playerId) throw new Error('setup choice has no owner');
    const optionIds = firstLegalPicks(choice);
    if (optionIds.length < Math.max(1, choice.minPicks ?? 1)) throw new Error('setup choice has no legal pick');
    state = deadOfWinter.applyAction(
      state,
      choice.playerId,
      { type: 'resolveChoice', choiceId: choice.id, optionIds },
      1_000,
    );
  }
  if (state.phase !== 'playerTurns') throw new Error('setup did not reach player turns');
  return state;
}

function findRandomMoveSeed(): string {
  for (let attempt = 0; attempt < 2_000; attempt += 1) {
    const seed = `STRICT-A15-RANDOM-${attempt}`;
    const state = finishSetup(setupState(seed));
    const playerId = state.activePlayerId;
    if (!playerId) continue;
    const survivor = Object.values(state.survivors).find((candidate) => {
      if (candidate.controllerId !== playerId) return false;
      return NON_COLONY_LOCATIONS.some((to) =>
        deadOfWinter.validateAction(state, playerId, {
          type: 'moveSurvivor',
          survivorId: candidate.id,
          to,
        }).ok,
      );
    });
    if (!survivor) continue;
    const to = NON_COLONY_LOCATIONS.find((candidate) =>
      deadOfWinter.validateAction(state, playerId, {
        type: 'moveSurvivor',
        survivorId: survivor.id,
        to: candidate,
      }).ok,
    );
    if (!to) continue;
    const next = deadOfWinter.applyAction(state, playerId, {
      type: 'moveSurvivor',
      survivorId: survivor.id,
      to,
    }, 1_000);
    if (
      next.rngCursor > state.rngCursor &&
      next.log.some((entry) => entry.data?.['event'] === 'exposure') &&
      next.pendingChoices.length === 0 &&
      next.effectStack.length === 0 &&
      next.survivors[survivor.id] !== undefined
    ) {
      return seed;
    }
  }
  throw new Error('Could not find a deterministic seed with a safe random move');
}

async function answerSetupChoice(seat: Seated, kind: PendingChoice['kind']): Promise<void> {
  let state = seat.client.lastState<GameState>();
  if (!state?.pendingChoices.some((choice) => choice.playerId === seat.playerId && choice.kind === kind)) {
    state = (
      await seat.client.waitState<GameState>((candidate) =>
        candidate.pendingChoices.some((choice) => choice.playerId === seat.playerId && choice.kind === kind),
      )
    ).state;
  }
  const choice = state.pendingChoices.find(
    (candidate) => candidate.playerId === seat.playerId && candidate.kind === kind,
  )!;
  const optionIds = firstLegalPicks(choice);
  seat.client.clear();
  seat.client.send({ t: 'action', action: { type: 'resolveChoice', choiceId: choice.id, optionIds } });
  await seat.client.waitState<GameState>((candidate) =>
    !candidate.pendingChoices.some((pending) => pending.playerId === seat.playerId && pending.kind === kind),
  );
}

function normalizePresence(state: GameState): GameState {
  const copy = structuredClone(state);
  for (const player of Object.values(copy.players)) {
    player.connected = false;
    player.lastSeen = 0;
  }
  return copy;
}

describe('strict Dead of Winter A15 random replay boundary', () => {
  let dataDir: string | undefined;
  const clients: TestClient[] = [];
  const servers: RunningServer[] = [];

  afterEach(async () => {
    await closeAll(...clients.splice(0));
    for (const server of servers.splice(0).reverse()) await server.close();
    if (dataDir) removeDataDir(dataDir);
    dataDir = undefined;
  });

  it('records a random player action over WebSocket, replays it byte-for-byte, and rejects tampering', async () => {
    dataDir = makeDataDir();
    const seed = findRandomMoveSeed();
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
    const seated: Seated[] = [host, grace, linus];

    grace.client.send({ t: 'setReady', ready: true });
    linus.client.send({ t: 'setReady', ready: true });
    await host.client.waitLobby((lobby) => lobby.players.every((player) => player.ready || player.isHost));
    for (const seat of seated) seat.client.clear();
    host.client.send({ t: 'startGame' });
    await Promise.all(seated.map((seat) => seat.client.wait('state')));

    for (const kind of ['setupKeepSurvivors', 'setupChooseLeader'] as const) {
      for (const seat of seated) await answerSetupChoice(seat, kind);
    }

    const visible = host.client.lastState<GameState>()!;
    const before = first.store.loadGames().find((record) => record.code === host.code)!;
    const beforeState = before.state as GameState;
    const playerId = beforeState.activePlayerId!;
    expect(visible.activePlayerId).toBe(playerId);
    const survivor = Object.values(beforeState.survivors).find((candidate) => candidate.controllerId === playerId)!;
    const to = NON_COLONY_LOCATIONS.find((candidate) =>
      deadOfWinter.validateAction(beforeState, playerId, {
        type: 'moveSurvivor',
        survivorId: survivor.id,
        to: candidate,
      }).ok,
    );
    if (!to) {
      throw new Error(
        `No legal random move on the real WebSocket state: ${beforeState.phase}/${beforeState.colonyStep ?? '-'} active=${playerId ?? '-'} pending=${beforeState.pendingChoices.map((choice) => choice.kind).join(',')}`,
      );
    }
    const action: GameAction = { type: 'moveSurvivor', survivorId: survivor.id, to };
    const actor = seated.find((seat) => seat.playerId === playerId)!;

    actor.client.clear();
    actor.client.send({ t: 'action', action });
    await actor.client.waitState((state) => state.log.some((entry) => entry.data?.['event'] === 'exposure'));

    const after = first.store.loadGames().find((record) => record.gameId === before.gameId)!;
    const events = first.store.loadAuditEvents(before.gameId);
    const actionEvent = events.find(
      (event): event is Extract<GameAuditEvent, { type: 'action' }> =>
        event.type === 'action' && JSON.stringify(event.action) === JSON.stringify(action),
    );
    expect(actionEvent).toBeDefined();
    expect(actionEvent!.beforeState).toBeDefined();
    expect(actionEvent!.afterState).toBeDefined();
    expect((actionEvent!.afterState as GameState).rngCursor).toBeGreaterThan(
      (actionEvent!.beforeState as GameState).rngCursor,
    );
    expect((actionEvent!.afterState as GameState).log.some((entry) => entry.data?.['event'] === 'exposure')).toBe(true);
    expect(actionEvent!.beforeHash).toBe(hashReplayState(actionEvent!.beforeState));
    expect(actionEvent!.afterHash).toBe(hashReplayState(actionEvent!.afterState));

    const automatic = events.filter((event) => event.type === 'automatic');
    expect(automatic.length).toBeGreaterThan(0);
    expect(automatic.every((event) => event.beforeState !== undefined && event.afterState !== undefined)).toBe(true);
    expect(automatic.every((event) => event.publicExplanation.length > 0)).toBe(true);
    expect(automatic.some((event) => event.publicExplanation.includes('exposed'))).toBe(true);

    const replayed = replayPersistedGame(deadOfWinter, after, events) as GameState;
    expect(JSON.stringify(normalizePresence(replayed))).toBe(JSON.stringify(normalizePresence(after.state as GameState)));

    const tampered = structuredClone(events);
    const tamperedAction = tampered.find(
      (event): event is Extract<GameAuditEvent, { type: 'action' }> =>
        event.type === 'action' && JSON.stringify(event.action) === JSON.stringify(action),
    )!;
    tamperedAction.afterHash = '0'.repeat(64);
    expect(() => replayPersistedGame(deadOfWinter, after, tampered)).toThrow(/Audit after checkpoint mismatch/);
    expect((beforeState.log.length ?? 0)).toBeLessThan((after.state as GameState).log.length);
  });
});
