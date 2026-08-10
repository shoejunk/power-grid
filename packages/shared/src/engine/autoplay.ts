/**
 * Default action resolution.
 *
 * Used where the game must proceed without a human decision: a bot seat has to
 * act. The contract is narrow but strict: **for any state where the engine is
 * waiting on this player, return an action the engine will accept.** Returning
 * null hangs the game — and so does returning something illegal, because the
 * server has nothing else to try.
 *
 * There are two layers here, and the split is deliberate:
 *
 *  - `bot.ts` decides what a competent player *wants* to do — buy a plant it
 *    can afford to fuel, buy the fuel, connect the cities it can light. That is
 *    a planner, and planners can be wrong about the rules at the margins.
 *  - this module holds the safety net: the cheapest, most conservative legal
 *    move in every phase, with no judgement in it at all. Passing is preferred
 *    wherever it is legal — except that §6 makes passing illegal during the
 *    first round's mandatory purchase, so every phase still needs a concrete
 *    non-pass fallback.
 *
 * The planner's move is validated before it is offered, and anything that fails
 * validation or throws falls through to the safety net. The anti-deadlock
 * property therefore does not depend on the planner being correct.
 *
 * Rules knowledge lives here rather than in the server: the server proposes
 * nothing of its own, it just asks for an action and applies it.
 */

import type { CityId, GameAction, GameState, PlayerId } from '../types.js';
import { legalActions, type LegalActions } from './legal.js';
import { getPlayer } from './state.js';
import { getPlant } from '../data/plants.js';
import { botActionFor } from './bot.js';
import {
  validateNominatePlant,
  validatePassBid,
  validatePassNomination,
  validateScrapPlant,
  validateSubmitBidRange,
} from './auction.js';
import { validateBuyResources } from './resources.js';
import { validateBuildCity } from './building.js';
import { validatePowerCities } from './bureaucracy.js';
import { validateMarkStartCity, validatePlaceTrustHouse } from './setup.js';

/**
 * The action `playerId` should take in the current state, or null when the
 * engine is not waiting on them.
 *
 * Prefers the planner's move; falls back to the conservative default whenever
 * the planner declines, errs, or proposes something the engine would reject.
 */
export function defaultActionFor(state: GameState, playerId: PlayerId): GameAction | null {
  const legal = legalActions(state, playerId);
  if (!legal.isActive) return null;

  const planned = plannedAction(state, playerId, legal);
  if (planned) return planned;

  return safeActionFor(state, legal);
}

/** The planner's move, but only if the engine would actually accept it. */
function plannedAction(
  state: GameState,
  playerId: PlayerId,
  legal: LegalActions,
): GameAction | null {
  let action: GameAction | null;
  try {
    action = botActionFor(state, playerId, legal);
  } catch {
    /* A planner fault must never stall a table. Fall through to the safety net. */
    return null;
  }
  if (!action) return null;
  return isAcceptable(state, playerId, action) ? action : null;
}

/**
 * Local re-validation, mirroring `validateAction` for the subset of actions the
 * planner can propose. Written against the individual rule modules rather than
 * the engine's public entry point, which imports this file.
 */
function isAcceptable(state: GameState, playerId: PlayerId, action: GameAction): boolean {
  const active = state.activePlayerId === playerId;
  switch (action.type) {
    case 'markStartCity':
      return validateMarkStartCity(state, playerId, action.cityId).ok;
    case 'placeTrustHouse':
      return validatePlaceTrustHouse(state, playerId, action.cityId).ok;
    case 'nominatePlant':
      return validateNominatePlant(state, playerId, action.plantId, action.bid, action.maxBid).ok;
    case 'passNomination':
      return validatePassNomination(state, playerId).ok;
    case 'submitBidRange':
      return validateSubmitBidRange(state, playerId, action.minBid, action.maxBid).ok;
    case 'passBid':
      return validatePassBid(state, playerId).ok;
    case 'scrapPlant':
      return validateScrapPlant(state, playerId, action.plantId).ok;
    case 'buyResources':
      return validateBuyResources(state, playerId, action.purchases).ok;
    case 'passResources':
      return state.phase === 'resources' && active;
    case 'buildCity':
      return validateBuildCity(state, playerId, action.cityId).ok;
    case 'passBuilding':
      return state.phase === 'building' && active;
    case 'powerCities':
      return validatePowerCities(state, playerId, action.decision).ok;
    default:
      return false;
  }
}

/* ------------------------------------------------------------------ *
 * The safety net
 * ------------------------------------------------------------------ */

/**
 * Cheapest legal action for the player the engine is waiting on.
 *
 * "Cheapest" means: spend the least money, acquire the least, and change the
 * board as little as the rules permit.
 */
