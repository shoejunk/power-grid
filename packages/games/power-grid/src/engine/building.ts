/**
 * Phase 4 — Build Houses. §8.
 *
 * Resolved in reverse player order. Each player connects any number of cities,
 * paying "the cheapest connection route from one of their connected cities to
 * the new city, plus the lowest-cost empty house slot in the destination city".
 * Routes may pass through cities without building, cities connected earlier in
 * the same turn are valid new origins, and the route cost is paid again in full
 * for every new city even when edges repeat.
 */

import type { CityId, GameState, PlayerId, ValidationResult } from '../types.js';
import { HOUSE_SLOT_COSTS, SLOTS_OPEN_AT_STEP } from './constants.js';
import { fail, getPlayer, ok, pushLog, trustPlayer, type BuildRecord } from './state.js';
import { cheapestRoutes, findCity, stateMap } from './mapAccess.js';

/* ------------------------------------------------------------------ *
 * Slot maths (§8, §10)
 * ------------------------------------------------------------------ */

/** Index of the lowest empty, currently usable slot in a city, or -1. §8, §10. */
export function lowestOpenSlot(state: GameState, cityId: CityId): number {
  const slots = state.citySlots[cityId];
  if (!slots) return -1;
  const open = SLOTS_OPEN_AT_STEP[state.step];
  for (let i = 0; i < open; i++) {
    if (slots[i] === null || slots[i] === undefined) return i;
  }
  return -1;
}

export function slotCost(slotIndex: number): number {
  return HOUSE_SLOT_COSTS[slotIndex] ?? HOUSE_SLOT_COSTS[HOUSE_SLOT_COSTS.length - 1]!;
}

/** True when the city has no house at all. Used for the Trust blocking rule. §13. */
export function cityIsEmpty(state: GameState, cityId: CityId): boolean {
  const slots = state.citySlots[cityId] ?? [];
  return slots.every((s) => s === null || s === undefined);
}

/** The region containing a player's first city, or null before they start. */
function startingRegion(state: GameState, playerId: PlayerId): string | null {
  const player = getPlayer(state, playerId);
  const firstCity = player.cities[0];
  if (!firstCity) return null;
  return findCity(stateMap(state), firstCity)?.area ?? null;
}

/** Regions already claimed by another human's first city. */
function claimedStartingRegions(state: GameState, playerId: PlayerId): Set<string> {
  const regions = new Set<string>();
  const map = stateMap(state);
  for (const id of state.playerOrder) {
    if (id === playerId) continue;
    const player = getPlayer(state, id);
    if (player.isTrust || player.cities.length === 0) continue;
    const area = findCity(map, player.cities[0]!)?.area;
    if (area) regions.add(area);
  }
  return regions;
}

/**
 * True while an experienced-start marker is still available to be claimed.
 *
 * The marker records a setup choice, not ownership: any player without a
 * network may use it for their first house. A house in the 10-Elektro slot
 * consumes it. The Trust may already occupy the 15-Elektro slot in the
 * combined variant, which must not make the marker unavailable.
 */
export function hasUnclaimedStartCityMarker(state: GameState, cityId: CityId): boolean {
  const slots = state.citySlots[cityId];
  if (!slots || (slots[0] !== null && slots[0] !== undefined)) return false;
  return state.playerOrder.some((id) => getPlayer(state, id).markedStartCity === cityId);
}

/* ------------------------------------------------------------------ *
 * Buildability
 * ------------------------------------------------------------------ */

export interface BuildTarget {
  cityId: CityId;
  slot: number;
  slotCost: number;
  routeCost: number;
  total: number;
  affordable: boolean;
}

/**
 * Reason a city may not be built, or null when the city is legal for `playerId`
 * ignoring money. Split out so `legal.ts` and `validateAction` agree exactly.
 */
