import type { PowerPlant } from '../types.js';
import { STEP3_PLANT_ID } from '../types.js';

/**
 * The 42 power plant cards plus the Step 3 card. §1, §2.
 *
 * `category` follows the rulebook's card backs: `plug` for the weaker cards
 * (03–15, used to seed the opening market) and `socket` for the rest.
 *
 * `accepts` length 0 = ecological, length 1 = single fuel, length 2 = hybrid
 * (coal and/or oil in any combination totalling `fuel`).
 */
export const PLANTS: readonly PowerPlant[] = [
  // ---- plug-backed (03–15) ------------------------------------------------
  { id: 3,  category: 'plug',   accepts: ['oil'],            fuel: 2, cities: 1 },
  { id: 4,  category: 'plug',   accepts: ['coal'],           fuel: 2, cities: 1 },
  { id: 5,  category: 'plug',   accepts: ['coal', 'oil'],    fuel: 2, cities: 1 },
  { id: 6,  category: 'plug',   accepts: ['garbage'],        fuel: 1, cities: 1 },
  { id: 7,  category: 'plug',   accepts: ['oil'],            fuel: 3, cities: 2 },
  { id: 8,  category: 'plug',   accepts: ['coal'],           fuel: 3, cities: 2 },
  { id: 9,  category: 'plug',   accepts: ['oil'],            fuel: 1, cities: 1 },
  { id: 10, category: 'plug',   accepts: ['coal'],           fuel: 2, cities: 2 },
  { id: 11, category: 'plug',   accepts: ['uranium'],        fuel: 1, cities: 2 },
  { id: 12, category: 'plug',   accepts: ['coal', 'oil'],    fuel: 2, cities: 2 },
  { id: 13, category: 'plug',   accepts: [],                 fuel: 0, cities: 1 },
  { id: 14, category: 'plug',   accepts: ['garbage'],        fuel: 2, cities: 2 },
  { id: 15, category: 'plug',   accepts: ['coal'],           fuel: 2, cities: 3 },

  // ---- socket-backed (16–50) ---------------------------------------------
  { id: 16, category: 'socket', accepts: ['oil'],            fuel: 2, cities: 3 },
  { id: 17, category: 'socket', accepts: ['uranium'],        fuel: 1, cities: 2 },
  { id: 18, category: 'socket', accepts: [],                 fuel: 0, cities: 2 },
  { id: 19, category: 'socket', accepts: ['garbage'],        fuel: 2, cities: 3 },
  { id: 20, category: 'socket', accepts: ['coal'],           fuel: 3, cities: 5 },
  { id: 21, category: 'socket', accepts: ['coal', 'oil'],    fuel: 2, cities: 4 },
  { id: 22, category: 'socket', accepts: [],                 fuel: 0, cities: 2 },
  { id: 23, category: 'socket', accepts: ['uranium'],        fuel: 1, cities: 3 },
  { id: 24, category: 'socket', accepts: ['garbage'],        fuel: 2, cities: 4 },
  { id: 25, category: 'socket', accepts: ['coal'],           fuel: 2, cities: 5 },
  { id: 26, category: 'socket', accepts: ['oil'],            fuel: 2, cities: 5 },
  { id: 27, category: 'socket', accepts: [],                 fuel: 0, cities: 3 },
  { id: 28, category: 'socket', accepts: ['uranium'],        fuel: 1, cities: 4 },
  { id: 29, category: 'socket', accepts: ['coal', 'oil'],    fuel: 1, cities: 4 },
  { id: 30, category: 'socket', accepts: ['garbage'],        fuel: 3, cities: 6 },
  { id: 31, category: 'socket', accepts: ['coal'],           fuel: 3, cities: 6 },
  { id: 32, category: 'socket', accepts: ['oil'],            fuel: 3, cities: 6 },
  { id: 33, category: 'socket', accepts: [],                 fuel: 0, cities: 4 },
  { id: 34, category: 'socket', accepts: ['uranium'],        fuel: 1, cities: 5 },
  { id: 35, category: 'socket', accepts: ['oil'],            fuel: 1, cities: 5 },
  { id: 36, category: 'socket', accepts: ['coal'],           fuel: 3, cities: 7 },
  { id: 37, category: 'socket', accepts: [],                 fuel: 0, cities: 4 },
  { id: 38, category: 'socket', accepts: ['garbage'],        fuel: 3, cities: 7 },
  { id: 39, category: 'socket', accepts: ['uranium'],        fuel: 1, cities: 6 },
  { id: 40, category: 'socket', accepts: ['oil'],            fuel: 2, cities: 6 },
  { id: 42, category: 'socket', accepts: ['coal'],           fuel: 2, cities: 6 },
  { id: 44, category: 'socket', accepts: [],                 fuel: 0, cities: 5 },
  { id: 46, category: 'socket', accepts: ['coal', 'oil'],    fuel: 3, cities: 7 },
  { id: 50, category: 'socket', accepts: [],                 fuel: 0, cities: 6 },

  // ---- the Step 3 card ----------------------------------------------------
  { id: STEP3_PLANT_ID, category: 'socket', accepts: [], fuel: 0, cities: 0, isStep3: true },
] as const;

const PLANT_INDEX: ReadonlyMap<number, PowerPlant> = new Map(PLANTS.map((p) => [p.id, p]));

export function getPlant(id: number): PowerPlant {
  const p = PLANT_INDEX.get(id);
  if (!p) throw new Error(`Unknown power plant: ${id}`);
  return p;
}

/** All plug-backed plants (03–15). §2 step 8. */
export const PLUG_PLANT_IDS: readonly number[] = PLANTS.filter(
  (p) => p.category === 'plug' && !p.isStep3,
).map((p) => p.id);

/** All socket-backed plants (16–50), excluding the Step 3 card. §2 step 9. */
export const SOCKET_PLANT_IDS: readonly number[] = PLANTS.filter(
  (p) => p.category === 'socket' && !p.isStep3,
).map((p) => p.id);

/**
 * Cards removed from the game during setup, by player count. §2 step 9.
 * Applied to the plug plants left over after the opening market is dealt,
 * and to the socket plants.
 */
export const SETUP_REMOVALS: Record<number, { plug: number; socket: number }> = {
  2: { plug: 1, socket: 5 },
  3: { plug: 2, socket: 6 },
  4: { plug: 1, socket: 3 },
  5: { plug: 0, socket: 0 },
  6: { plug: 0, socket: 0 },
};
