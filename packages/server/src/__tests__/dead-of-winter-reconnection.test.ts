import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deadOfWinter, type GameState, type PendingChoice, type PlayerId } from '@game/dead-of-winter';
import { erase } from '@tt/core';

import type { RunningServer } from '../server.js';
import { createRegistry } from '../games.js';
import { boot, closeAll, createGame, joinGame, makeDataDir, removeDataDir } from './helpers.js';
import { TestClient } from './testClient.js';

interface Seated {
  client: TestClient;
  playerId: PlayerId;
  sessionToken: string;
}

interface PrivateProof {
  seat: Pick<GameState['players'][string], 'id' | 'name' | 'color' | 'seatIndex' | 'leaderSurvivorId'>;
  hand: string[];
  handItems: Record<string, string | null>;
  secretObjectiveIds: string[];
  exiledObjectiveId: string | null;
  crossroads: GameState['turn'];
}

const isHidden = (value: unknown): value is string =>
  typeof value === 'string' && value.startsWith('hidden:');

function dowRegistry() {
  return createRegistry([erase(deadOfWinter)]);
}

function ownChoice(state: GameState, playerId: PlayerId, kind: PendingChoice['kind']): PendingChoice {
  const choice = state.pendingChoices.find((c) => c.playerId === playerId && c.kind === kind);
  if (!choice) throw new Error(`No ${kind} choice for ${playerId}`);
  return choice;
}

function firstLegalPicks(choice: PendingChoice): string[] {
  const picks = choice.options
    .filter((option) => option.legal)
    .slice(0, choice.minPicks ?? 1)
    .map((option) => option.id);
  if (picks.length < (choice.minPicks ?? 1)) {
    throw new Error(`Choice ${choice.id} does not have enough legal options`);
  }
  return picks;
}

async function answerOwnChoice(seat: Seated, kind: PendingChoice['kind']): Promise<GameState> {
  const current = seat.client.lastState<GameState>();
  const state = current ?? (await seat.client.waitAnyState<GameState>()).state;
  const choice = ownChoice(state, seat.playerId, kind);
  seat.client.clear();
  seat.client.send({
    t: 'action',
    action: {
      type: 'resolveChoice',
      choiceId: choice.id,
      optionIds: firstLegalPicks(choice),
    },
  });
  return (await seat.client.waitAnyState<GameState>()).state;
}

async function waitForOwnChoice(seat: Seated, kind: PendingChoice['kind']): Promise<void> {
  await seat.client.waitState<GameState>(
    (state) => state.pendingChoices.some((choice) => choice.playerId === seat.playerId && choice.kind === kind),
    5_000,
    `${kind} for ${seat.playerId}`,
  );
}

async function waitForPlayerTurns(seats: Seated[]): Promise<Map<PlayerId, GameState>> {
  const views = new Map<PlayerId, GameState>();
  for (const seat of seats) {
    const message = await seat.client.waitState<GameState>(
      (state) => state.phase === 'playerTurns' && state.turn !== null,
      5_000,
      `player turns for ${seat.playerId}`,
    );
    views.set(seat.playerId, message.state);
  }
  return views;
}

async function driveSetupToFirstTurn(seats: Seated[]): Promise<Map<PlayerId, GameState>> {
  for (const seat of seats) await waitForOwnChoice(seat, 'setupKeepSurvivors');
  for (const seat of seats) await answerOwnChoice(seat, 'setupKeepSurvivors');

  for (const seat of seats) await waitForOwnChoice(seat, 'setupChooseLeader');
  for (const seat of seats) await answerOwnChoice(seat, 'setupChooseLeader');

  return waitForPlayerTurns(seats);
}

