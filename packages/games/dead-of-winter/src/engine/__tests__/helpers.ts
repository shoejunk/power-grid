/**
 * Shared test scaffolding for the Dead of Winter engine. Not a test file itself.
 *
 * Every suite in this directory builds on these helpers so that a game reaches a
 * known, deterministic position the same way each time. Two rules keep them
 * trustworthy:
 *
 *  1. Nothing here encodes an expectation. A helper drives the engine and reads
 *     state back; it never asserts a rule. If a helper decided what "correct"
 *     looked like, every suite using it would inherit that opinion and the tests
 *     would agree with each other rather than with the spec.
 *  2. Helpers that reach into state directly (`grantItem`, `setMorale`, …) are
 *     labelled as scaffolding. They bypass the rules deliberately, to set up a
 *     position that would otherwise take fifty legal actions to reach. They must
 *     never be used to produce the behaviour under test.
 */

import type { CreateGameContext, SeatSeed } from '@tt/core';

import { TEST_PACK } from '../../content/testPack.js';
import type { CardId, CardInstanceId, NonColonyLocationId } from '../../content/primitives.js';
import type {
  GameAction,
  GameSettings,
  GameState,
  LocationId,
  PendingChoice,
  PlayerId,
  SurvivorInstance,
  SurvivorInstanceId,
} from '../../types.js';
import { applyAction, createGame } from '../index.js';
import { registerContentPack } from '../state.js';

/** Every suite shares one registered fixture; registration is idempotent. */
export const PACK = registerContentPack(TEST_PACK);

export const NOW = 1_000;

/** The five seat colours from `descriptor.ts`, in order. */
const COLORS = ['ember', 'frost', 'moss', 'rust', 'violet'] as const;

export function seats(n: number): SeatSeed[] {
  return Array.from({ length: n }, (_, i) => ({
    playerId: `p${i + 1}`,
    name: `P${i + 1}`,
    color: COLORS[i % COLORS.length]!,
    isBot: false,
  }));
}

export interface GameOpts {
  playerCount?: number;
  seed?: string;
  settings?: Partial<GameSettings>;
}

export function settingsFor(opts: GameOpts = {}): GameSettings {
  const playerCount = opts.playerCount ?? 4;
  return {
    seed: opts.seed ?? 'SEED-ALPHA',
    playerCount,
    mode: 'standard',
    hardcore: false,
    betrayerVariant: false,
    playerElimination: false,
    includeBetrayalObjective: true,
    matureContentFilter: false,
    mainObjectiveId: null,
    prisonersDilemma: {
      roundZeroEndsLikeMoraleZero: true,
      keepNonCooperativeCards: false,
      removeExileDependentContent: true,
    },
    ...opts.settings,
  };
}

export function contextFor(opts: GameOpts = {}): CreateGameContext {
  return {
    gameId: 'g-test',
    code: 'CODE01',
    hostId: 'p1',
    seed: opts.seed ?? 'SEED-ALPHA',
    now: NOW,
  };
}

/**
 * A game at `setupStage: 'keepSurvivors'` — created, dealt, waiting on humans.
 * Use this to test setup itself; use `start()` to test anything later.
 */
export function fresh(opts: GameOpts = {}): GameState {
  const settings = settingsFor(opts);
  return createGame(contextFor(opts), settings, seats(settings.playerCount), PACK);
}

export function act(
  state: GameState,
  playerId: PlayerId,
  action: GameAction,
  now = NOW,
): GameState {
  return applyAction(state, playerId, action, now);
}

/** Answers one pending choice by option id. */
export function choose(
  state: GameState,
  playerId: PlayerId,
  choiceId: string,
  optionIds: string[],
  now = NOW,
): GameState {
  return act(state, playerId, { type: 'resolveChoice', choiceId, optionIds }, now);
}

/** The choice at the head of the queue, or `undefined` if the game is not blocked. */
export function pending(state: GameState): PendingChoice | undefined {
  return state.pendingChoices[0];
}

/** The first pending choice addressed to `playerId`. */
export function pendingFor(state: GameState, playerId: PlayerId): PendingChoice | undefined {
  return state.pendingChoices.find((c) => c.playerId === playerId);
}

/**
 * Answers the head choice by taking the first `minPicks` legal options.
 *
 * Deliberately dumb: it makes no attempt to choose well. A test that needs a
 * particular option must name it via `choose`.
 */
