/**
 * Electricity production maths shared by Phase 5 payouts (§9.1) and the
 * end-game winner evaluation (§11).
 *
 * §1 is strict: "Standard plants require exactly the printed number of matching
 * resource tokens to operate. A plant cannot be operated with fewer or more fuel
 * tokens than its requirement." and "A plant can supply at most its printed
 * number of cities per round." So a plant set is operable only when every plant
 * in it can be saturated from the player's pooled, freely rearrangeable storage.
 */

import type { GameState, PlayerId } from '../types.js';
import { getPlant } from '../data/plants.js';
import { getPlayer } from './state.js';
import { slotsSaturated, type PlantSlot } from './allocation.js';
import { storedPool } from './resources.js';

/** Fuel slots for a chosen set of plants: each must be filled *exactly*. §1. */
export function fuelSlots(plantIds: readonly number[]): PlantSlot[] {
  return plantIds.map((id) => {
    const p = getPlant(id);
    return { accepts: p.accepts.slice(), cap: p.fuel };
  });
}

export function canOperate(
  state: GameState,
  playerId: PlayerId,
  plantIds: readonly number[],
): boolean {
  return slotsSaturated(storedPool(state, playerId), fuelSlots(plantIds));
}

export interface SupplyOption {
  plantIds: number[];
  /** Electricity produced — may exceed the player's network; surplus is wasted. §1. */
  capacity: number;
}

/** Every operable plant combination, strongest first. */
export function operableCombinations(state: GameState, playerId: PlayerId): SupplyOption[] {
  const owned = getPlayer(state, playerId).plants.map((p) => p.plantId).sort((a, b) => a - b);
  const pool = storedPool(state, playerId);
  const out: SupplyOption[] = [];
  for (let mask = 0; mask < 1 << owned.length; mask++) {
    const ids = owned.filter((_, i) => (mask & (1 << i)) !== 0);
    if (!slotsSaturated(pool, fuelSlots(ids))) continue;
    out.push({ plantIds: ids, capacity: ids.reduce((s, id) => s + getPlant(id).cities, 0) });
  }
  out.sort((a, b) => b.capacity - a.capacity || a.plantIds.length - b.plantIds.length);
  return out;
}

/** The most cities a player could supply right now — production capped by network size. */
export function bestSupply(
  state: GameState,
  playerId: PlayerId,
): SupplyOption & { cities: number } {
  const network = getPlayer(state, playerId).cities.length;
  let best: SupplyOption & { cities: number } = { plantIds: [], capacity: 0, cities: 0 };
  for (const opt of operableCombinations(state, playerId)) {
    const cities = Math.min(opt.capacity, network);
    if (
      cities > best.cities ||
      (cities === best.cities && opt.plantIds.length < best.plantIds.length)
    ) {
      best = { ...opt, cities };
    }
  }
  return best;
}