export function safeActionFor(state: GameState, legal: LegalActions): GameAction | null {
  switch (state.phase) {
    case 'setup':
      return setupDefault(state, legal);
    case 'auction':
      return auctionDefault(legal);
    case 'resources':
      /* Buying nothing is always legal — a player may decline to buy. §7. */
      return legal.canPassResources ? { type: 'passResources' } : null;
    case 'building':
      /* Building nothing is always legal — a player may defer their network. §8. */
      return legal.canPassBuilding ? { type: 'passBuilding' } : null;
    case 'bureaucracy':
      return bureaucracyDefault(legal);
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ *
 * Phase 2 — auction (§6)
 * ------------------------------------------------------------------ */

function auctionDefault(legal: LegalActions): GameAction | null {
  /* A pending scrap must be resolved before anything else can happen. Discard
     the least capable plant, measured by cities powered then by number, so the
     automatic choice is defensible rather than arbitrary. §6. */
  if (legal.scrappablePlants.length > 0) {
    const worst = [...legal.scrappablePlants].sort((a, b) => {
      const pa = getPlant(a);
      const pb = getPlant(b);
      return pa.cities - pb.cities || pa.id - pb.id;
    })[0]!;
    return { type: 'scrapPlant', plantId: worst };
  }

  /* Mid-auction: decline to raise. Never bids up a plant as a fallback. */
  if (legal.bidding) return { type: 'passBid' };

  /* Nominating: pass if the rules allow it. */
  if (legal.canPassNomination) return { type: 'passNomination' };

  /* No pass available — this is the §6 first-round mandatory purchase. Nominate
     the cheapest plant the player can actually afford, at its minimum bid.
     Without this branch the game deadlocks, which is what happened before. */
  const affordable = legal.nominatablePlants.filter((p) => p.affordable);
  if (affordable.length > 0) {
    const cheapest = [...affordable].sort((a, b) => a.minimumBid - b.minimumBid)[0]!;
    return { type: 'nominatePlant', plantId: cheapest.plantId, bid: cheapest.minimumBid };
  }

  /* Cannot afford any plant. The engine releases players in this position
     (see docs/RULES-NOTES.md interpretation 3), so a pass should now be legal. */
  return legal.canPassNomination ? { type: 'passNomination' } : null;
}

/* ------------------------------------------------------------------ *
 * Phase 5 — bureaucracy (§9.1)
 * ------------------------------------------------------------------ */

function bureaucracyDefault(legal: LegalActions): GameAction | null {
  /* Power as many cities as possible. Unlike bidding or building, this costs
     the player nothing they would want to keep — stored fuel exists to be
     burnt, and supplying fewer cities only forfeits income. Picking the
     highest payout is unambiguously in the player's interest. */
  const best = [...legal.powerOptions].sort(
    (a, b) => b.payoutAtMax - a.payoutAtMax || a.plantIds.length - b.plantIds.length,
  )[0];

  if (best) {
    return {
      type: 'powerCities',
      decision: { operatePlantIds: best.plantIds, citiesSupplied: best.maxCities },
    };
  }

  /* No plants, or no fuel: supply nothing and take the guaranteed 10₤. §9.1. */
  return { type: 'powerCities', decision: { operatePlantIds: [], citiesSupplied: 0 } };
}

/* ------------------------------------------------------------------ *
 * Setup (§2)
 * ------------------------------------------------------------------ */

function setupDefault(state: GameState, legal: LegalActions): GameAction | null {
  /*
   * Zone selection MUST have a default. If the host drops between starting the
   * game and picking the zone, nobody else is permitted to choose (§2 gives it
   * to the host) and the table is stranded forever — the stale state is then
   * faithfully persisted, so even a server restart cannot recover it.
   *
   * An empty `areas` array is a legal request for the engine to grow a random
   * contiguous zone from the seeded stream, which keeps this deterministic.
   */
  if (legal.zoneRequired) return { type: 'selectZone', areas: [] };

  if (legal.startCityChoices.length > 0) {
    return { type: 'markStartCity', cityId: pickCity(state, legal.startCityChoices) };
  }
  if (legal.trustHouseCities.length > 0) {
    return { type: 'placeTrustHouse', cityId: pickCity(state, legal.trustHouseCities) };
  }
  return null;
}

/**
 * Deterministic city choice. Sorting by id rather than consulting the RNG keeps
 * `defaultActionFor` a pure function of state — advancing the seeded stream here
 * would desynchronise replay from the recorded action log (§14).
 */
function pickCity(state: GameState, choices: readonly CityId[]): CityId {
  void getPlayer(state, state.activePlayerId!);
  return [...choices].sort()[0]!;
}
