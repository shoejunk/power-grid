/**
 * What an automated seat does.
 *
 * This is not an opponent AI, and Dead of Winter would be a strange game to
 * write one for: the interesting decisions are social, and a bot has no
 * secret it is willing to lie about. What it is instead is a seat that keeps
 * the table moving — it answers the decisions the rules block on, spends its
 * dice on the obvious useful things, feeds the crisis, and passes. A player
 * filling out a three-seat game with two bots gets a colony that behaves like
 * two distracted housemates, which is enough to play against.
 *
 * Two rules the whole file obeys:
 *
 *  - Every candidate is run through `validateAction` before it is offered, so
 *    the bot can never stall a table with an illegal move. The server probes
 *    them again anyway; this is belt and braces, and it is also what lets the
 *    planner be written as "try these in order" instead of as a rules engine.
 *  - Exactly one action per call. The server re-asks after every action it
 *    applies, so a turn is a sequence of these decisions rather than a script,
 *    and the bot re-plans against whatever its last move actually did.
 */

import { COLONY, NON_COLONY_LOCATIONS, type LocationId } from '../content/primitives.js';
import type { GameAction, GameState, PendingChoice, PlayerId } from '../types.js';
import { validateAction } from './actions.js';
import { contentOf } from './state.js';

/** The first candidate the rules engine will accept, or `null`. */
function firstLegal(
  state: GameState,
  playerId: PlayerId,
  candidates: readonly GameAction[],
): GameAction | null {
  for (const action of candidates) {
    try {
      if (validateAction(state, playerId, action).ok) return action;
    } catch {
      /* A candidate built from a stale id: not legal, not fatal. */
    }
  }
  return null;
}

/**
 * An answer to a blocked decision.
 *
 * The first legal options, in the order the engine offered them. That ordering
 * is not arbitrary — the engine builds casualty and placement lists in its own
 * canonical order — so "the first one" is a defensible choice rather than a
 * coin toss, and it is deterministic, which keeps a bot game replayable (§22).
 */
function answerChoice(choice: PendingChoice): GameAction | null {
  const wanted = choice.minPicks ?? 1;
  const legal = choice.options.filter((option) => option.legal).map((option) => option.id);
  if (legal.length < wanted) return null;
  return { type: 'resolveChoice', choiceId: choice.id, optionIds: legal.slice(0, wanted) };
}

/** Highest dice first: a 6 can do anything a 3 can, so spend the fussy ones last. */
const byValueDesc = (dice: readonly number[]): number[] => [...dice].sort((a, b) => b - a);

/**
 * §8.2: hand something to the crisis if it carries a symbol the crisis wants.
 *
 * Capped at one card per player per crisis. A bot that emptied its hand into
 * every crisis would trivialise them, and would also strip the human of the
 * cards they might have asked for (§8.6).
 */
function crisisContribution(state: GameState, playerId: PlayerId): GameAction | null {
  const crisisId = state.crisis.cardId;
  if (!crisisId) return null;
  if (state.crisis.contributions.some((c) => c.playerId === playerId)) return null;

  const crisis = contentOf(state).crises.get(crisisId);
  if (!crisis) return null;
  const content = contentOf(state);
  const player = state.players[playerId];
  if (!player) return null;

  for (const iid of player.hand) {
    const instance = state.items[iid];
    const def = instance ? content.items.get(instance.cardId) : undefined;
    if (!def) continue;
    if (def.symbols.some((symbol) => crisis.acceptedSymbols.includes(symbol))) {
      return { type: 'contributeCrisis', iids: [iid] };
    }
  }
  return null;
}

/**
 * §8.4: keep somebody out in the world.
 *
 * The colony consumes; only the locations produce. A bot that never leaves
 * starves the table, so it pushes one survivor out whenever it has nobody
 * outside — and never more than that, because a survivor alone at a location
 * is how you lose one.
 */
