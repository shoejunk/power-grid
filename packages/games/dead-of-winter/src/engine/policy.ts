/**
 * Rules policy — every place the source is silent (§24).
 *
 * §24 lists the low-frequency details the supplied PDFs never state and asks
 * that they be "isolated as rules-policy functions or content metadata so an
 * authoritative later ruling can replace them without rewriting phase logic".
 * That is exactly what this file is: no phase, action or effect module decides
 * one of these questions itself; they all call in here.
 *
 * Each export documents the question, the decision, and why. When a licensed
 * ruling arrives, the body changes and nothing else does.
 */

import type { Rng } from '@tt/core';

import { NON_COLONY_LOCATIONS, type LocationId, type NonColonyLocationId } from '../content/primitives.js';
import type { ContentIndex } from '../content/schema.js';
import type { GameState, PlayerId, SurvivorInstance } from '../types.js';

/* ------------------------------------------------------------------ *
 * §24.1 — initial first player on an influence tie
 * ------------------------------------------------------------------ */

/**
 * §4.13 gives the first-player token to the highest-influence group leader but
 * never says how to break a tie.
 *
 * DECISION: seeded random among the tied leaders.
 *
 * The alternative — lowest seat index — is deterministic but systematically
 * favours whoever joined the lobby first, across every game they ever play.
 * A seeded draw is equally replayable (§22: same seed, same result) and is
 * fair in expectation. The draw is logged so the table can see it happened.
 */
export function breakInitialFirstPlayerTie(tied: readonly PlayerId[], rng: Rng): PlayerId {
  if (tied.length === 1) return tied[0]!;
  return tied[rng.int(tied.length)]!;
}

/* ------------------------------------------------------------------ *
 * §24.2 — canonical non-colony location order
 * ------------------------------------------------------------------ */

/**
 * §2.1 requires "one deterministic, visible order" for zombie placement, noise
 * and logs but never enumerates it.
 *
 * DECISION: the content pack's `LocationDefinition.order` is authoritative;
 * where a pack omits or ties those values the built-in board order in
 * `NON_COLONY_LOCATIONS` is used as the tie-break.
 *
 * Putting the order in content rather than in code means a licensed board that
 * numbers its locations differently is a data change, not an engine change.
 */
export function locationOrder(content: ContentIndex): NonColonyLocationId[] {
  const fallback = (id: NonColonyLocationId): number => NON_COLONY_LOCATIONS.indexOf(id);
  return [...NON_COLONY_LOCATIONS].sort((a, b) => {
    const oa = content.locations.get(a)?.order ?? fallback(a);
    const ob = content.locations.get(b)?.order ?? fallback(b);
    return oa === ob ? fallback(a) - fallback(b) : oa - ob;
  });
}

/* ------------------------------------------------------------------ *
 * §24.3 — order of unkept search cards returned to the deck bottom
 * ------------------------------------------------------------------ */

/**
 * §7.3 has the searcher keep one card and bottom the rest, without saying in
 * what order the rest go back.
 *
 * DECISION: draw order — the first card drawn ends up deepest, so the pile goes
 * back in the order it came off the top. §7.3 itself says the implementation
 * should prefer "allowing the searching player to order them if the licensed
 * card text does not say otherwise"; that is a UI affordance layered on top of
 * this default, and the default has to be deterministic for replay regardless.
 *
 * The searcher already knows every one of these cards, so the order carries no
 * information they do not have — which is why it can safely be a fixed rule
 * rather than another prompt.
 */
export function orderUnkeptSearchCards(drawnInOrder: readonly string[]): string[] {
  return [...drawnInOrder];
}

/* ------------------------------------------------------------------ *
 * §24.4 — last-survivor replacement into a full colony
 * ------------------------------------------------------------------ */

export type FullColonyReplacementPolicy = 'displaceHelpless' | 'enterNonColony' | 'skip';

/**
 * §9.4 makes replacement mandatory but §13 forbids adding a survivor when the
 * colony has no empty space. §9.4 admits the conflict and asks for a house
 * rule.
 *
 * DECISION: `displaceHelpless`.
 *
 * If a helpless survivor occupies a colony space, it is killed to make room —
 * a helpless death costs one morale (§9.3), so the colony pays for the crowding
 * rather than getting a free pass. If there is no helpless survivor either, the
 * replacement enters an eligible non-colony location of the player's choice
 * (`enterNonColony`), because §9.4's own exiled-player branch already
 * establishes non-colony entry as the sanctioned fallback shape. `skip` — the
 * only reading that leaves a player with no survivors — is never chosen,
 * because §2.2 says a player normally cannot remain with zero survivors.
 */
export function fullColonyReplacementPolicy(state: GameState): FullColonyReplacementPolicy {
  return state.colony.helpless > 0 ? 'displaceHelpless' : 'enterNonColony';
}

/* ------------------------------------------------------------------ *
 * §24.5 — gaining morale at the track maximum
 * ------------------------------------------------------------------ */

/**
 * §2.1 caps the morale track at 10 but no rule says what a gain at 10 does.
 *
 * DECISION: clamp silently, and never bank the overflow.
 *
 * The physical track has nowhere to put the marker, and §11.3 already writes
 * the morale bonus as "subject to the morale-track maximum", which is the one
 * place the source does address it. Applying that reading everywhere keeps
 * morale a bounded resource rather than a hidden reservoir.
 */
export function clampMorale(value: number, max: number): number {
  return Math.max(0, Math.min(max, value));
}

/* ------------------------------------------------------------------ *
 * General tie authority (§15)
 * ------------------------------------------------------------------ */

/**
 * §9.2 and §12 both pick "the lowest-influence survivor" and both need a
 * tie-break; §15 gives the first player general tie authority.
 *
 * DECISION: rather than stopping the game for a first-player prompt on every
 * overrun, ties are broken by *seat order starting from the first player* — the
 * mechanical expression of the same authority, and deterministic for replay.
 * When the tie spans survivors of a single player the choice is offered to that
 * player instead, because §12's casualty choice is theirs to make and §21
 * requires the UI to "pause for casualty choices".
 */
export function orderCasualtyCandidates(
  state: GameState,
  candidates: readonly SurvivorInstance[],
): SurvivorInstance[] {
  const seatRank = (playerId: PlayerId): number => {
    const from = state.seating.indexOf(state.firstPlayerId);
    const at = state.seating.indexOf(playerId);
    if (from < 0 || at < 0) return at;
    return (at - from + state.seating.length) % state.seating.length;
  };
  return [...candidates].sort(
    (a, b) =>
      seatRank(a.controllerId) - seatRank(b.controllerId) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/* ------------------------------------------------------------------ *
 * §24.6 adjacent — colony capacity questions the rulebook leaves to the board
 * ------------------------------------------------------------------ */

/**
 * Where an exiled player's newly gained survivor may enter (§9.4, §13).
 *
 * DECISION: any non-colony location with a free survivor space, in canonical
 * location order. §13 says only "an eligible non-colony location chosen by that
 * player"; eligibility is read as "has room", which is the only constraint the
 * rest of the movement rules impose.
 */
export function eligibleExiledEntryLocations(
  state: GameState,
  content: ContentIndex,
  freeSpaceAt: (loc: LocationId) => number,
): NonColonyLocationId[] {
  return locationOrder(content).filter((loc) => freeSpaceAt(loc) > 0);
}
