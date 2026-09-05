/**
 * The crossroads system — §10, with the timing rulings of §18.4.
 *
 * Three rules shape everything here:
 *
 *  - the card is drawn and held by the player on the active player's *right*,
 *    and it applies only to the active player;
 *  - an action-based trigger fires only after the entire triggering action has
 *    resolved, "including movement exposure, deaths, and other mandatory
 *    consequences" — so triggers are tested from a recorded event list once the
 *    effect stack is empty, never inline;
 *  - a card that triggers with no legal option is malformed content and must
 *    "expose a rules error rather than silently skip the card".
 */

import type { CrossroadsCardDefinition } from '../content/schema.js';
import type { TriggerSpec } from '../content/effects.js';
import type { GameState, PendingChoice, PlayerId, TurnEvent } from '../types.js';
import {
  contentOf,
  getSurvivor,
  nextSeatRight,
  pushChoice,
  pushLog,
  trySurvivor,
  withRng,
} from './state.js';
import { evalCondition, scopeOf } from './effects/conditions.js';

/* ------------------------------------------------------------------ *
 * Drawing and returning
 * ------------------------------------------------------------------ */

/**
 * §10: at the beginning of each player's turn the player on the right draws one
 * crossroads card and keeps it secret.
 *
 * §6 adds that "crossroads monitoring must already be active before other
 * beginning-of-turn events that could satisfy a trigger", which is why this
 * runs as the first beginning-of-turn effect rather than alongside the others.
 */
export function drawCrossroads(state: GameState, now: number, activePlayerId: PlayerId): void {
  const holderId = nextSeatRight(state, activePlayerId);
  const cardId = state.decks.crossroads.shift() ?? null;
  state.turn = {
    playerId: activePlayerId,
    crossroadsHolderId: holderId,
    crossroadsCardId: cardId,
    crossroadsTriggered: false,
    events: [],
  };
  if (!cardId) return;
  pushLog(state, now, {
    category: 'crossroads',
    playerId: holderId,
    // §3: the identity is private to the holder until it triggers, so the
    // public sentence names nobody's card.
    message: `${state.players[holderId]?.name ?? holderId} draws a crossroads card.`,
    data: { event: 'crossroadsDrawn', holderId, activePlayerId },
  });
}

/**
 * §10: an untriggered card goes to the bottom of the crossroads deck at turn
 * end. A triggered one was already removed from the game when it resolved.
 */
export function returnCrossroads(state: GameState): void {
  const turn = state.turn;
  if (!turn?.crossroadsCardId) return;
  if (!turn.crossroadsTriggered) state.decks.crossroads.push(turn.crossroadsCardId);
  turn.crossroadsCardId = null;
}

/* ------------------------------------------------------------------ *
 * Trigger matching
 * ------------------------------------------------------------------ */

function eventMatches(state: GameState, spec: TriggerSpec, event: TurnEvent): boolean {
  if (spec.event !== event.event) return false;
  switch (spec.event) {
    case 'actionPerformed':
      return spec.action === undefined || spec.action === 'any' || spec.action === event.action;
    case 'moveCompleted': {
      if (spec.destination && spec.destination !== 'any' && spec.destination !== event.destination) {
        return false;
      }
      // §10/§18.4: "If a survivor dies while moving, a movement-triggered
      // crossroads card does not trigger from that failed sequence." The event
      // is recorded when the move commits, so the survivor's survival is tested
      // here, after the arrival exposure has already resolved.
      return event.survivorId === undefined || trySurvivor(state, event.survivorId) !== undefined;
    }
    case 'crisisResolved':
      return (
        spec.crisisOutcome === undefined ||
        spec.crisisOutcome === 'any' ||
        spec.crisisOutcome === event.crisisOutcome
      );
    case 'moraleChanged':
      return (
        spec.moraleDirection === undefined ||
        spec.moraleDirection === 'any' ||
        spec.moraleDirection === event.moraleDirection
      );
    default:
      return true;
  }
}

/**
 * Tests the held card against everything that has happened this turn.
 *
 * Called only when the effect stack is empty and no choice is outstanding, so
 * §10's "first finish the entire triggering action" is satisfied structurally
 * rather than by discipline at each call site.
 */