function stepOutside(state: GameState, playerId: PlayerId): GameAction | null {
  const mine = Object.values(state.survivors).filter((s) => s.controllerId === playerId);
  if (mine.length < 2) return null;
  if (mine.some((s) => s.location !== COLONY)) return null;

  const candidate = mine.find((s) => s.location === COLONY && !s.movedThisTurn && !s.isLeader);
  if (!candidate) return null;

  // Somewhere with cards left in it, in canonical board order.
  const destinations: LocationId[] = NON_COLONY_LOCATIONS.filter(
    (loc) => (state.locations[loc]?.deck.length ?? 0) > 0,
  );
  return firstLegal(
    state,
    playerId,
    destinations.map((to) => ({ type: 'moveSurvivor', survivorId: candidate.id, to }) as GameAction),
  );
}

/** One die, spent on the most useful thing that die can do. */
function spendDie(state: GameState, playerId: PlayerId, die: number): GameAction | null {
  const mine = Object.values(state.survivors).filter((s) => s.controllerId === playerId);
  const candidates: GameAction[] = [];

  // Searching is how the colony gets food, so it comes first.
  for (const survivor of mine) {
    if (survivor.location !== COLONY) {
      candidates.push({ type: 'search', survivorId: survivor.id, die });
    }
  }
  // Then killing what is already inside the walls.
  for (const survivor of mine) {
    candidates.push({ type: 'attackZombie', survivorId: survivor.id, die });
  }
  // Then the housekeeping that stops morale bleeding (§11.2).
  if (state.colony.waste.length >= 8) candidates.push({ type: 'cleanWaste', die });
  // Then walls.
  for (const survivor of mine) {
    candidates.push({ type: 'barricade', survivorId: survivor.id, die });
  }

  return firstLegal(state, playerId, candidates);
}

/**
 * The move an automated seat makes right now, or `null` for "no opinion" —
 * which the server answers with `safeDefaultActions`.
 */
export function planAction(state: GameState, playerId: PlayerId): GameAction | null {
  const player = state.players[playerId];
  if (!player || player.eliminated) return null;
  if (state.phase === 'gameOver') return null;

  /* A blocked decision outranks everything: nothing else is legal until it is
     answered (§5), and the table is stopped until it is. */
  const choice = state.pendingChoices.find((c) => c.playerId === playerId);
  if (choice) return answerChoice(choice);

  /* §15: a vote nobody finishes is a table that never moves again. The bot
     never votes to exile anybody — it has no secret to protect and no reason
     to believe the accusation. */
  if (state.vote && state.vote.electorate.includes(playerId) && state.vote.votes[playerId] === undefined) {
    return { type: 'castVote', vote: false };
  }

  if (state.phase !== 'playerTurns' || state.turn?.playerId !== playerId) return null;

  const contribute = crisisContribution(state, playerId);
  if (contribute) return contribute;

  const step = stepOutside(state, playerId);
  if (step) return step;

  for (const die of byValueDesc(player.unusedDice)) {
    const action = spendDie(state, playerId, die);
    if (action) return action;
  }

  return { type: 'endTurn' };
}

/**
 * Pass-like moves the server may fall back on, in order.
 *
 * `planAction` is expected to answer everything; these exist so that a
 * planner bug can never be the reason a table is stuck forever. Each is probed
 * against `validateAction` by the server before it is played.
 */
export function fallbackActions(state: GameState, playerId: PlayerId): GameAction[] {
  const out: GameAction[] = [];

  const choice = state.pendingChoices.find((c) => c.playerId === playerId);
  if (choice) {
    const answer = answerChoice(choice);
    if (answer) out.push(answer);
    // A choice whose legal options are fewer than `minPicks` cannot be
    // answered legally at all; offering the illegal set at least produces a
    // logged rejection rather than silence.
    if (!answer && choice.options.length > 0) {
      out.push({
        type: 'resolveChoice',
        choiceId: choice.id,
        optionIds: [choice.options[0]!.id],
      });
    }
  }

  if (state.vote) out.push({ type: 'castVote', vote: false });
  out.push({ type: 'endTurn' });
  return out;
}
