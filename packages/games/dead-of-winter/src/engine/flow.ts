/**
 * The round state machine — §5, §6 and §11.
 *
 * Every step here is reached through an internal effect rather than by calling
 * the next function directly, because §5 forbids any step from advancing "while
 * it has an unresolved choice, die roll, death, bite chain, crossroads result,
 * overrun, or card effect". Queueing the remaining steps behind the current one
 * makes that structural: a choice raised in the middle of Pay Food simply sits
 * on top of the stack, and Check Waste cannot run until it is answered.
 */

import { COLONY, type NonColonyLocationId } from '../content/primitives.js';
import type { EngineEffect, GameState, PlayerId } from '../types.js';
import { COLONY_STEPS } from '../types.js';
import {
  activeSeating,
  adjustMorale,
  colonyOccupants,
  contentOf,
  getPlayer,
  locationState,
  nextSeatRight,
  pushChoice,
  pushLog,
  removeFromGame,
  survivorsAt,
  survivorsOf,
  turnOrder,
  unshiftIntoCurrentFrame,
  withRng,
} from './state.js';
import { locationOrder } from './policy.js';
import { drawCrossroads, returnCrossroads } from './crossroads.js';
import { applyFrostbiteAtTurnStart } from './survivors.js';
import { placementEffects, resetEntrancePointer } from './zombies.js';
import { checkMoraleZero, endGame, mainObjectiveSatisfied } from './endgame.js';
import { itemMatches } from './effects/conditions.js';

/* ------------------------------------------------------------------ *
 * Player Turns Phase (§5.1, §6)
 * ------------------------------------------------------------------ */

/**
 * §5.1: reveal the crisis, roll everyone's dice, then hand the first player
 * their turn. The crisis stays face up "until the colony's Resolve Crisis step",
 * so it is revealed once per round and not touched again until §11.3.
 */
export function beginRound(state: GameState, now: number): void {
  state.phase = 'playerTurns';
  state.colonyStep = null;
  state.round += 1;

  const crisisId = state.decks.crisis.shift() ?? null;
  state.crisis = { cardId: crisisId, contributions: [] };
  if (crisisId) {
    const card = contentOf(state).crises.get(crisisId);
    pushLog(state, now, {
      category: 'crisis',
      message: `Crisis: ${card?.name ?? crisisId}.`,
      data: { event: 'crisisRevealed', cardId: crisisId, round: state.round },
    });
  }

  /*
   * §7.7: a once-per-round ability "must retain its used state for the entire
   * round" — and therefore only for the round. The reset lives here, at the
   * round boundary, mirroring `beginTurn`'s `usedThisTurn` clear.
   *
   * Every survivor and every item is cleared, not just the ones on the board:
   * §18.5 scopes usage to the card instance precisely so that it survives dying
   * into a hand, being re-equipped and being handed off. That rule is about
   * *transfers*, not about the round boundary, so an item sitting in a hand must
   * come back refreshed like any other.
   */
  for (const survivor of Object.values(state.survivors)) survivor.usedThisRound = [];
  for (const item of Object.values(state.items)) item.usedThisRound = [];

  rollActionDice(state, now);

  const order = turnOrder(state);
  if (order.length === 0) return;
  unshiftIntoCurrentFrame(state, [{ kind: 'i.beginTurn', playerId: order[0]! }]);
}

/**
 * §6: one die plus one per controlled survivor, rolled into the unused pool.
 *
 * Both pools are cleared first, so a die left unspent last round is gone. §6
 * also notes the consequence tested by acceptance criterion 3: a survivor that
 * will die of frostbite at the start of its controller's turn still contributed
 * a die here, because dice are rolled before any individual turn begins.
 */
export function rollActionDice(state: GameState, now: number): void {
  for (const id of activeSeating(state)) {
    const player = getPlayer(state, id);
    player.unusedDice = [];
    player.usedDice = [];
    const count = 1 + survivorsOf(state, id).length;
    player.unusedDice = withRng(state, (rng) =>
      Array.from({ length: count }, () => rng.die(6)),
    );
    pushLog(state, now, {
      category: 'dice',
      playerId: id,
      message: `${player.name} rolls ${player.unusedDice.join(', ')}.`,
      data: { event: 'diceRolled', playerId: id, dice: [...player.unusedDice] },
    });
  }
}