export function checkCrossroadsTrigger(state: GameState, now: number): boolean {
  const turn = state.turn;
  if (!turn || turn.crossroadsTriggered || !turn.crossroadsCardId) return false;
  const card = contentOf(state).crossroads.get(turn.crossroadsCardId);
  if (!card) {
    throw new Error(`Crossroads card '${turn.crossroadsCardId}' is not in the content pack`);
  }

  const scope = scopeOf({
    sourceCardId: card.id,
    sourceInstanceId: null,
    // §10: the card applies only to the active player, so every condition on it
    // is evaluated from that player's point of view.
    controllerId: turn.playerId,
    sourceSurvivorId: null,
  });

  const hit = turn.events.some((e) => eventMatches(state, card.trigger, e));
  if (!hit) return false;
  if (card.trigger.requires && !evalCondition(state, card.trigger.requires, scope)) return false;

  triggerCrossroads(state, now, card);
  return true;
}

/* ------------------------------------------------------------------ *
 * Resolution
 * ------------------------------------------------------------------ */

function triggerCrossroads(state: GameState, now: number, card: CrossroadsCardDefinition): void {
  const turn = state.turn!;
  turn.crossroadsTriggered = true;

  const scope = scopeOf({
    sourceCardId: card.id,
    sourceInstanceId: null,
    controllerId: turn.playerId,
    sourceSurvivorId: null,
  });

  // §10/§18.4: reveal and read the *entire* card, every option and every
  // outcome, before the chooser decides. Illegal options are shown as illegal
  // rather than hidden, so the table can see what was on the table.
  const options = card.options.map((opt) => {
    const legal = opt.requires === undefined || evalCondition(state, opt.requires, scope);
    return {
      id: opt.id,
      label: opt.text,
      legal,
      ...(legal ? {} : { reason: 'Conditions for this option are not met.' }),
    };
  });

  if (!options.some((o) => o.legal)) {
    // §10: "If no legal result exists due to malformed content, stop and expose
    // a rules error rather than silently skip the card." §22 wants that failure
    // closed, with state preserved — the throw leaves the caller's input state
    // untouched because the reducer works on a clone.
    throw new Error(
      `Crossroads card '${card.id}' triggered with no legal option; content is malformed (§10).`,
    );
  }

  pushLog(state, now, {
    category: 'crossroads',
    playerId: turn.playerId,
    message: `Crossroads: ${card.name}.`,
    data: {
      event: 'crossroadsTriggered',
      cardId: card.id,
      story: card.story,
      options: card.options.map((o) => ({ id: o.id, text: o.text })),
    },
  });

  /*
   * §10: the active player chooses "unless the card specifies a vote or another
   * chooser". `chooser` is exhaustive over the narrowed union — see the note on
   * `CrossroadsCardDefinition.chooser`. A vote is *not* a chooser: it is a `vote`
   * effect on an option's outcome, because only the effect can carry the
   * electorate §15/§18.4 requires.
   */
  const chooser: PlayerId = ((): PlayerId => {
    switch (card.chooser) {
      case 'firstPlayer':
        return state.firstPlayerId;
      case 'activePlayer':
      case undefined:
        return turn.playerId;
      default: {
        const never: never = card.chooser;
        throw new Error(`unhandled crossroads chooser: ${String(never)}`);
      }
    }
  })();

  const choice: Omit<PendingChoice, 'id'> = {
    kind: 'effectOption',
    playerId: chooser,
    prompt: card.name,
    options,
    outcomes: Object.fromEntries(card.options.map((o) => [o.id, o.outcome])),
    data: { cardId: card.id, source: 'crossroads', controllerId: turn.playerId },
  };
  pushChoice(state, choice);

  /*
   * §10: the card is removed from the game once it resolves. `crossroadsTriggered`
   * is what keeps `returnCrossroads` from also bottom-decking it at turn end —
   * the id stays on the turn so the UI can keep the revealed card on screen
   * while the chooser is still deciding.
   */
}

/* ------------------------------------------------------------------ *
 * Deck maintenance
 * ------------------------------------------------------------------ */

/**
 * §10: "If a crossroads effect searches a deck for a named card, reshuffle that
 * deck afterward." Exposed here because the crossroads deck is the one most
 * often searched.
 */
export function reshuffleCrossroads(state: GameState): void {
  state.decks.crossroads = withRng(state, (rng) => rng.shuffle(state.decks.crossroads));
}

/** True while a survivor id still refers to a living survivor. */
export const survivorAlive = (state: GameState, id: string): boolean =>
  trySurvivor(state, id) !== undefined;

export { getSurvivor };
