/**
 * Engine-facing constants. Everything that is genuinely *data* lives in
 * `src/data`; this module re-exports it so rules files have a single import
 * site, and adds the few engine-only defaults.
 */

export {
  END_GAME_THRESHOLD,
  HOUSE_SLOT_COSTS,
  HOUSES_PER_PLAYER,
  MARKET_LAYOUT,
  MAX_PLANTS_PER_PLAYER,
  PAYMENT_TABLE,
  REFILL_TABLE,
  SLOTS_OPEN_AT_STEP,
  STARTING_MONEY,
  STEP2_THRESHOLD,
  TRUST_HOUSES,
  TRUST_INITIAL_PLACEMENTS,
  USA_COAL_STORAGE_PRICE,
  ZONE_AREA_COUNT,
  payoutFor,
  refillFor,
} from '../data/tables.js';

/** Used when a player count has no explicit setup-removal row. §2 step 9. */
export const SETUP_REMOVALS_FALLBACK = { plug: 0, socket: 0 } as const;

/** Cost of the first house in a city — also the cost of a player's first city. §8. */
export const FIRST_HOUSE_COST = 10;