function privateProof(state: GameState, playerId: PlayerId): PrivateProof {
  const player = state.players[playerId];
  if (!player) throw new Error(`Missing player ${playerId}`);
  return {
    seat: {
      id: player.id,
      name: player.name,
      color: player.color,
      seatIndex: player.seatIndex,
      leaderSurvivorId: player.leaderSurvivorId,
    },
    hand: [...player.hand],
    handItems: Object.fromEntries(player.hand.map((iid) => [iid, state.items[iid]?.cardId ?? null])),
    secretObjectiveIds: [...player.secretObjectiveIds],
    exiledObjectiveId: player.exiledObjectiveId,
    crossroads: state.turn ? structuredClone(state.turn) : null,
  };
}

function expectAuthorizedPrivateProof(proof: PrivateProof, targetId: PlayerId): void {
  expect(proof.seat.id).toBe(targetId);
  expect(proof.hand.length).toBeGreaterThan(0);
  expect(proof.hand.every((iid) => !isHidden(iid))).toBe(true);
  expect(Object.values(proof.handItems).every((cardId) => typeof cardId === 'string' && !isHidden(cardId))).toBe(
    true,
  );
  expect(proof.secretObjectiveIds.length).toBeGreaterThan(0);
  expect(proof.secretObjectiveIds.every((cardId) => !isHidden(cardId))).toBe(true);
  expect(proof.crossroads?.crossroadsHolderId).toBe(targetId);
  expect(proof.crossroads?.crossroadsCardId).toBeTruthy();
  expect(isHidden(proof.crossroads?.crossroadsCardId)).toBe(false);
}

function expectCannotSeeTargetPrivateState(view: GameState, targetId: PlayerId, proof: PrivateProof): void {
  const target = view.players[targetId];
  expect(target).toBeDefined();
  expect(target!.hand).toEqual(proof.hand.map((_, i) => `hidden:hand:${targetId}:${i}`));
  expect(target!.secretObjectiveIds).toEqual(proof.secretObjectiveIds.map(() => 'hidden:objective'));
  expect(target!.exiledObjectiveId).toBeNull();
  for (const iid of proof.hand) expect(view.items[iid]).toBeUndefined();

  const payload = JSON.stringify(view);
  for (const cardId of Object.values(proof.handItems)) {
    if (cardId) expect(payload).not.toContain(cardId);
  }
  for (const objectiveId of proof.secretObjectiveIds) {
    expect(payload).not.toContain(objectiveId);
  }
  if (proof.crossroads?.crossroadsCardId) {
    expect(view.turn?.crossroadsCardId).toBe('hidden:crossroads');
    expect(payload).not.toContain(proof.crossroads.crossroadsCardId);
  }
}

