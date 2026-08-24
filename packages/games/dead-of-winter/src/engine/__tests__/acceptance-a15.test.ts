/**
 * §23 A15 — reconnection, exhaustive redaction, and replay determinism.
 *
 * The fixture setup below is scaffolding only. The behaviours under test go
 * through the public Dead of Winter plugin: createGame, applyAction,
 * migrateState, applyPresence, and redactStateFor.
 */

import { describe, expect, it } from 'vitest';
import { Rng } from '@tt/core';

import { deadOfWinter } from '../../plugin.js';
import type { GameAction, GameState, PlayerId } from '../../types.js';
import { NON_COLONY_LOCATIONS } from '../../content/primitives.js';
import { contentOf } from '../index.js';
import {
  contextFor,
  NOW,
  pending,
  seats,
  settingsFor,
  survivorsOfPlayer,
} from './helpers.js';

interface RecordedAction {
  playerId: PlayerId;
  action: GameAction;
  now: number;
}

interface TokenHit {
  path: string;
  token: string;
  kind: 'key' | 'value';
}

interface RedactionFixture {
  state: GameState;
  privateIdentities: Record<PlayerId, string[]>;
  crisisIdentities: string[];
  crossroadId: string;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Walk keys and values, rather than checking a list of expected fields. */
function deepTokens(value: unknown, path = '$'): TokenHit[] {
  if (typeof value === 'string') return [{ path, token: value, kind: 'value' }];
  if (Array.isArray(value)) {
    return value.flatMap((child, index) => deepTokens(child, `${path}[${index}]`));
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => [
      { path: `${path}.{${key}}`, token: key, kind: 'key' as const },
      ...deepTokens(child, `${path}.${key}`),
    ]);
  }
  return [];
}

function containsIdentity(view: unknown, identity: string): TokenHit[] {
  const escaped = identity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const token = new RegExp(`(^|[^A-Za-z0-9_-])${escaped}($|[^A-Za-z0-9_-])`);
  return deepTokens(view).filter(({ token: candidate }) => token.test(candidate));
}

function expectIdentityVisible(view: unknown, identity: string): void {
  expect(
    containsIdentity(view, identity),
    `expected authorized identity '${identity}' in the serialized view`,
  ).not.toEqual([]);
}

function expectIdentityHidden(view: unknown, identity: string): void {
  expect(
    containsIdentity(view, identity),
    `found unauthorized identity '${identity}' in the serialized view`,
  ).toEqual([]);
  expect(JSON.stringify(view)).not.toContain(`"${identity}"`);
}

function createPluginGame(seed: string): GameState {
  const settings = settingsFor({
    playerCount: 4,
    seed,
    settings: { mainObjectiveId: 'mo-stockpile' },
  });
  return deadOfWinter.createGame(contextFor({ seed }), settings, seats(4));
}

function applyRecorded(
  state: GameState,
  playerId: PlayerId,
  action: GameAction,
  now: number,
  script: RecordedAction[],
): GameState {
  script.push({ playerId, action: clone(action), now });
  return deadOfWinter.applyAction(state, playerId, action, now);
}

function answerPending(
  state: GameState,
  script: RecordedAction[],
): GameState {
  const choice = pending(state);
  if (!choice) return state;
  const legal = choice.options.filter((option) => option.legal);
  const picks = Math.max(1, choice.minPicks ?? 1);
  if (legal.length < picks) throw new Error(`No legal answer for ${choice.kind}`);
  const noise = choice.kind === 'searchDecision'
    ? legal.find((option) => option.id === 'noise' && state.search?.noisePlaced === 0)
    : undefined;
  const selected = noise ? [noise] : legal.slice(0, picks);
  const actor = choice.playerId ?? state.seating[0]!;
  return applyRecorded(
    state,
    actor,
    {
      type: 'resolveChoice',
      choiceId: choice.id,
      optionIds: selected.map((option) => option.id),
    },
    NOW,
    script,
  );
}

function setupComplete(seed: string): GameState {
  let state = createPluginGame(seed);
  const setupScript: RecordedAction[] = [];
  while (state.phase === 'setup') state = answerPending(state, setupScript);
  return state;
}

/** Find a cursor that makes the theft hit and the next arrival exposure blank. */
function cursorForReplayFixture(
  state: GameState,
  targetThreshold: number,
  victimHandSize: number,
): number {
  for (let cursor = state.rngCursor; cursor < state.rngCursor + 100_000; cursor++) {
    const rng = new Rng(state.seed, cursor);
    if (rng.die(6) > targetThreshold) continue;
    rng.pick(Array.from({ length: victimHandSize }));
    if (rng.die(6) <= 3) return cursor;
  }
  throw new Error('Could not find a deterministic replay fixture cursor');
}

