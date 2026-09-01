import { afterEach, describe, expect, it } from 'vitest';
import { deadOfWinter, type GameState, type PendingChoice } from '@game/dead-of-winter';
import { erase } from '@tt/core';
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
const SEED = 'PROBE-0';
const SEAT_NAMES = ['Ada', 'Grace', 'Linus'] as const;

function firstLegalPicks(choice: PendingChoice): string[] {
  const count = Math.max(1, choice.minPicks ?? 1);
  return choice.options.filter((option) => option.legal).slice(0, count).map((option) => option.id);
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
  );
  if (!choice) throw new Error(`Missing ${kind} choice for ${seat.playerId}`);
  const optionIds = firstLegalPicks(choice);
  if (optionIds.length < Math.max(1, choice.minPicks ?? 1)) {
    throw new Error(`No legal ${kind} option for ${seat.playerId}`);
  }
  seat.client.clear();
  seat.client.send({ t: 'action', action: { type: 'resolveChoice', choiceId: choice.id, optionIds } });
  await seat.client.waitState<GameState>(
    (candidate) => !candidate.pendingChoices.some((pending) => pending.playerId === seat.playerId && pending.kind === kind),
  );
}

function actionType(event: GameAuditEvent): string | undefined {
  if (event.type !== 'action' || event.action === null || typeof event.action !== 'object') return undefined;
  const type = (event.action as { type?: unknown }).type;
  return typeof type === 'string' ? type : undefined;
}

function logEvent(entry: unknown): string {
  if (entry === null || typeof entry !== 'object') return '<invalid-log-entry>';
  const event = (entry as { data?: { event?: unknown } }).data?.event;
  return typeof event === 'string' ? event : '<untyped-log-entry>';
}

function logMessage(entry: unknown): string {
  if (entry === null || typeof entry !== 'object') return '';
  const message = (entry as { message?: unknown }).message;
  return typeof message === 'string' ? message : '';
}

function transitionLogDelta(event: Extract<GameAuditEvent, { type: 'automatic' }>): unknown[] {
  if (event.beforeState === undefined || event.afterState === undefined) return [];
  const before = event.beforeState as GameState;
  const after = event.afterState as GameState;
  if (!Array.isArray(before.log) || !Array.isArray(after.log)) return [];
  return after.log.slice(before.log.length);
}

function describeAutomatic(event: Extract<GameAuditEvent, { type: 'automatic' }>): string {
  const delta = transitionLogDelta(event);
  return `seq=${event.sequence} trigger=${event.trigger} logs=[${delta.map(logEvent).join(',')}] explanation=${JSON.stringify(event.publicExplanation)}`;
}

function normalizePresence(state: GameState): GameState {
  const copy = structuredClone(state);
  for (const player of Object.values(copy.players)) {
    player.connected = false;
    player.lastSeen = 0;
  }
  return copy;
}

