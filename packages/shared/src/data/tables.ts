import type { MapId, ResourceBundle, ResourceType, Step } from '../types.js';

/* ------------------------------------------------------------------ *
 * Playing zone size (§1)
 * ------------------------------------------------------------------ */

export const ZONE_AREA_COUNT: Record<number, number> = {
  2: 3,
  3: 3,
  4: 4,
  5: 5,
  6: 5,
};

/* ------------------------------------------------------------------ *
 * Payment summary — Elektro earned for N supplied cities (§9.1)
 * Index = cities supplied. Index 0 is the guaranteed minimum of 10.
 * ------------------------------------------------------------------ */

export const PAYMENT_TABLE: readonly number[] = [
  10, 22, 33, 44, 54, 64, 73, 82, 90, 98, 105, 112, 118, 124, 129, 134, 138, 142, 145, 148, 150,
] as const;

export function payoutFor(citiesSupplied: number): number {
  const idx = Math.max(0, Math.min(citiesSupplied, PAYMENT_TABLE.length - 1));
  return PAYMENT_TABLE[idx]!;
}

/* ------------------------------------------------------------------ *
 * Step 2 trigger and end-game thresholds (§10, §11)
 * ------------------------------------------------------------------ */

export const STEP2_THRESHOLD: Record<number, number> = {
  2: 7,
  3: 7,
  4: 7,
  5: 7,
  6: 6,
};

export const END_GAME_THRESHOLD: Record<number, number> = {
  2: 18,
  3: 17,
  4: 17,
  5: 15,
  6: 14,
};

/* ------------------------------------------------------------------ *
 * House slot costs by slot index (§8)
 * ------------------------------------------------------------------ */

export const HOUSE_SLOT_COSTS: readonly number[] = [10, 15, 20] as const;

/** Houses allowed per city at each Step. §8. */
export const SLOTS_OPEN_AT_STEP: Record<Step, number> = { 1: 1, 2: 2, 3: 3 };

/* ------------------------------------------------------------------ *
 * Resource market layout (§1)
 * ------------------------------------------------------------------ */

export interface MarketLayout {
  /** Price of each space, cheapest first. */
  prices: number[];
  /** Tokens each space holds. */
  capacityPerSpace: number;
  /** Total tokens in the game for this resource. */
  totalTokens: number;
  /** Prices that start occupied. §1 initial market table. */
  initiallyOccupiedPrices: number[];
}

export const MARKET_LAYOUT: Record<ResourceType, MarketLayout> = {
  coal: {
    prices: [1, 2, 3, 4, 5, 6, 7, 8],
    capacityPerSpace: 3,
    totalTokens: 24,
    initiallyOccupiedPrices: [1, 2, 3, 4, 5, 6, 7, 8],
  },
  oil: {
    prices: [1, 2, 3, 4, 5, 6, 7, 8],
    capacityPerSpace: 3,
    totalTokens: 24,
    initiallyOccupiedPrices: [3, 4, 5, 6, 7, 8],
  },
  garbage: {
    prices: [1, 2, 3, 4, 5, 6, 7, 8],
    capacityPerSpace: 3,
    totalTokens: 24,
    initiallyOccupiedPrices: [6, 7, 8],
  },
  uranium: {
    prices: [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 16],
    capacityPerSpace: 1,
    totalTokens: 12,
    initiallyOccupiedPrices: [14, 16],
  },
};

/* ------------------------------------------------------------------ *
 * Resource refill summary (§9.2)
 *
 * Keyed by map → player count → step. Values are tokens added to the market
 * from the supply, filling the most expensive empty space first.
 * ------------------------------------------------------------------ */

export type RefillRow = ResourceBundle;

type RefillByStep = Record<Step, RefillRow>;

const r = (coal: number, oil: number, garbage: number, uranium: number): RefillRow => ({
  coal,
  oil,
  garbage,
  uranium,
});

export const REFILL_TABLE: Record<MapId, Record<number, RefillByStep>> = {
  germany: {
    2: { 1: r(3, 2, 1, 1), 2: r(4, 2, 2, 1), 3: r(3, 4, 3, 1) },
    3: { 1: r(4, 2, 1, 1), 2: r(5, 3, 2, 1), 3: r(3, 4, 3, 1) },
    4: { 1: r(5, 3, 2, 1), 2: r(6, 4, 3, 2), 3: r(4, 5, 4, 2) },
    5: { 1: r(5, 4, 3, 2), 2: r(7, 5, 3, 3), 3: r(5, 6, 5, 2) },
    6: { 1: r(7, 5, 3, 2), 2: r(9, 6, 5, 3), 3: r(6, 7, 6, 3) },
  },
  usa: {
    2: { 1: r(4, 2, 1, 1), 2: r(5, 2, 2, 1), 3: r(4, 4, 3, 1) },
    3: { 1: r(5, 2, 1, 1), 2: r(6, 3, 2, 1), 3: r(4, 4, 3, 1) },
    4: { 1: r(6, 3, 2, 1), 2: r(7, 4, 3, 2), 3: r(5, 5, 4, 2) },
    5: { 1: r(6, 4, 3, 2), 2: r(8, 5, 3, 3), 3: r(6, 6, 5, 2) },
    6: { 1: r(8, 5, 3, 2), 2: r(10, 6, 5, 3), 3: r(7, 7, 6, 3) },
  },
};

export function refillFor(mapId: MapId, playerCount: number, step: Step): RefillRow {
  const byCount = REFILL_TABLE[mapId][playerCount];
  if (!byCount) throw new Error(`No refill data for ${mapId} / ${playerCount} players`);
  return byCount[step];
}

/* ------------------------------------------------------------------ *
 * Misc constants
 * ------------------------------------------------------------------ */

export const STARTING_MONEY = 50;
export const HOUSES_PER_PLAYER = 22;
export const MAX_PLANTS_PER_PLAYER = 3;

/** Trust: 16 houses on the board plus one for the player-order track. §13. */
export const TRUST_HOUSES = 16;
export const TRUST_INITIAL_PLACEMENTS = 6;

/** USA: coal price once the market is exhausted. §12. */
export const USA_COAL_STORAGE_PRICE = 8;