function prepareReplayFixture(state: GameState): GameState {
  const playerId = state.turn!.playerId;
  const targetPlayerId = state.seating.find((id) => id !== playerId)!;
  const target = survivorsOfPlayer(state, targetPlayerId)[0]!;
  const targetThreshold = contentOf(state).survivors.get(target.cardId)!.attackThreshold;

  // The first action is a real random theft. The following move is a real
  // arrival exposure; the cursor search keeps both paths alive and settled.
  state.players[playerId]!.unusedDice = [6, 5, 4];
  state.turn!.crossroadsCardId = null;
  state.turn!.crossroadsTriggered = true;
  state.rngCursor = cursorForReplayFixture(
    state,
    targetThreshold,
    state.players[targetPlayerId]!.hand.length,
  );

  // This is the persisted initial state for the action log, deliberately
  // round-tripped before any recorded action is applied.
  return JSON.parse(JSON.stringify(state)) as GameState;
}

function preparedReplayState(seed: string): GameState {
  return prepareReplayFixture(setupComplete(seed));
}

function runReplayScenario(seed: string): {
  initial: GameState;
  setupEnd: GameState;
  prepared: GameState;
  final: GameState;
  script: RecordedAction[];
  setupActionCount: number;
} {
  const initial = JSON.parse(JSON.stringify(createPluginGame(seed))) as GameState;
  let state = clone(initial);
  const script: RecordedAction[] = [];
  while (state.phase === 'setup') state = answerPending(state, script);
  const setupActionCount = script.length;
  const setupEnd = clone(state);
  state = prepareReplayFixture(state);
  const prepared = clone(state);
  let turns = 0;
  let guard = 0;
  let theftDone = false;

  while (state.phase !== 'gameOver' && turns < 14 && guard++ < 1_000) {
    if (pending(state)) {
      state = answerPending(state, script);
      continue;
    }
    if (!state.turn) break;

    const playerId = state.turn.playerId;
    const mine = survivorsOfPlayer(state, playerId);
    if (!theftDone) {
      const targetPlayerId = state.seating.find((id) => id !== playerId)!;
      const attacker = mine.find((survivor) => survivor.location === 'colony');
      const target = survivorsOfPlayer(state, targetPlayerId).find(
        (survivor) => survivor.location === 'colony',
      );
      const action: GameAction | undefined = attacker && target
        ? { type: 'attackSurvivor', survivorId: attacker.id, die: 6, targetId: target.id }
        : undefined;
      if (!action || !deadOfWinter.validateAction(state, playerId, action).ok) {
        throw new Error('replay fixture could not perform its random theft');
      }
      state = applyRecorded(state, playerId, action, NOW, script);
      theftDone = true;
      continue;
    }
    const destination = NON_COLONY_LOCATIONS[turns % NON_COLONY_LOCATIONS.length]!;
    const mover = mine.find((survivor) =>
      deadOfWinter.validateAction(state, playerId, {
        type: 'moveSurvivor',
        survivorId: survivor.id,
        to: destination,
      }).ok,
    );
    if (mover) {
      state = applyRecorded(
        state,
        playerId,
        { type: 'moveSurvivor', survivorId: mover.id, to: destination },
        NOW,
        script,
      );
      continue;
    }

    const die = [...(state.players[playerId]?.unusedDice ?? [])].sort((a, b) => b - a)[0];
    const searcher = die === undefined
      ? undefined
      : mine.find((survivor) =>
          deadOfWinter.validateAction(state, playerId, {
            type: 'search',
            survivorId: survivor.id,
            die,
          }).ok,
        );
    if (searcher && die !== undefined) {
      state = applyRecorded(state, playerId, { type: 'search', survivorId: searcher.id, die }, NOW, script);
      continue;
    }

    state = applyRecorded(state, playerId, { type: 'endTurn' }, NOW, script);
    turns += 1;
  }

  if (guard >= 1_000) throw new Error('replay scenario did not settle');
  return {
    initial,
    setupEnd,
    prepared,
    final: state,
    script,
    setupActionCount,
  };
}

function replay(
  initial: GameState,
  script: readonly RecordedAction[],
  prepareAfterSetup = false,
): GameState {
  let state = clone(initial);
  let prepared = false;
  for (const entry of script) {
    state = deadOfWinter.applyAction(state, entry.playerId, entry.action, entry.now);
    if (prepareAfterSetup && !prepared && state.phase !== 'setup') {
      state = prepareReplayFixture(state);
      prepared = true;
    }
  }
  return state;
}

