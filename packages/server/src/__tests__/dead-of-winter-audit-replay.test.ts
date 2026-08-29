import { afterEach, describe, expect, it } from 'vitest';
import { deadOfWinter, type GameState, type PendingChoice, type PlayerId } from '@game/dead-of-winter';
import { erase, type CreateGameContext, type SeatSeed } from '@tt/core';
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
  let state = seat.client.lastState<GameState>();
  if (!state?.pendingChoices.some((choice) => choice.playerId === seat.playerId && choice.kind === kind)) {
    state = (
      await seat.client.waitState<GameState>((candidate) =>
        candidate.pendingChoices.some((choice) => choice.playerId === seat.playerId && choice.kind === kind),
      )
    ).state;
  }
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

const PURE_SEAT_COLORS = ['ember', 'frost', 'moss'] as const;

function pureSeats(): SeatSeed[] {
  return PURE_SEAT_COLORS.map((color, index) => ({
    playerId: `p${index + 1}`,
    name: `P${index + 1}`,
    color,
    isBot: false,
  }));
}

function pureContext(seed: string): CreateGameContext {
  return {
    gameId: `dow-audit-pending-${seed}`,
    code: 'DOWAUD',
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
    state = deadOfWinter.applyAction(state, choice.playerId, {
      type: 'resolveChoice',
      choiceId: choice.id,
      optionIds: legal.slice(0, count).map((option) => option.id),
    }, 1_000);
  }
  if (state.phase !== 'playerTurns') throw new Error('Pure setup did not reach player turns');
  return state;
}