describe('strict Dead of Winter A15 audit granularity', () => {
  let dataDir: string | undefined;
  const clients: TestClient[] = [];
  const servers: RunningServer[] = [];

  afterEach(async () => {
    await closeAll(...clients.splice(0));
    for (const server of servers.splice(0).reverse()) await server.close();
    if (dataDir) removeDataDir(dataDir);
    dataDir = undefined;
  });

  it('records each automatic transition from one real player action as its own replayable SQLite event', async () => {
    dataDir = makeDataDir();
    const first = await boot({ dataDir, registry: registry() });
    servers.push(first);

    const host = await createGame(
      first,
      SEAT_NAMES[0],
      { playerCount: 3, seed: SEED, mainObjectiveId: 'mo-stockpile', includeBetrayalObjective: false },
      deadOfWinter.descriptor.key,
    );
    clients.push(host.client);
    const grace = await joinGame(first, host.code, SEAT_NAMES[1]);
    clients.push(grace.client);
    const linus = await joinGame(first, host.code, SEAT_NAMES[2]);
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

    const before = first.store.loadGames().find((record) => record.code === host.code);
    if (!before) throw new Error(`Missing persisted game ${host.code}`);
    const beforeState = before.state as GameState;
    const actorId = beforeState.activePlayerId;
    if (!actorId) throw new Error('Setup did not leave an active player for the automatic-transition probe');
    const actor = seated.find((seat) => seat.playerId === actorId);
    if (!actor) throw new Error(`No WebSocket seat for active player ${actorId}`);
    const priorLogLength = beforeState.log.length;

    actor.client.clear();
    actor.client.send({ t: 'action', action: { type: 'endTurn' } });
    await actor.client.waitState<GameState>((state) => state.log.length > priorLogLength);

    const after = first.store.loadGames().find((record) => record.gameId === before.gameId);
    if (!after) throw new Error(`Game disappeared after action ${before.gameId}`);
    const events = first.store.loadAuditEvents(before.gameId);
    const actionIndex = events.findIndex((event) => event.type === 'action' && actionType(event) === 'endTurn');
    const actionEvent = actionIndex >= 0 ? events[actionIndex] : undefined;
    const automatic = events
      .slice(actionIndex + 1)
      .filter((event): event is Extract<GameAuditEvent, { type: 'automatic' }> => event.type === 'automatic');
    const violations: string[] = [];

    if (actionIndex < 0 || actionEvent?.type !== 'action') {
      violations.push('missing the persisted endTurn action event');
    }

    const sequenceGap = events.find((event, index) => event.sequence !== index + 1);
    if (sequenceGap) {
      violations.push(`sequence is not contiguous at ${sequenceGap.sequence}; observed [${events.map((event) => event.sequence).join(', ')}]`);
    }
    if (after.auditSequence !== events.length) {
      violations.push(`snapshot watermark ${after.auditSequence ?? '<missing>'} does not equal ${events.length} events`);
    }

    if (automatic.length < 2) {
      violations.push(
        `one action exposed only ${automatic.length} automatic audit event(s); expected separate crossroadsDrawn and turnStart transitions`,
      );
    }

    for (let index = 0; index < automatic.length; index += 1) {
      const event = automatic[index]!;
      const delta = transitionLogDelta(event);
      if (event.actor !== 'system') violations.push(`automatic ${event.sequence} actor is ${event.actor}`);
      if (event.beforeState === undefined || event.afterState === undefined) {
        violations.push(`automatic ${event.sequence} is missing its private before/after state`);
      } else {
        if (event.beforeHash !== hashReplayState(event.beforeState)) {
          violations.push(`automatic ${event.sequence} beforeHash does not hash beforeState`);
        }
        if (event.afterHash !== hashReplayState(event.afterState)) {
          violations.push(`automatic ${event.sequence} afterHash does not hash afterState`);
        }
        if (event.beforeHash === event.afterHash) {
          violations.push(`automatic ${event.sequence} has no state delta`);
        }
      }
      if (!event.publicExplanation.trim()) violations.push(`automatic ${event.sequence} has no public explanation`);
      if (index > 0 && automatic[index - 1]!.afterHash !== event.beforeHash) {
        violations.push(
          `automatic ${event.sequence} does not begin at automatic ${automatic[index - 1]!.sequence}'s afterHash`,
        );
      }
    }

    const requiredKinds = ['crossroadsDrawn', 'turnStart'] as const;
    for (const kind of requiredKinds) {
      const matching = automatic.filter((event) => {
        const delta = transitionLogDelta(event);
        return delta.length === 1 && logEvent(delta[0]) === kind;
      });
      if (matching.length !== 1) {
        violations.push(
          `expected exactly one distinct ${kind} automatic record, found ${matching.length}; observed ${automatic.map(describeAutomatic).join(' | ') || '<none>'}`,
        );
        continue;
      }
      const [event] = matching;
      const delta = transitionLogDelta(event);
      const entry = delta[0] as { data?: Record<string, unknown> };
      const afterState = event.afterState as GameState;
      if (event.publicExplanation !== logMessage(entry)) {
        violations.push(
          `automatic ${event.sequence} explanation does not match its own ${kind} transition: expected=${JSON.stringify(logMessage(entry))} observed=${JSON.stringify(event.publicExplanation)}`,
        );
      }
      if (kind === 'crossroadsDrawn') {
        if (!afterState.turn || afterState.turn.crossroadsCardId === null) {
          violations.push(`automatic ${event.sequence} crossroadsDrawn delta did not retain the drawn card in turn state`);
        }
        if (afterState.turn?.crossroadsHolderId !== entry.data?.['holderId']) {
          violations.push(`automatic ${event.sequence} crossroadsDrawn holder delta is inconsistent with turn state`);
        }
      } else if (afterState.activePlayerId !== entry.data?.['playerId'] || afterState.turn?.playerId !== entry.data?.['playerId']) {
        violations.push(`automatic ${event.sequence} turnStart delta is inconsistent with active-player state`);
      }
    }

    let replayed: GameState | undefined;
    try {
      replayed = replayPersistedGame(deadOfWinter, after, events) as GameState;
    } catch (error) {
      violations.push(`replay threw: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (replayed && JSON.stringify(normalizePresence(replayed)) !== JSON.stringify(normalizePresence(after.state as GameState))) {
      violations.push('replay result differs from the persisted final state');
    }

    const observed = automatic.map(describeAutomatic).join('\n');
    expect(violations, `Strict A15 audit-granularity evidence:\n${observed || '<no automatic events>'}`).toEqual([]);
  });
});