function itemIdentities(state: GameState, iid: string): string[] {
  const item = state.items[iid];
  if (!item) throw new Error(`fixture item '${iid}' is missing`);
  return [iid, item.cardId];
}

function hiddenDeckIdentities(state: GameState): string[] {
  return [
    ...state.decks.starterItems,
    ...state.decks.survivors,
    ...state.decks.crossroads,
    ...state.decks.crisis,
    ...state.decks.exiledObjectives,
    ...state.decks.returnedToBox.items,
    ...state.decks.returnedToBox.survivors,
    ...state.decks.returnedToBox.objectives,
    ...Object.values(state.locations).flatMap((location) => location.deck),
  ];
}

function publicItemIids(state: GameState): Set<string> {
  return new Set([
    ...state.colony.waste,
    ...state.mainObjective.contributions,
    ...state.decks.removedFromGame.items,
    ...Object.values(state.survivors).flatMap((survivor) => survivor.equipped),
  ]);
}

function authorizedItemIids(state: GameState, viewerId: PlayerId | null): Set<string> {
  const visible = publicItemIids(state);
  if (viewerId && state.players[viewerId]) {
    for (const iid of state.players[viewerId]!.hand) visible.add(iid);
  }
  if (viewerId && state.search?.playerId === viewerId) {
    for (const iid of state.search.drawn) visible.add(iid);
  }
  return visible;
}

function normalizeConnected(state: GameState): GameState {
  const normalized = clone(state);
  for (const player of Object.values(normalized.players)) player.connected = false;
  return normalized;
}

function makeRedactionFixture(): RedactionFixture {
  const state = createPluginGame('A15-REDACTION');
  let settled = clone(state);
  const setupScript: RecordedAction[] = [];
  while (settled.phase === 'setup') settled = answerPending(settled, setupScript);

  const privateIdentities: Record<PlayerId, string[]> = Object.fromEntries(
    settled.seating.map((playerId) => [playerId, [...settled.players[playerId]!.secretObjectiveIds]]),
  );

  for (const playerId of settled.seating) {
    const hand = settled.players[playerId]!.hand;
    privateIdentities[playerId]!.push(...hand.flatMap((iid) => itemIdentities(settled, iid)));
  }

  const searchIid = settled.players.p1!.hand.shift()!;
  const crisisIid = settled.players.p2!.hand.shift()!;
  const searchSurvivor = survivorsOfPlayer(settled, 'p1')[0]!;
  settled.search = {
    playerId: 'p1',
    survivorId: searchSurvivor.id,
    location: 'grocery-store',
    drawn: [searchIid],
    noisePlaced: 1,
  };
  privateIdentities.p1!.push(...itemIdentities(settled, searchIid));

  settled.crisis.contributions = [{ playerId: 'p2', iid: crisisIid }];
  const crisisIdentities = itemIdentities(settled, crisisIid);
  privateIdentities.p2 = privateIdentities.p2!.filter(
    (identity) => !crisisIdentities.includes(identity),
  );

  const crossroadId = settled.decks.crossroads[0]!;
  settled.decks.crossroads = settled.decks.crossroads.slice(1);
  settled.turn!.crossroadsHolderId = 'p1';
  settled.turn!.crossroadsCardId = crossroadId;
  settled.turn!.crossroadsTriggered = false;
  privateIdentities.p1!.push(crossroadId);

  const exiledObjectiveId = settled.decks.exiledObjectives[0]!;
  settled.decks.exiledObjectives = settled.decks.exiledObjectives.slice(1);
  settled.players.p2!.exiledObjectiveId = exiledObjectiveId;
  privateIdentities.p2!.push(exiledObjectiveId);

  settled.pendingChoices = [{
    id: 'a15-private-choice',
    kind: 'searchDecision',
    playerId: 'p1',
    prompt: `Choose privately from ${searchIid}`,
    options: [
      { id: 'keep-private', label: settled.items[searchIid]!.cardId, legal: true },
      { id: 'discard-private', label: settled.players.p1!.secretObjectiveIds[0]!, legal: true },
    ],
    private: true,
    data: { hiddenCardId: settled.items[searchIid]!.cardId },
  }];
  settled.log.push({
    id: settled.nextSeq++,
    round: settled.round,
    phase: settled.phase,
    category: 'card',
    playerId: 'p1',
    message: `Private card ${settled.items[searchIid]!.cardId}`,
    data: { event: 'privateCard', cardId: settled.items[searchIid]!.cardId },
    at: NOW,
    audience: ['p1'],
  });

  return { state: settled, privateIdentities, crisisIdentities, crossroadId };
}

