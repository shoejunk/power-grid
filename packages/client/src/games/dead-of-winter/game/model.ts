/**
 * Everything the match screen derives from a state frame.
 *
 * The important idea in this file is `probe`. The rules engine ships in the
 * client bundle, and `validateAction` is a pure function of state — so instead
 * of the UI re-implementing "may I attack with a 3?" (and drifting from the
 * server the first time a rule changes), it *asks the engine* about a candidate
 * action and renders the answer. An illegal action is therefore never hidden:
 * it is offered disabled, carrying the engine's own sentence about why, which
 * is what §10's "offered as illegal rather than hidden" asks for and what the
 * quality bar asks for everywhere else.
 *
 * The catch, and it is the only one: the client probes against the *redacted*
 * view. Anything the viewer cannot see — another player's hand, a deck's
 * order — the engine cannot judge from here either. That is fine for the moves
 * this UI actually offers, which are all the viewer's own, and the server
 * re-validates every one of them against the true state anyway.
 */

import {
  COLONY,
  deadOfWinter,
  NON_COLONY_LOCATIONS,
  type ColonyStep,
  type EntranceState,
  type GameAction,
  type GameState,
  type LocationId,
  type PendingChoice,
  type PlayerState,
  type SurvivorInstance,
} from '@game/dead-of-winter';
import type { PlayerId } from '@tt/core';

export type Legality = { ok: true } | { ok: false; reason: string };

const LEGAL: Legality = { ok: true };

/**
 * Asks the rules engine whether an action would be accepted right now.
 *
 * Guarded, because `validateAction` reaches for entities by id and throws on an
 * id the redacted view does not carry. A throw here means "the client cannot
 * tell", which for an affordance is the same as "no".
 */
export function probe(
  state: GameState,
  playerId: PlayerId | null,
  action: GameAction,
): Legality {
  if (!playerId) return { ok: false, reason: 'You are watching this table.' };
  try {
    const verdict = deadOfWinter.validateAction(state, playerId, action);
    return verdict.ok ? LEGAL : { ok: false, reason: verdict.reason };
  } catch {
    return { ok: false, reason: 'That is not available right now.' };
  }
}

/* ------------------------------------------------------------------ *
 * Who and what
 * ------------------------------------------------------------------ */

export const playerOf = (state: GameState, id: PlayerId | null): PlayerState | null =>
  id ? (state.players[id] ?? null) : null;

export const seatedPlayers = (state: GameState): PlayerState[] =>
  state.seating.map((id) => state.players[id]).filter((p): p is PlayerState => p !== undefined);

export const survivorsAt = (state: GameState, location: LocationId): SurvivorInstance[] =>
  Object.values(state.survivors).filter((s) => s.location === location);

export const survivorsOf = (state: GameState, playerId: PlayerId | null): SurvivorInstance[] =>
  playerId ? Object.values(state.survivors).filter((s) => s.controllerId === playerId) : [];

export const isMyTurn = (state: GameState, me: PlayerId | null): boolean =>
  me !== null && state.phase === 'playerTurns' && state.turn?.playerId === me;

/** The decision this browser is being asked for, if any. */
export const myChoice = (state: GameState, me: PlayerId | null): PendingChoice | null =>
  me === null ? null : (state.pendingChoices.find((c) => c.playerId === me) ?? null);

/** A vote this browser may still commit to (§15: one commitment, never changed). */
export function myOpenVote(state: GameState, me: PlayerId | null): boolean {
  const vote = state.vote;
  if (!vote || me === null) return false;
  return vote.electorate.includes(me) && vote.votes[me] === undefined;
}

/** The decision the *table* is waiting on, whoever it belongs to. */
export const tableChoice = (state: GameState): PendingChoice | null =>
  state.pendingChoices[0] ?? null;

/* ------------------------------------------------------------------ *
 * Board
 * ------------------------------------------------------------------ */

export const entrancesOf = (state: GameState, location: LocationId): EntranceState[] =>
  location === COLONY
    ? state.colony.entrances
    : ((state.locations[location]?.entrance ? [state.locations[location]!.entrance] : []));

export const zombiesAt = (state: GameState, location: LocationId): number =>
  entrancesOf(state, location).reduce((sum, e) => sum + e.zombies, 0);

export const barricadesAt = (state: GameState, location: LocationId): number =>
  entrancesOf(state, location).reduce((sum, e) => sum + e.barricades, 0);

export const entranceFree = (entrance: EntranceState): number =>
  Math.max(0, entrance.capacity - entrance.zombies - entrance.barricades);

export const survivorCapacityOf = (state: GameState, location: LocationId): number =>
  location === COLONY
    ? state.colony.survivorSpaces
    : (state.locations[location]?.survivorCapacity ?? 0);

/** Colony spaces are shared with helpless survivors (§2.3). */
export const occupancyOf = (state: GameState, location: LocationId): number =>
  survivorsAt(state, location).length + (location === COLONY ? state.colony.helpless : 0);

export const allLocations: readonly LocationId[] = [COLONY, ...NON_COLONY_LOCATIONS];

/* ------------------------------------------------------------------ *
 * Labels
 * ------------------------------------------------------------------ */

export const COLONY_STEP_LABEL: Record<ColonyStep, string> = {
  payFood: 'Pay food',
  checkWaste: 'Check waste',
  resolveCrisis: 'Resolve crisis',
  addZombies: 'Add zombies',
  checkMainObjective: 'Check objective',
  advanceRound: 'Advance round',
  passFirstPlayer: 'Pass first player',
};

export function phaseLabel(state: GameState): string {
  switch (state.phase) {
    case 'setup':
      return state.setupStage === 'chooseLeader' ? 'Setup — choose a leader' : 'Setup';
    case 'playerTurns':
      return 'Player turns';
    case 'colony':
      return state.colonyStep ? `Colony — ${COLONY_STEP_LABEL[state.colonyStep]}` : 'Colony phase';
    case 'gameOver':
      return 'Game over';
    default:
      return state.phase;
  }
}

/**
 * §11.1's food maths, shown before the Colony Phase collects it.
 *
 * One food per two *colony* occupants, rounded up — survivors out at a
 * location feed themselves. Helpless survivors eat, which is why they are
 * counted in `occupancyOf`.
 */
export const foodDue = (state: GameState): number => Math.ceil(occupancyOf(state, COLONY) / 2);