export function buildBlockReason(
  state: GameState,
  playerId: PlayerId,
  cityId: CityId,
): string | null {
  const map = stateMap(state);
  const player = getPlayer(state, playerId);
  const city = findCity(map, cityId);
  if (!city) return `Unknown city '${cityId}'`;
  if (!state.zone.includes(city.area)) return 'That city is outside the playing zone';
  if (player.cities.includes(cityId)) return 'You already have a house in that city';
  if (player.housesRemaining <= 0) return 'You have no houses left';

  // Before Step 2, a player's network may not leave the region of their first
  // city. A player who has not started yet must choose a region no other human
  // has used for their first city.
  const region = startingRegion(state, playerId);
  if (region === null && claimedStartingRegions(state, playerId).has(city.area)) {
    return "Your first city must be in a different region from every other player's first city";
  }
  if (state.step === 1) {
    if (region !== null && city.area !== region) {
      return 'During Step 1, you may only build in your starting region';
    }
  }

  /*
   * §8: metropolis — at most one house from the same player across the pair.
   *
   * The pairing is derived symmetrically rather than read from this city alone.
   * `metropolisPartner` is authored data, and a map that declares the link on
   * only one of the two halves would silently enforce the rule in one build
   * order and not the other. Checking both directions makes the rule depend on
   * the relationship, not on how carefully the map file was written.
   */
  const partnerId =
    city.metropolisPartner ??
    map.cities.find((c) => c.metropolisPartner === cityId)?.id;
  if (partnerId && player.cities.includes(partnerId)) {
    return 'You already have a house in the other half of that metropolis';
  }

  // §13: "During Step 1, the six cities initially occupied by Trust houses
  // cannot be connected by human players." Checked before the slot test so the
  // player is told the actual rule rather than "the city is full".
  if (state.step === 1 && (state.trustStartCities ?? []).includes(cityId) && !player.isTrust) {
    return 'Trust starting cities are blocked during Step 1';
  }

  const slot = lowestOpenSlot(state, cityId);
  if (slot < 0) return 'That city has no empty slot at the current Step';

  // §2 experienced start: markers are neutral. A player's first city may claim
  // any unoccupied marker, while the remaining markers stay protected in Step 1.
  if (state.settings.experiencedStart) {
    const markedStartCity = hasUnclaimedStartCityMarker(state, cityId);
    if (!player.hasNetwork && !markedStartCity) {
      return 'Your first city must be an unoccupied marked starting city';
    }
    if (player.hasNetwork && state.step === 1 && markedStartCity) {
      return 'That city is reserved as an unoccupied starting city';
    }
  }

  return null;
}

/** Cheapest route cost from the player's network to every reachable city. §8. */
export function routeCosts(state: GameState, playerId: PlayerId): Map<CityId, number> {
  const player = getPlayer(state, playerId);
  const map = stateMap(state);
  if (!player.hasNetwork || player.cities.length === 0) {
    // First house: no connection cost at all. §8.
    const zero = new Map<CityId, number>();
    for (const c of map.cities) if (state.zone.includes(c.area)) zero.set(c.id, 0);
    return zero;
  }
  return cheapestRoutes(map, state.zone, player.cities);
}

/** Every city the player could legally connect right now, with its total cost. §14. */
export function buildTargets(state: GameState, playerId: PlayerId): BuildTarget[] {
  const player = getPlayer(state, playerId);
  const routes = routeCosts(state, playerId);
  const out: BuildTarget[] = [];
  for (const [cityId, routeCost] of routes) {
    if (buildBlockReason(state, playerId, cityId) !== null) continue;
    const slot = lowestOpenSlot(state, cityId);
    const cost = slotCost(slot);
    const total = routeCost + cost;
    out.push({
      cityId,
      slot,
      slotCost: cost,
      routeCost,
      total,
      affordable: total <= player.money,
    });
  }
  out.sort((a, b) => a.total - b.total || (a.cityId < b.cityId ? -1 : 1));
  return out;
}

export function buildCost(
  state: GameState,
  playerId: PlayerId,
  cityId: CityId,
): { routeCost: number; slot: number; slotCost: number; total: number } | null {
  const routes = routeCosts(state, playerId);
  const routeCost = routes.get(cityId);
  if (routeCost === undefined) return null;
  const slot = lowestOpenSlot(state, cityId);
  if (slot < 0) return null;
  const cost = slotCost(slot);
  return { routeCost, slot, slotCost: cost, total: routeCost + cost };
}

/* ------------------------------------------------------------------ *
 * Actions
 * ------------------------------------------------------------------ */