/**
 * §6's beginning-of-turn sequence, in its stated order.
 *
 * The crossroads draw comes first because §6 requires monitoring to "already be
 * active before other beginning-of-turn events that could satisfy a trigger" —
 * and the frostbite wound that follows is exactly such an event.
 */
export function beginTurn(state: GameState, now: number, playerId: PlayerId): void {
  state.activePlayerId = playerId;
  const player = getPlayer(state, playerId);
  player.nominatedThisTurn = false;
  state.mainObjective.contributionsThisTurn = 0;

  for (const survivor of survivorsOf(state, playerId)) {
    survivor.movedThisTurn = false;
    survivor.usedThisTurn = [];
  }
  for (const item of Object.values(state.items)) item.usedThisTurn = [];

  drawCrossroads(state, now, playerId);

  pushLog(state, now, {
    category: 'turn',
    playerId,
    message: `${player.name} begins their turn.`,
    data: { event: 'turnStart', playerId, round: state.round },
  });
  state.turn?.events.push({ event: 'turnStart' });

  // §6 step 2 and §9.1: frostbite bites again at turn start, and §6 step 3 kills
  // anyone who reaches three wounds before the player may act. `addWounds`
  // queues the kill itself, so nothing further is needed here.
  applyFrostbiteAtTurnStart(state, now, playerId);
}

/**
 * §5.1: play passes left. When the last player has finished, the Colony Phase
 * begins.
 */
export function endTurn(state: GameState, now: number): void {
  const turn = state.turn;
  if (!turn) return;
  returnCrossroads(state);
  const finished = turn.playerId;
  pushLog(state, now, {
    category: 'turn',
    playerId: finished,
    message: `${getPlayer(state, finished).name} ends their turn.`,
    data: { event: 'turnEnd', playerId: finished },
  });
  state.turn = null;
  state.activePlayerId = null;

  const order = turnOrder(state);
  const idx = order.indexOf(finished);
  const next = idx >= 0 ? order[idx + 1] : undefined;
  if (next) {
    unshiftIntoCurrentFrame(state, [{ kind: 'i.beginTurn', playerId: next }]);
    return;
  }
  beginColonyPhase(state, now);
}

/* ------------------------------------------------------------------ *
 * Colony Phase (§5.2, §11)
 * ------------------------------------------------------------------ */

export function beginColonyPhase(state: GameState, now: number): void {
  state.phase = 'colony';
  pushLog(state, now, {
    category: 'phase',
    message: 'The colony phase begins.',
    data: { event: 'colonyPhase', round: state.round },
  });
  unshiftIntoCurrentFrame(
    state,
    COLONY_STEPS.map((step) => ({ kind: 'i.colonyStep', step }) as const),
  );
}

/** Dispatches one colony step. Each may queue further effects of its own. */
export function runColonyStep(state: GameState, now: number, step: (typeof COLONY_STEPS)[number]): void {
  state.colonyStep = step;
  switch (step) {
    case 'payFood':
      payFood(state, now);
      return;
    case 'checkWaste':
      checkWaste(state, now);
      return;
    case 'resolveCrisis':
      resolveCrisis(state, now);
      return;
    case 'addZombies':
      addZombies(state, now);
      return;
    case 'checkMainObjective':
      checkMainObjective(state, now);
      return;
    case 'advanceRound':
      advanceRound(state, now);
      return;
    case 'passFirstPlayer':
      passFirstPlayer(state, now);
      return;
    default:
      return;
  }
}

/**
 * §11.1. Only colony occupants eat — "survivors at non-colony locations feed
 * themselves". Payment is mandatory when affordable, and a shortfall adds a
 * starvation token whose *running total* is charged to morale, so the second
 * failed feeding costs two.
 */