describe('§23 A15 — replay determinism', () => {
  it('replays the same seed and full action log to the identical state and random outcome', () => {
    const first = runReplayScenario('A15-REPLAY');
    const second = replay(
      JSON.parse(JSON.stringify(first.initial)) as GameState,
      first.script,
      true,
    );

    expect(first.script.length).toBeGreaterThan(8);
    expect(first.initial.phase).toBe('setup');
    expect(first.setupActionCount).toBeGreaterThan(0);
    expect(first.script.slice(0, first.setupActionCount).every((entry) => entry.action.type === 'resolveChoice')).toBe(true);
    expect(first.setupEnd.rngCursor).toBeGreaterThanOrEqual(first.initial.rngCursor);
    expect(first.prepared.rngCursor).toBeGreaterThanOrEqual(first.setupEnd.rngCursor);
    expect(second).toEqual(first.final);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first.final));
    expect(second.seed).toBe(first.final.seed);
    expect(second.rngCursor).toBe(first.final.rngCursor);
    expect(second.decks).toEqual(first.final.decks);
    expect(second.log).toEqual(first.final.log);
    expect(second.effectStack).toEqual(first.final.effectStack);
    expect(second.outcome?.winners ?? []).toEqual(first.final.outcome?.winners ?? []);

    const randomEvents = (state: GameState) =>
      state.log
        .filter((entry) => [
          'diceRolled',
          'searchDraw',
          'noiseRoll',
          'exposure',
          'stealCard',
        ].includes(String(entry.data?.event)))
        .map((entry) => ({ event: entry.data?.event, data: entry.data }));
    expect(randomEvents(second)).toEqual(randomEvents(first.final));
    expect(first.final.log.some((entry) => entry.data?.event === 'diceRolled')).toBe(true);
    expect(first.final.log.filter((entry) => entry.data?.event === 'searchDraw').length).toBeGreaterThanOrEqual(2);
    expect(first.final.log.some((entry) => entry.data?.event === 'noiseRoll')).toBe(true);
    expect(first.final.log.some((entry) => entry.data?.event === 'exposure')).toBe(true);
    expect(first.final.log.some((entry) => entry.data?.event === 'stealCard')).toBe(true);
  });

  it('replays a terminal winner evaluation after the same seeded random setup', () => {
    const terminalInitial = preparedReplayState('A15-WINNER');
    if (terminalInitial.phase !== 'playerTurns' || !terminalInitial.turn) {
      throw new Error('winner fixture did not leave a live turn');
    }
    terminalInitial.colony.morale = 0;
    const action: RecordedAction = {
      playerId: terminalInitial.turn.playerId,
      action: { type: 'endTurn' },
      now: NOW,
    };
    const firstTerminal = deadOfWinter.applyAction(
      terminalInitial,
      action.playerId,
      action.action,
      action.now,
    );
    const replayedTerminal = replay(terminalInitial, [action]);

    expect(firstTerminal).toEqual(replayedTerminal);
    expect(firstTerminal.phase).toBe('gameOver');
    expect(firstTerminal.outcome).not.toBeNull();
    expect(firstTerminal.outcome!.winners).toEqual(replayedTerminal.outcome!.winners);
    expect(firstTerminal.outcome!.results).toEqual(replayedTerminal.outcome!.results);
  });
});

describe('§23 A15 — engine/plugin authentication boundary', () => {
  it('does not claim socket authentication: the server must bind auth to playerId', () => {
    const pluginSurface = deadOfWinter as unknown as Record<string, unknown>;

    // This suite has no server socket or session-token authority. The plugin
    // exposes persistence, presence, and per-player redaction hooks, but it
    // intentionally does not authenticate the playerId supplied to them.
    expect(pluginSurface.authenticatePlayer).toBeUndefined();
    expect(pluginSurface.reconnect).toBeUndefined();
    expect(typeof pluginSurface.migrateState).toBe('function');
    expect(typeof pluginSurface.applyPresence).toBe('function');
    expect(typeof pluginSurface.redactStateFor).toBe('function');
  });
});

