/**
 * §23 A15 — reconnection, exhaustive redaction, and replay determinism.
 *
 * The fixture setup below is scaffolding only. The behaviours under test go
 * through the public Dead of Winter plugin: createGame, applyAction,
 * migrateState, applyPresence, and redactStateFor.
 */

import { describe, expect, it } from 'vitest';

import { deadOfWinter } from '../../plugin.js';
import type { GameAction, GameState, PlayerId } from '../../types.js';
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
  events: GameState['log'];
  after: ReplayProofPoint;
}

interface ReplayProofPoint {
  phase: GameState['phase'];
  colonyStep: GameState['colonyStep'];
  activePlayerId: GameState['activePlayerId'];
  turn: GameState['turn'];
  rngCursor: number;
  decks: GameState['decks'];
  dice: Record<PlayerId, { unusedDice: number[]; usedDice: number[] }>;
  pendingChoices: GameState['pendingChoices'];
  effectStack: GameState['effectStack'];
  outcome: GameState['outcome'];
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
  const logStart = state.log.length;
  const next = deadOfWinter.applyAction(state, playerId, action, now);
  script.push({
    playerId,
    action: clone(action),
    now,
    events: clone(next.log.slice(logStart)),
    after: replayProofPoint(next),
  });
  return next;
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

function runReplayScenario(seed: string): {
  initial: GameState;
  final: GameState;
  script: RecordedAction[];
  setupActionCount: number;
} {
  const initial = JSON.parse(JSON.stringify(createPluginGame(seed))) as GameState;
  let state = clone(initial);
  const script: RecordedAction[] = [];
  let setupActionCount = 0;
  let guard = 0;
  let theftAttempts = 0;

  while (state.phase !== 'gameOver' && guard++ < 5_000) {
    if (pending(state)) {
      state = answerPending(state, script);
      if (state.phase === 'setup') setupActionCount = script.length;
      else if (setupActionCount === 0) setupActionCount = script.length;
      continue;
    }

    const playerId = deadOfWinter.activePlayerOf(state);
    if (!playerId) break;

    const theftAction = hasEvent(state, 'stealCard') ? undefined : randomTheftAttempt(state, playerId);
    const action = theftAction ?? nextLegalPluginAction(state, playerId);
    if (!action) {
      throw new Error(`replay scenario stalled at ${state.phase}/${state.colonyStep ?? '-'} for ${playerId}`);
    }
    if (action.type === 'attackSurvivor') theftAttempts += 1;
    state = applyRecorded(state, playerId, action, NOW + script.length + 1, script);
  }

  if (guard >= 5_000) throw new Error('replay scenario did not settle');
  if (state.phase !== 'gameOver') throw new Error(`replay scenario ended before game over: ${state.phase}`);
  if (theftAttempts === 0) throw new Error('replay scenario never attempted an authoritative random theft');
  return {
    initial,
    final: state,
    script,
    setupActionCount,
  };
}

function replayProofPoint(state: GameState): ReplayProofPoint {
  return {
    phase: state.phase,
    colonyStep: state.colonyStep,
    activePlayerId: state.activePlayerId,
    turn: clone(state.turn),
    rngCursor: state.rngCursor,
    decks: clone(state.decks),
    dice: Object.fromEntries(
      state.seating.map((playerId) => {
        const player = state.players[playerId]!;
        return [playerId, {
          unusedDice: [...player.unusedDice],
          usedDice: [...player.usedDice],
        }];
      }),
    ),
    pendingChoices: clone(state.pendingChoices),
    effectStack: clone(state.effectStack),
    outcome: clone(state.outcome),
  };
}

function hasEvent(state: GameState, event: string): boolean {
  return state.log.some((entry) => entry.data?.event === event);
}

function randomTheftAttempt(state: GameState, playerId: PlayerId): GameAction | undefined {
  const dice = [...(state.players[playerId]?.unusedDice ?? [])].sort((a, b) => b - a);
  if (dice.length === 0) return undefined;
  const attackers = survivorsOfPlayer(state, playerId);
  const targets = Object.values(state.survivors).filter(
    (survivor) => survivor.controllerId !== playerId && state.players[survivor.controllerId]?.hand.length,
  );

  for (const attacker of attackers) {
    for (const target of targets) {
      for (const die of dice) {
        const action: GameAction = {
          type: 'attackSurvivor',
          survivorId: attacker.id,
          die,
          targetId: target.id,
        };
        if (deadOfWinter.validateAction(state, playerId, action).ok) return action;
      }
    }
  }
  return undefined;
}

function nextLegalPluginAction(state: GameState, playerId: PlayerId): GameAction | undefined {
  const candidates = [
    deadOfWinter.defaultActionFor?.(state, playerId) ?? null,
    ...(deadOfWinter.safeDefaultActions?.(state, playerId) ?? []),
  ];
  for (const action of candidates) {
    if (action && deadOfWinter.validateAction(state, playerId, action).ok) return action;
  }
  return undefined;
}

function replay(initial: GameState, script: readonly RecordedAction[]): GameState {
  let state = clone(initial);
  expect(state.phase).toBe('setup');
  for (const entry of script) {
    const logStart = state.log.length;
    state = deadOfWinter.applyAction(state, entry.playerId, entry.action, entry.now);
    expect(state.log.slice(logStart)).toEqual(entry.events);
    expect(JSON.stringify(replayProofPoint(state))).toBe(JSON.stringify(entry.after));
  }
  return state;
}

function randomEvents(state: GameState) {
  return state.log
    .filter((entry) => [
      'diceRolled',
      'searchDraw',
      'noiseRoll',
      'exposure',
      'survivorAttack',
      'stealCard',
    ].includes(String(entry.data?.event)))
    .map((entry) => ({ event: entry.data?.event, data: entry.data }));
}

function expectReplayIncludesRequiredRandomEvents(state: GameState): void {
  for (const event of ['diceRolled', 'searchDraw', 'noiseRoll', 'exposure', 'survivorAttack', 'stealCard']) {
    expect(state.log.some((entry) => entry.data?.event === event), `missing replay event ${event}`).toBe(true);
  }
  expect(state.log.filter((entry) => entry.data?.event === 'searchDraw').length).toBeGreaterThanOrEqual(2);
  expect(state.outcome, 'terminal replay must evaluate winners').not.toBeNull();
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
  it('replays the complete setup-to-terminal action/event stream to the identical state', () => {
    const first = runReplayScenario('A15-REPLAY');
    const second = replay(JSON.parse(JSON.stringify(first.initial)) as GameState, first.script);

    expect(first.script.length).toBeGreaterThan(8);
    expect(first.initial.phase).toBe('setup');
    expect(first.setupActionCount).toBeGreaterThan(0);
    expect(
      first.script.slice(0, first.setupActionCount).every((entry) => entry.action.type === 'resolveChoice'),
    ).toBe(true);
    expect(first.script.every((entry) => entry.events.length > 0)).toBe(true);
    expect(second).toEqual(first.final);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first.final));
    expect(second.seed).toBe(first.final.seed);
    expect(second.rngCursor).toBe(first.final.rngCursor);
    expect(second.decks).toEqual(first.final.decks);
    expect(replayProofPoint(second).dice).toEqual(replayProofPoint(first.final).dice);
    expect(second.log).toEqual(first.final.log);
    expect(second.effectStack).toEqual(first.final.effectStack);
    expect(second.pendingChoices).toEqual(first.final.pendingChoices);
    expect(JSON.stringify(replayProofPoint(second))).toBe(JSON.stringify(replayProofPoint(first.final)));
    expect(second.phase).toBe('gameOver');
    expect(second.outcome).toEqual(first.final.outcome);
    expect(second.outcome?.winners ?? []).toEqual(first.final.outcome?.winners ?? []);
    expect(second.outcome?.results ?? []).toEqual(first.final.outcome?.results ?? []);

    expect(randomEvents(second)).toEqual(randomEvents(first.final));
    expectReplayIncludesRequiredRandomEvents(first.final);
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