export function validateBuildCity(
  state: GameState,
  playerId: PlayerId,
  cityId: CityId,
): ValidationResult {
  if (state.phase !== 'building') return fail('Houses may only be built during Phase 4');
  if (state.activePlayerId !== playerId) return fail('It is not your turn to build');
  const player = getPlayer(state, playerId);
  if (player.isTrust) return fail('The Trust does not build on its turn');
  const reason = buildBlockReason(state, playerId, cityId);
  if (reason) return fail(reason);
  const cost = buildCost(state, playerId, cityId);
  if (!cost) return fail('No route from your network to that city inside the playing zone');
  if (cost.total > player.money) {
    return fail(`Connecting ${cityId} costs ${cost.total} Elektro; you have ${player.money}`);
  }
  return ok;
}

export function applyBuildCity(
  state: GameState,
  now: number,
  playerId: PlayerId,
  cityId: CityId,
): void {
  const player = getPlayer(state, playerId);
  const cost = buildCost(state, playerId, cityId)!;
  const wasEmpty = cityIsEmpty(state, cityId);

  player.money -= cost.total;
  state.citySlots[cityId]![cost.slot] = playerId;
  player.cities.push(cityId);
  player.housesRemaining -= 1;
  player.hasNetwork = true;

  pushLog(state, now, {
    category: 'build',
    playerId,
    message: `${player.name} connects ${cityId} for ${cost.total} Elektro (route ${cost.routeCost} + slot ${cost.slotCost}).`,
    data: {
      event: 'cityConnected',
      playerId,
      cityId,
      slot: cost.slot,
      routeCost: cost.routeCost,
      slotCost: cost.slotCost,
      total: cost.total,
      moneyAfter: player.money,
      networkSize: player.cities.length,
    },
  });

  // §13: "While the Trust has houses in supply, whenever a human connects a new
  // empty city, immediately place a Trust house on that city's 15-Elektro space."
  let trustPlaced = false;
  const trust = trustPlayer(state);
  if (trust && !player.isTrust && wasEmpty && trust.housesRemaining > 0) {
    const slots = state.citySlots[cityId]!;
    if (slots[1] === null || slots[1] === undefined) {
      slots[1] = trust.id;
      trust.cities.push(cityId);
      trust.housesRemaining -= 1;
      trustPlaced = true;
      pushLog(state, now, {
        category: 'trust',
        message: `The Trust immediately occupies the 15 Elektro slot of ${cityId}.`,
        data: {
          event: 'trustHousePlaced',
          cityId,
          slot: 1,
          housesRemaining: trust.housesRemaining,
          phase: 'building',
        },
      });
    }
  }

  const record: BuildRecord = {
    playerId,
    cityId,
    slot: cost.slot,
    routeCost: cost.routeCost,
    slotCost: cost.slotCost,
    trustPlaced,
  };
  state.buildHistory = [...(state.buildHistory ?? []), record];
}

/* ------------------------------------------------------------------ *
 * Undo (§14 — the UI needs to walk back a mis-click inside a turn)
 * ------------------------------------------------------------------ */

export function validateUndoLastBuild(state: GameState, playerId: PlayerId): ValidationResult {
  if (state.phase !== 'building') return fail('Nothing to undo outside Phase 4');
  if (state.activePlayerId !== playerId) return fail('It is not your turn');
  const history = state.buildHistory ?? [];
  const last = history[history.length - 1];
  if (!last || last.playerId !== playerId) return fail('You have not built anything this turn');
  return ok;
}

export function applyUndoLastBuild(state: GameState, now: number, playerId: PlayerId): void {
  const history = state.buildHistory ?? [];
  const last = history[history.length - 1]!;
  const player = getPlayer(state, playerId);

  state.citySlots[last.cityId]![last.slot] = null;
  player.cities = player.cities.filter((c) => c !== last.cityId);
  player.housesRemaining += 1;
  player.money += last.routeCost + last.slotCost;
  player.hasNetwork = player.cities.length > 0;

  if (last.trustPlaced) {
    const trust = trustPlayer(state);
    if (trust) {
      state.citySlots[last.cityId]![1] = null;
      trust.cities = trust.cities.filter((c) => c !== last.cityId);
      trust.housesRemaining += 1;
    }
  }

  state.buildHistory = history.slice(0, -1);
  pushLog(state, now, {
    category: 'build',
    playerId,
    message: `${player.name} takes back the house in ${last.cityId}.`,
    data: {
      event: 'buildUndone',
      playerId,
      cityId: last.cityId,
      refund: last.routeCost + last.slotCost,
      moneyAfter: player.money,
    },
  });
}