function findPendingEffectSeed(): string {
  for (let attempt = 0; attempt < 2_000; attempt += 1) {
    const seed = `DOW-AUDIT-PENDING-${attempt}`;
    const settings = {
      ...deadOfWinter.defaultSettings(),
      playerCount: 3,
      seed,
      mainObjectiveId: 'mo-stockpile',
      includeBetrayalObjective: false,
    };
    const state = finishPureSetup(deadOfWinter.createGame(pureContext(seed), settings, pureSeats()));
    const p1 = state.players.p1;
    if (state.activePlayerId === 'p1' && p1?.hand.some((iid) => state.items[iid]?.cardId === 'it-toolbox')) {
      return seed;
    }
  }
  throw new Error('Could not find a deterministic setup with an active host toolbox.');
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
    await actor.client.waitAnyState<GameState>();

    const finalRecord = second.store.loadGames().find((record) => record.gameId === beforeRestart.gameId)!;
    const finalEvents = second.store.loadAuditEvents(finalRecord.gameId);
    expect(finalEvents.map((event) => event.sequence)).toEqual(
      finalEvents.map((_, index) => index + 1),
    );
    expect(finalEvents[0]?.type).toBe('start');
    expect(finalEvents[0]?.afterState).toBeDefined();
    expect(finalEvents[0]?.publicExplanation).toBeTruthy();
    const transitionEvents = finalEvents.slice(1);
    expect(transitionEvents.some((event) => event.type === 'action')).toBe(true);
    expect(transitionEvents.some((event) => event.type === 'automatic')).toBe(true);
    expect(transitionEvents.every((event) => event.type === 'action' || event.type === 'automatic')).toBe(true);
    expect(
      transitionEvents.every((event) =>
        event.beforeState !== undefined &&
        event.afterState !== undefined &&
        event.publicExplanation !== undefined &&
        event.publicExplanation.length > 0,
      ),
    ).toBe(true);
    expect(
      transitionEvents.filter((event) => event.type === 'automatic').every((event) =>
        event.actor === 'system' &&
        event.trigger === 'action-settled' &&
        event.beforeHash.length === 64 &&
        event.afterHash.length === 64 &&
        event.beforeState !== undefined &&
        event.afterState !== undefined &&
        event.publicExplanation.length > 0,
      ),
    ).toBe(true);
    expect(finalRecord.auditSequence).toBe(finalEvents.length);
    const replayFinal = replayPersistedGame(deadOfWinter, finalRecord, finalEvents) as GameState;
    expect(normalizePresence(replayFinal)).toEqual(normalizePresence(finalRecord.state as GameState));
  });

  it('restarts a real pending effect choice with its effect stack and audit checkpoints intact', async () => {
    dataDir = makeDataDir();
    const seed = findPendingEffectSeed();
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
    host.client.clear();
    host.client.send({ t: 'startGame' });
    await Promise.all(seats.map((seat) => seat.client.wait('state')));
    for (const seat of seats) await answerChoice(seat, 'setupKeepSurvivors');
    for (const seat of seats) await answerChoice(seat, 'setupChooseLeader');

    const playing = await host.client.waitState<GameState>(
      (state) => state.phase === 'playerTurns' && state.activePlayerId === host.playerId,
    );
    const actorState = playing.state;
    const toolbox = actorState.players[host.playerId]!.hand.find(
      (iid) => actorState.items[iid]?.cardId === 'it-toolbox',
    );
    expect(toolbox).toBeDefined();
    const survivorId = Object.values(actorState.survivors).find(
      (survivor) => survivor.controllerId === host.playerId,
    )!.id;

    host.client.clear();
    host.client.send({
      t: 'action',
      action: { type: 'playItem', iid: toolbox, targetSurvivorId: survivorId },
    });
    const equipped = await host.client.waitState<GameState>((state) =>
      state.survivors[survivorId]?.equipped.includes(toolbox!),
    );

    host.client.clear();
    host.client.send({
      t: 'action',
      action: {
        type: 'useAbility',
        survivorId,
        abilityId: 'toolbox-work',
        itemIid: toolbox,
      },
    });
    const pending = await host.client.waitState<GameState>(
      (state) => state.pendingChoices.some((choice) => choice.kind === 'effectOption') && state.effectStack.length > 0,
    );
    const pendingState = pending.state;
    expect(pendingState.effectStack.length).toBeGreaterThan(0);
    expect(pendingState.pendingChoices[0]?.kind).toBe('effectOption');

    const record = first.store.loadGames().find((game) => game.code === host.code)!;
    const authoritativePendingState = record.state as GameState;
    expect(authoritativePendingState.effectStack.length).toBeGreaterThan(0);
    const events = first.store.loadAuditEvents(record.gameId);
    expect(events.some((event) => event.type === 'automatic')).toBe(true);
    expect(
      events.filter((event) => event.type === 'automatic').every((event) =>
        event.actor === 'system' &&
        event.beforeHash.length === 64 &&
        event.afterHash.length === 64 &&
        event.beforeState !== undefined &&
        event.afterState !== undefined &&
        event.publicExplanation.length > 0,
      ),
    ).toBe(true);
    expect(record.auditSequence).toBe(events.length);

    const code = host.code;
    const token = host.sessionToken;
    await closeAll(...clients.splice(0));
    await first.close();
    servers.splice(servers.indexOf(first), 1);

    const second = await boot({ dataDir, registry: registry() });
    servers.push(second);
    const restored = second.hub.roomByCode(code)!;
    expect(restored.started).toBe(true);
    expect(normalizePresence(restored.state as GameState)).toEqual(normalizePresence(authoritativePendingState));
    expect(second.store.loadAuditEvents(record.gameId)).toEqual(events);
    expect(replayPersistedGame(deadOfWinter, record, events)).toBeDefined();

    const hostBack = await TestClient.connect(second.wsUrl);
    clients.push(hostBack);
    hostBack.send({ t: 'rejoin', sessionToken: token });
    expect((await hostBack.wait('welcome')).playerId).toBe(host.playerId);
    const restoredView = await hostBack.waitAnyState<GameState>();
    expect(restoredView.state.pendingChoices).toEqual(pendingState.pendingChoices);
    expect(restoredView.state.effectStack).toEqual(pendingState.effectStack);

    const choice = restoredView.state.pendingChoices[0]!;
    const option = choice.options.find((candidate) => candidate.legal)!;
    hostBack.clear();
    hostBack.send({
      t: 'action',
      action: { type: 'resolveChoice', choiceId: choice.id, optionIds: [option.id] },
    });
    const settled = await hostBack.waitState<GameState>(
      (state) => state.pendingChoices.length === 0 && state.effectStack.length === 0,
    );
    expect(settled.state.survivors[survivorId]?.equipped).toContain(toolbox);
    expect(settled.state.log.length).toBeGreaterThan(equipped.state.log.length);
  });
});