function payFood(state: GameState, now: number): void {
  const occupants = colonyOccupants(state);
  const required = Math.ceil(occupants / 2);
  if (state.colony.food >= required) {
    state.colony.food -= required;
    pushLog(state, now, {
      category: 'phase',
      message: `The colony eats ${required} food (${occupants} mouths).`,
      data: { event: 'payFood', required, occupants, paid: true },
    });
    return;
  }
  // §11.1: remove no food at all, then add one starvation token.
  state.colony.starvation += 1;
  pushLog(state, now, {
    category: 'phase',
    message: `The colony starves: ${state.colony.food} food for ${occupants} mouths.`,
    data: {
      event: 'payFood',
      required,
      occupants,
      paid: false,
      starvation: state.colony.starvation,
    },
  });
  adjustMorale(state, now, -state.colony.starvation, 'starvation');
}

/** §11.2: one morale per full ten cards, counted without removing any. */
function checkWaste(state: GameState, now: number): void {
  const penalty = Math.floor(state.colony.waste.length / 10);
  pushLog(state, now, {
    category: 'phase',
    message: `The waste pile holds ${state.colony.waste.length} cards.`,
    data: { event: 'checkWaste', count: state.colony.waste.length, penalty },
  });
  if (penalty > 0) adjustMorale(state, now, -penalty, 'the waste pile');
}

/**
 * §11.3.
 *
 * The shuffle in step 1 is not decoration: without it the reveal order would
 * leak who contributed what, which §3 forbids. Scoring is per *card*, so a food
 * card that would normally add several tokens is still worth exactly one.
 */
function resolveCrisis(state: GameState, now: number): void {
  const crisisId = state.crisis.cardId;
  if (!crisisId) return;
  const card = contentOf(state).crises.get(crisisId);
  if (!card) throw new Error(`Crisis card '${crisisId}' is not in the content pack`);

  const shuffled = withRng(state, (rng) => rng.shuffle(state.crisis.contributions));
  let total = 0;
  const reveals: { iid: string; accepted: boolean }[] = [];
  for (const contribution of shuffled) {
    const accepted = itemMatches(state, contribution.iid, { symbols: card.acceptedSymbols });
    total += accepted ? 1 : -1;
    reveals.push({ iid: contribution.iid, accepted });
  }

  // §11.3 step 4: the bar is the number of *non-exiled* players, because §14.2
  // bars an exiled player from contributing at all.
  const required = activeSeating(state).filter((id) => !getPlayer(state, id).exiled).length;
  const prevented = total >= required;

  pushLog(state, now, {
    category: 'crisis',
    message: `${card.name}: ${total} contributed against ${required} needed — ${
      prevented ? 'prevented' : 'failed'
    }.`,
    data: {
      event: 'crisisResolved',
      cardId: crisisId,
      total,
      required,
      prevented,
      reveals,
    },
  });
  if (state.turn) {
    state.turn.events.push({
      event: 'crisisResolved',
      crisisOutcome: prevented ? 'prevented' : 'failed',
    });
  }

  const followUp: EngineEffect[] = [];
  if (!prevented) {
    followUp.push(card.failure);
  } else if (total >= required + 2) {
    // §11.3 step 7: the automatic bonus, clamped by the track (§24 policy).
    adjustMorale(state, now, 1, 'the crisis was comfortably prevented');
    if (card.overContribution) {
      // Step 8's *printed* effect is optional, so it is offered rather than run.
      pushChoice(state, {
        kind: 'effectOption',
        playerId: state.firstPlayerId,
        prompt: card.overContribution.text,
        options: [
          { id: 'take', label: card.overContribution.text, legal: true },
          { id: 'decline', label: 'Decline', legal: true },
        ],
        outcomes: { take: card.overContribution.effect, decline: { kind: 'noop' } },
        data: { cardId: crisisId, source: 'crisisOverContribution' },
      });
    }
  }

  // §11.3 step 9: every contributed card leaves the game, prevented or not.
  for (const contribution of state.crisis.contributions) removeFromGame(state, contribution.iid);
  state.crisis.contributions = [];
  state.crisis.cardId = null;
  state.decks.removedFromGame.survivors.length; // (crisis cards are not reused)

  if (followUp.length > 0) unshiftIntoCurrentFrame(state, followUp);
}

