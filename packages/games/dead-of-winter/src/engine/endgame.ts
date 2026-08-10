/**
 * Game end and winner evaluation — §16, with the variant overrides of §19.
 *
 * §16 is unusually strict about *when* the game may end and about what is not
 * checked at that moment: morale zero and round zero end the game "immediately"
 * and explicitly "do not check main-objective completion". Only the Check Main
 * Objective step can end a game with the objective complete, which is why
 * `mainObjectiveComplete` here is derived from the end *reason* rather than
 * re-evaluated at the end.
 */

import type {
  GameEndReason,
  GameOutcome,
  GameState,
  PlayerId,
  PlayerResult,
} from '../types.js';
import { contentOf, getPlayer, activeSeating, pushLog } from './state.js';
import { evalCondition, scopeOf } from './effects/conditions.js';

/* ------------------------------------------------------------------ *
 * Objective evaluation
 * ------------------------------------------------------------------ */

/**
 * Is this player's secret objective complete?
 *
 * §14.1 attaches an exiled objective to the original rather than swapping it,
 * so by default both must hold; a card that says otherwise sets
 * `replacesOriginalObjective`. §16 also insists a secret objective is never an
 * early win trigger, which is why this is only ever called from `endGame`.
 */
export function secretObjectiveComplete(state: GameState, playerId: PlayerId): boolean {
  const content = contentOf(state);
  const player = getPlayer(state, playerId);
  const scope = scopeOf({
    sourceCardId: null,
    sourceInstanceId: null,
    controllerId: playerId,
    sourceSurvivorId: null,
  });

  const exiledCard = player.exiledObjectiveId
    ? content.secretObjectives.get(player.exiledObjectiveId)
    : undefined;

  if (exiledCard?.replacesOriginalObjective) {
    return evalCondition(state, exiledCard.completion, scope);
  }

  const originals = player.secretObjectiveIds
    .map((id) => content.secretObjectives.get(id))
    .filter((c): c is NonNullable<typeof c> => c !== undefined);

  const originalsHold = originals.every((c) => evalCondition(state, c.completion, scope));
  if (!exiledCard) return originalsHold;
  return originalsHold && evalCondition(state, exiledCard.completion, scope);
}

/** Whether a player holds a betrayal objective. Authoritative hidden state. */
export function isBetrayer(state: GameState, playerId: PlayerId): boolean {
  const content = contentOf(state);
  return getPlayer(state, playerId).secretObjectiveIds.some(
    (id) => content.secretObjectives.get(id)?.kind === 'betrayal',
  );
}

/**
 * §14.2: "If at any time two players are exiled and neither has a betrayal
 * secret objective, set morale to zero immediately and end the game."
 *
 * The test reads hidden objective state on purpose — §14.2 says so explicitly —
 * so it can fire while no player at the table can see why.
 */
export function twoNonBetrayerExiles(state: GameState): boolean {
  const exiled = activeSeating(state).filter((id) => getPlayer(state, id).exiled);
  if (exiled.length < 2) return false;
  return exiled.filter((id) => !isBetrayer(state, id)).length >= 2;
}

/* ------------------------------------------------------------------ *
 * Ending the game
 * ------------------------------------------------------------------ */

/**
 * Ends the match and computes the outcome.
 *
 * Clearing the effect stack and the choice queue is part of ending: §16 says
 * "end immediately", and a half-run zombie batch left on the stack would
 * otherwise resume the moment anything called the driver again.
 */
export function endGame(state: GameState, now: number, reason: GameEndReason): void {
  if (state.phase === 'gameOver') return;

  state.phase = 'gameOver';
  state.colonyStep = null;
  state.activePlayerId = null;
  state.effectStack = [];
  state.pendingChoices = [];
  state.vote = null;
  state.search = null;
  state.request = null;

  // §16: only the Check Main Objective step ends a game with the objective
  // complete. Morale and round failures suppress the final check entirely.
  const mainObjectiveComplete = reason === 'mainObjective';
  const outcome = evaluateWinners(state, reason, mainObjectiveComplete);
  state.outcome = outcome;

  pushLog(state, now, {
    category: 'endgame',
    message: describeEnd(reason, outcome),
    data: {
      event: 'gameOver',
      reason,
      mainObjectiveComplete,
      winners: outcome.winners,
      results: outcome.results,
    },
  });
}

function describeEnd(reason: GameEndReason, outcome: GameOutcome): string {
  const head =
    reason === 'morale'
      ? 'Morale reached zero.'
      : reason === 'rounds'
        ? 'The last round ran out.'
        : reason === 'mainObjective'
          ? 'The colony completed its main objective.'
          : reason === 'twoNonBetrayerExiles'
            ? 'Two loyal survivors were cast out; the colony tears itself apart.'
            : reason === 'allPlayersEliminated'
              ? 'Nobody is left alive.'
              : 'The game ends.';
  const tail =
    outcome.winners.length === 0
      ? ' Everybody loses.'
      : ` Winners: ${outcome.winners.join(', ')}.`;
  return head + tail;
}

/* ------------------------------------------------------------------ *
 * Winner rules (§16, §19)
 * ------------------------------------------------------------------ */