export function answerFirstLegal(state: GameState, now = NOW): GameState {
  const choice = pending(state);
  if (!choice) throw new Error('answerFirstLegal(): no pending choice');
  const legal = choice.options.filter((o) => o.legal);
  const picks = Math.max(1, choice.minPicks ?? 1);
  if (legal.length < picks) {
    throw new Error(
      `answerFirstLegal(): choice '${choice.kind}' needs ${picks} legal options, has ${legal.length}`,
    );
  }
  const actor = choice.playerId ?? state.seating[0]!;
  return choose(state, actor, choice.id, legal.slice(0, picks).map((o) => o.id), now);
}

/**
 * Drives §4 setup to completion, keeping the first survivors dealt and naming
 * the first as leader. Returns a game in `playerTurns`, round 1.
 */
export function start(opts: GameOpts = {}): GameState {
  let s = fresh(opts);
  let guard = 0;
  while (s.phase === 'setup') {
    if (guard++ > 200) throw new Error(`start(): stuck in setup stage '${s.setupStage}'`);
    s = answerFirstLegal(s);
  }
  return s;
}

/* ------------------------------------------------------------------ *
 * Reading state
 * ------------------------------------------------------------------ */

export function survivorsOfPlayer(state: GameState, playerId: PlayerId): SurvivorInstance[] {
  return Object.values(state.survivors).filter((s) => s.controllerId === playerId);
}

export function survivorsAt(state: GameState, location: LocationId): SurvivorInstance[] {
  return Object.values(state.survivors).filter((s) => s.location === location);
}

/** Total zombies standing at a location, across every entrance. */
export function zombiesAt(state: GameState, location: LocationId): number {
  if (location === 'colony') {
    return state.colony.entrances.reduce((n, e) => n + e.zombies, 0);
  }
  return state.locations[location]?.entrance.zombies ?? 0;
}

export function barricadesAt(state: GameState, location: LocationId): number {
  if (location === 'colony') {
    return state.colony.entrances.reduce((n, e) => n + e.barricades, 0);
  }
  return state.locations[location]?.entrance.barricades ?? 0;
}

export function logEvents(state: GameState, event: string) {
  return state.log.filter((l) => (l.data as { event?: string } | undefined)?.event === event);
}

export function lastLogEvent(state: GameState, event: string) {
  const all = logEvents(state, event);
  return all[all.length - 1];
}

/** Every distinct `data.event` in the log, in order. Useful for ordering assertions. */
export function eventSequence(state: GameState): string[] {
  return state.log
    .map((l) => (l.data as { event?: string } | undefined)?.event)
    .filter((e): e is string => typeof e === 'string');
}

/* ------------------------------------------------------------------ *
 * Scaffolding — bypasses the rules on purpose
 * ------------------------------------------------------------------ */

/**
 * Forces `playerId`'s unused dice to exactly `values`.
 *
 * Dice are rolled from the seeded stream, so a test that needs a 5 cannot ask
 * for one legally. Mutates in place; call on a state you own.
 */
export function setDice(state: GameState, playerId: PlayerId, values: number[]): void {
  state.players[playerId]!.unusedDice = [...values];
}

/** Mints an item instance of `cardId` into `playerId`'s hand and returns its id. */
export function grantItem(state: GameState, playerId: PlayerId, cardId: CardId): CardInstanceId {
  const iid = `test-item-${state.nextSeq++}` as CardInstanceId;
  state.items[iid] = { iid, cardId, usedThisTurn: [], usedThisRound: [], usedThisGame: [] };
  state.players[playerId]!.hand.push(iid);
  return iid;
}

/** Moves a survivor without spending a move or rolling exposure. */
export function placeSurvivor(
  state: GameState,
  survivorId: SurvivorInstanceId,
  location: LocationId,
): void {
  state.survivors[survivorId]!.location = location;
}

/** Stands `count` zombies at `location`, filling entrances in order. */
export function addZombies(state: GameState, location: LocationId, count: number): void {
  let left = count;
  const entrances =
    location === 'colony'
      ? state.colony.entrances
      : [state.locations[location as NonColonyLocationId]!.entrance];
  for (const e of entrances) {
    while (left > 0 && e.zombies + e.barricades < e.capacity) {
      e.zombies += 1;
      left -= 1;
    }
  }
  if (left > 0) throw new Error(`addZombies(): ${location} has no room for ${left} more`);
}

export function setMorale(state: GameState, morale: number): void {
  state.colony.morale = morale;
}