describe('Dead of Winter server reconnection', () => {
  let dataDir: string;
  const openClients: TestClient[] = [];
  const openServers: RunningServer[] = [];

  const track = <T extends Seated>(seat: T): T => {
    openClients.push(seat.client);
    return seat;
  };

  const bootDow = async (): Promise<RunningServer> => {
    const server = await boot({ dataDir, registry: dowRegistry() });
    openServers.push(server);
    return server;
  };

  beforeEach(() => {
    dataDir = makeDataDir();
  });

  afterEach(async () => {
    await closeAll(...openClients.splice(0));
    for (const server of openServers.splice(0).reverse()) await server.close();
    removeDataDir(dataDir);
  });

  it('restores the same seat and private DoW hand, objective and crossroads card across reconnect and restart', async () => {
    const first = await bootDow();
    const host = track(
      await createGame(
        first,
        'Ada',
        { playerCount: 3, seed: 'DOW-RECONNECT-E2E', mainObjectiveId: 'mo-stockpile' },
        deadOfWinter.descriptor.key,
      ),
    );
    const grace = track(await joinGame(first, host.code, 'Grace'));
    const linus = track(await joinGame(first, host.code, 'Linus'));
    const seats = [host, grace, linus];

    grace.client.send({ t: 'setReady', ready: true });
    linus.client.send({ t: 'setReady', ready: true });
    await host.client.waitLobby((lobby) => lobby.players.every((player) => player.ready || player.isHost));

    for (const seat of seats) seat.client.clear();
    host.client.send({ t: 'startGame' });
    const views = await driveSetupToFirstTurn(seats);

    const hostView = views.get(host.playerId)!;
    const targetId = hostView.turn!.crossroadsHolderId;
    const target = seats.find((seat) => seat.playerId === targetId)!;
    const nonTarget = seats.find((seat) => seat.playerId !== targetId)!;
    const before = views.get(targetId)!;
    const proof = privateProof(before, targetId);
    expectAuthorizedPrivateProof(proof, targetId);
    expectCannotSeeTargetPrivateState(views.get(nonTarget.playerId)!, targetId, proof);

    const persistedBeforeReconnect = first.store.loadGames().find((record) => record.code === host.code);
    expect((persistedBeforeReconnect?.state as GameState | undefined)?.players[targetId]?.hand).toEqual(proof.hand);
    expect((persistedBeforeReconnect?.state as GameState | undefined)?.turn?.crossroadsCardId).toBe(
      proof.crossroads?.crossroadsCardId,
    );

    await target.client.close();
    await nonTarget.client.waitLobby((lobby) =>
      lobby.players.some((player) => player.id === targetId && !player.connected),
    );

    const sameServerBack = await TestClient.connect(first.wsUrl);
    openClients.push(sameServerBack);
    sameServerBack.send({ t: 'rejoin', sessionToken: target.sessionToken });
    const sameServerWelcome = await sameServerBack.wait('welcome');
    expect(sameServerWelcome.playerId).toBe(targetId);
    expect(sameServerWelcome.sessionToken).toBe(target.sessionToken);
    const sameServerState = (await sameServerBack.waitAnyState<GameState>()).state;
    expect(privateProof(sameServerState, targetId)).toEqual(proof);

    const replacement = await TestClient.connect(first.wsUrl);
    openClients.push(replacement);
    replacement.send({ t: 'joinGame', code: host.code, name: 'Mallory' });
    expect((await replacement.wait('error')).code).toBe('gameStarted');
    expect(replacement.received.some((message) => message.t === 'state')).toBe(false);

    const spectator = await TestClient.connect(first.wsUrl);
    openClients.push(spectator);
    spectator.send({ t: 'hello' });
    expect((await spectator.wait('error')).code).toBe('noSession');
    expect(spectator.received.some((message) => message.t === 'state')).toBe(false);

    const code = host.code;
    const targetToken = target.sessionToken;
    await closeAll(host.client, grace.client, linus.client, sameServerBack, replacement, spectator);
    await first.close();

    const dbPath = path.join(dataDir, 'test.db');
    expect(fs.existsSync(dbPath)).toBe(true);
    expect(fs.statSync(dbPath).size).toBeGreaterThan(0);

    const second = await bootDow();
    const restoredRoom = second.hub.roomByCode(code);
    expect(restoredRoom?.started).toBe(true);
    expect(restoredRoom?.seat(targetId)).toMatchObject({
      playerId: targetId,
      name: proof.seat.name,
      color: proof.seat.color,
    });
    expect(Object.values((restoredRoom?.state as GameState).players).every((player) => !player.connected)).toBe(
      true,
    );

    const afterRestart = await TestClient.connect(second.wsUrl);
    openClients.push(afterRestart);
    afterRestart.send({ t: 'rejoin', sessionToken: targetToken });
    const restartWelcome = await afterRestart.wait('welcome');
    expect(restartWelcome.playerId).toBe(targetId);
    expect(restartWelcome.sessionToken).toBe(targetToken);
    const restartedState = (await afterRestart.waitAnyState<GameState>()).state;
    expect(privateProof(restartedState, targetId)).toEqual(proof);

    const otherBack = await TestClient.connect(second.wsUrl);
    openClients.push(otherBack);
    otherBack.send({ t: 'rejoin', sessionToken: nonTarget.sessionToken });
    expect((await otherBack.wait('welcome')).playerId).toBe(nonTarget.playerId);
    const otherView = (await otherBack.waitAnyState<GameState>()).state;
    expectCannotSeeTargetPrivateState(otherView, targetId, proof);
  });
});