describe('§23 A15 — whole-view redaction for every recipient', () => {
  it('deep-walks each serialized player and spectator view without hidden identities', () => {
    const fixture = makeRedactionFixture();
    const viewers: Array<PlayerId | null> = [...fixture.state.seating, null];
    const hiddenDeckTokens = hiddenDeckIdentities(fixture.state);

    for (const viewerId of viewers) {
      const view = deadOfWinter.redactStateFor(fixture.state, viewerId);
      const serialized = JSON.stringify(view);
      expect(serialized).not.toContain(fixture.state.seed);
      expect(serialized).not.toContain(`"${fixture.state.seed}"`);
      expect(view.rngCursor).toBe(0);

      for (const identity of hiddenDeckTokens) expectIdentityHidden(view, identity);

      const authorized = authorizedItemIids(fixture.state, viewerId);
      expect(Object.keys(view.items).sort()).toEqual([...authorized].sort());
      const visibleCardIds = new Set(
        [...authorized]
          .map((iid) => fixture.state.items[iid]?.cardId)
          .filter((cardId): cardId is string => cardId !== undefined),
      );
      for (const [iid, item] of Object.entries(fixture.state.items)) {
        if (authorized.has(iid)) continue;
        expectIdentityHidden(view, iid);
        if (!visibleCardIds.has(item.cardId)) expectIdentityHidden(view, item.cardId);
      }

      for (const [ownerId, identities] of Object.entries(fixture.privateIdentities)) {
        for (const identity of identities) {
          if (viewerId === ownerId) expectIdentityVisible(view, identity);
          else expectIdentityHidden(view, identity);
        }
      }
      for (const identity of fixture.crisisIdentities) expectIdentityHidden(view, identity);
      if (viewerId === 'p1') expectIdentityVisible(view, fixture.crossroadId);
      else expectIdentityHidden(view, fixture.crossroadId);

      // These assertions exercise the less obvious serialized containers that
      // a field-by-field test can omit: item registry, private choice labels,
      // private choice data, and audience-scoped log entries.
      expect(view.items).toBeDefined();
      expect(view.pendingChoices).toHaveLength(1);
      if (viewerId === 'p1') {
        expect(view.pendingChoices[0]!.options[0]!.label).not.toBe('?');
        expect(view.log.some((entry) => entry.data?.event === 'privateCard')).toBe(true);
      } else {
        expect(view.pendingChoices[0]!.options.every((option) => option.label === '?')).toBe(true);
        expect(view.log.some((entry) => entry.data?.event === 'privateCard')).toBe(false);
      }
    }
  });
});

describe('§23 A15 — reconnection through the plugin boundary', () => {
  it('restores a serialized in-progress state and returns private data only to its owner', () => {
    const fixture = makeRedactionFixture();
    const persisted = JSON.parse(JSON.stringify(fixture.state)) as unknown;
    const reconnected = deadOfWinter.migrateState?.(persisted);
    expect(reconnected).not.toBeNull();

    deadOfWinter.applyPresence?.(reconnected!, { p1: false, p2: true, p3: true, p4: true }, NOW + 1);
    expect(normalizeConnected(reconnected!)).toEqual(normalizeConnected(fixture.state));
    deadOfWinter.applyPresence?.(reconnected!, { p1: true, p2: true, p3: true, p4: true }, NOW + 2);

    expect(reconnected!.players.p1!.connected).toBe(true);
    expect(normalizeConnected(reconnected!)).toEqual(normalizeConnected(fixture.state));
    expect(reconnected!.survivors).toEqual(fixture.state.survivors);
    expect(reconnected!.items).toEqual(fixture.state.items);
    expect(reconnected!.decks).toEqual(fixture.state.decks);
    expect(reconnected!.players).toEqual(fixture.state.players);
    expect(reconnected!.turn).toEqual(fixture.state.turn);
    expect(reconnected!.pendingChoices).toEqual(fixture.state.pendingChoices);
    expect(reconnected!.search).toEqual(fixture.state.search);
    expect(reconnected!.effectStack).toEqual(fixture.state.effectStack);

    const ownerView = deadOfWinter.redactStateFor(reconnected!, 'p1');
    const replacementView = deadOfWinter.redactStateFor(reconnected!, 'p2');
    const spectatorView = deadOfWinter.redactStateFor(reconnected!, null);
    expect(ownerView).toEqual(deadOfWinter.redactStateFor(fixture.state, 'p1'));
    expect(replacementView).toEqual(deadOfWinter.redactStateFor(fixture.state, 'p2'));
    expect(spectatorView).toEqual(deadOfWinter.redactStateFor(fixture.state, null));
    for (const identity of fixture.privateIdentities.p1!) expectIdentityVisible(ownerView, identity);
    for (const identity of fixture.privateIdentities.p1!) {
      expectIdentityHidden(replacementView, identity);
      expectIdentityHidden(spectatorView, identity);
    }
    for (const identity of fixture.crisisIdentities) {
      expectIdentityHidden(ownerView, identity);
      expectIdentityHidden(replacementView, identity);
      expectIdentityHidden(spectatorView, identity);
    }
  });
});