/**
 * §11.4's three ordered batches, with §11.4's three morale checkpoints — the
 * one place in the rules where a morale of zero does *not* end the game on the
 * spot.
 */
function addZombies(state: GameState, now: number): void {
  const content = contentOf(state);
  const queue: EngineEffect[] = [];

  // Batch 1: one zombie per two colony occupants, rounded up.
  queue.push({ kind: 'i.resetEntrancePointer' });
  queue.push(...placementEffects(COLONY, Math.ceil(colonyOccupants(state) / 2), true));
  queue.push({ kind: 'i.moraleCheckpoint' });

  // Batch 2: one zombie per normal survivor at each non-colony location, in the
  // canonical location order (§2.1, §24 policy).
  for (const loc of locationOrder(content)) {
    queue.push(...placementEffects(loc, survivorsAt(state, loc).length, false));
  }
  queue.push({ kind: 'i.moraleCheckpoint' });

  // Batch 3: each noise token, removed and rolled one at a time.
  for (const loc of locationOrder(content)) {
    const count = locationState(state, loc as NonColonyLocationId).noise;
    for (let i = 0; i < count; i++) queue.push({ kind: 'i.noiseRoll', location: loc });
  }
  queue.push({ kind: 'i.moraleCheckpoint' });

  state.deferMoraleCheck = true;
  unshiftIntoCurrentFrame(state, queue);
}

/**
 * §11.5: the only moment the main objective may end the game. Completing its
 * conditions earlier in the round does nothing until now.
 */
function checkMainObjective(state: GameState, now: number): void {
  if (mainObjectiveSatisfied(state)) {
    pushLog(state, now, {
      category: 'objective',
      message: 'The main objective is complete.',
      data: { event: 'mainObjectiveComplete', cardId: state.mainObjective.cardId },
    });
    endGame(state, now, 'mainObjective');
  }
}

/**
 * §11.6: the tracker drops, and a zero ends the game "immediately without
 * another main-objective check" — §16 repeats the suppression, so the end
 * reason is `rounds` and `mainObjectiveComplete` stays false.
 */
function advanceRound(state: GameState, now: number): void {
  state.roundsSurvived += 1;
  state.colony.rounds -= 1;
  pushLog(state, now, {
    category: 'phase',
    message: `${state.colony.rounds} round${state.colony.rounds === 1 ? '' : 's'} left.`,
    data: { event: 'roundTracker', rounds: state.colony.rounds, survived: state.roundsSurvived },
  });
  if (state.colony.rounds <= 0) endGame(state, now, 'rounds');
}

/** §5.2 step 7 / §15: the token passes right, while turns pass left. */
function passFirstPlayer(state: GameState, now: number): void {
  const next = nextSeatRight(state, state.firstPlayerId);
  state.firstPlayerId = next;
  pushLog(state, now, {
    category: 'phase',
    message: `${getPlayer(state, next).name} takes the first-player token.`,
    data: { event: 'firstPlayer', playerId: next },
  });
  state.deferMoraleCheck = false;
  unshiftIntoCurrentFrame(state, [{ kind: 'i.beginRound' }]);
}

/* ------------------------------------------------------------------ *
 * Morale checkpoint (§11.4)
 * ------------------------------------------------------------------ */

/**
 * The deferred test. §11.4 permits morale to sit at zero *within* a batch while
 * overrun deaths accumulate, and only tests between complete batches.
 */
export function moraleCheckpoint(state: GameState, now: number): void {
  state.deferMoraleCheck = false;
  const ended = checkMoraleZero(state, now);
  if (!ended) state.deferMoraleCheck = true;
}

/** Clears the deferral once the Add Zombies step is fully behind us. */
export function clearMoraleDeferral(state: GameState): void {
  state.deferMoraleCheck = false;
}