function evaluateWinners(
  state: GameState,
  reason: GameEndReason,
  mainObjectiveComplete: boolean,
): GameOutcome {
  const players = activeSeating(state);
  const eliminated = state.seating.filter((id) => getPlayer(state, id).eliminated);

  const results: PlayerResult[] = [];
  const winners: PlayerId[] = [];

  if (state.settings.mode === 'cooperative') {
    // §19.1: "Every player's sole objective is completion of the main objective",
    // and there are no secret objectives to evaluate.
    for (const id of state.seating) {
      const won = mainObjectiveComplete && !getPlayer(state, id).eliminated;
      results.push({
        playerId: id,
        won,
        secretObjectiveIds: [],
        exiledObjectiveId: null,
        objectiveComplete: mainObjectiveComplete,
      });
      if (won) winners.push(id);
    }
    return { reason, mainObjectiveComplete, winners, results };
  }

  if (state.settings.mode === 'prisonersDilemma') {
    return prisonersDilemmaOutcome(state, reason, mainObjectiveComplete);
  }

  // §16 standard hidden-objective game: every player is judged alone, several
  // may win, and everybody may lose.
  for (const id of state.seating) {
    const player = getPlayer(state, id);
    const complete = player.eliminated ? false : secretObjectiveComplete(state, id);
    results.push({
      playerId: id,
      won: complete,
      secretObjectiveIds: [...player.secretObjectiveIds],
      exiledObjectiveId: player.exiledObjectiveId,
      objectiveComplete: complete,
    });
    if (complete) winners.push(id);
  }
  void players;
  void eliminated;
  return { reason, mainObjectiveComplete, winners, results };
}

/**
 * §19.6, the experimental two-player variant.
 *
 * Its win test is a genuinely different shape: on a main-objective completion a
 * player needs their *regular* objective, and on a morale-zero ending exactly
 * one player who completed their *betrayal* objective wins — "if both or
 * neither did, both lose". Round-track zero is treated like morale zero only
 * when the corresponding §19.6 toggle is on, because that recommendation is a
 * suggestion rather than a rule.
 */
function prisonersDilemmaOutcome(
  state: GameState,
  reason: GameEndReason,
  mainObjectiveComplete: boolean,
): GameOutcome {
  const content = contentOf(state);
  const treatRoundsAsMorale = state.settings.prisonersDilemma.roundZeroEndsLikeMoraleZero;
  const collapse =
    reason === 'morale' ||
    reason === 'twoNonBetrayerExiles' ||
    (reason === 'rounds' && treatRoundsAsMorale);

  const rows = state.seating.map((id) => {
    const player = getPlayer(state, id);
    const scope = scopeOf({
      sourceCardId: null,
      sourceInstanceId: null,
      controllerId: id,
      sourceSurvivorId: null,
    });
    const cards = player.secretObjectiveIds
      .map((cid) => content.secretObjectives.get(cid))
      .filter((c): c is NonNullable<typeof c> => c !== undefined);
    const regular = cards.find((c) => c.kind === 'nonBetrayal');
    const betrayal = cards.find((c) => c.kind === 'betrayal');
    return {
      id,
      player,
      regularComplete: regular ? evalCondition(state, regular.completion, scope) : false,
      betrayalComplete: betrayal ? evalCondition(state, betrayal.completion, scope) : false,
    };
  });

  let winners: PlayerId[] = [];
  if (collapse) {
    const betrayers = rows.filter((r) => r.betrayalComplete);
    // "exactly one" — both or neither means both lose.
    winners = betrayers.length === 1 ? [betrayers[0]!.id] : [];
  } else if (mainObjectiveComplete) {
    winners = rows.filter((r) => r.regularComplete).map((r) => r.id);
  }

  return {
    reason,
    mainObjectiveComplete,
    winners,
    results: rows.map((r) => ({
      playerId: r.id,
      won: winners.includes(r.id),
      secretObjectiveIds: [...r.player.secretObjectiveIds],
      exiledObjectiveId: r.player.exiledObjectiveId,
      objectiveComplete: collapse ? r.betrayalComplete : r.regularComplete,
    })),
  };
}

/* ------------------------------------------------------------------ *
 * Continuous end tests
 * ------------------------------------------------------------------ */

/**
 * §16/§11.4: morale zero ends the game immediately *except* inside the Add
 * Zombies sequence, where §11.4 defers the test to three named checkpoints.
 */
export function checkMoraleZero(state: GameState, now: number): boolean {
  if (state.phase === 'gameOver') return true;
  if (state.colony.morale > 0) return false;
  if (state.deferMoraleCheck) return false;
  endGame(state, now, 'morale');
  return true;
}

/** §14.2's instant loss, tested after every exile resolves. */
export function checkTwoExileLoss(state: GameState, now: number): boolean {
  if (state.phase === 'gameOver') return false;
  if (!twoNonBetrayerExiles(state)) return false;
  state.colony.morale = 0;
  pushLog(state, now, {
    category: 'exile',
    message: 'Two loyal players have been exiled. Morale collapses to zero.',
    data: { event: 'twoNonBetrayerExiles' },
  });
  endGame(state, now, 'twoNonBetrayerExiles');
  return true;
}

/** §19.5 leaves the all-eliminated state undefined; §19.5 asks for a total loss. */
export function checkAllEliminated(state: GameState, now: number): boolean {
  if (state.phase === 'gameOver') return false;
  if (activeSeating(state).length > 0) return false;
  endGame(state, now, 'allPlayersEliminated');
  return true;
}

/** §11.5: the objective is evaluated only at its colony-phase step. */
export function mainObjectiveSatisfied(state: GameState): boolean {
  const content = contentOf(state);
  const card = content.mainObjectives.get(state.mainObjective.cardId);
  if (!card) throw new Error(`Main objective '${state.mainObjective.cardId}' is not in the pack`);
  const side = state.mainObjective.side === 'hardcore' ? card.hardcore : card.standard;
  return evalCondition(
    state,
    side.completion,
    scopeOf({
      sourceCardId: card.id,
      sourceInstanceId: null,
      controllerId: null,
      sourceSurvivorId: null,
    }),
  );
}
