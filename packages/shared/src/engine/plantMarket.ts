/**
 * Power-plant market primitives: sorting, drawing replacements, the discount
 * token, and removals. §1, §6, §9.3, §10.
 *
 * This module deliberately knows nothing about *when* a Step changes — it only
 * reports that the Step 3 card surfaced, and `steps.ts` applies the timing
 * rules. That keeps the dependency graph acyclic.
 */

import type { GameState } from '../types.js';
import { STEP3_PLANT_ID } from '../types.js';
import { Rng } from '../rng.js';
import { pushLog, minOf, maxOf } from './state.js';

/* ------------------------------------------------------------------ *
 * RNG plumbing (§14 determinism)
 * ------------------------------------------------------------------ */

/** Runs `fn` with an Rng seeded from the state, persisting the advanced cursor. */
export function withRng<T>(state: GameState, fn: (rng: Rng) => T): T {
  const rng = new Rng(state.settings.seed, state.rngCursor);
  const out = fn(rng);
  state.rngCursor = rng.position;
  return out;
}

/* ------------------------------------------------------------------ *
 * Sorting (§6 "resort all market plants by number")
 * ------------------------------------------------------------------ */

/**
 * Re-splits current/future by number.
 *  - Steps 1–2: four lowest are current, the rest future (Step 3 card, id 9999,
 *    naturally lands at the end of the future row).
 *  - Step 3: every plant is current, there is no future row. §9.3, §10.
 */
export function sortMarket(state: GameState): void {
  const all = [...state.plantMarket.current, ...state.plantMarket.future].sort((a, b) => a - b);
  if (state.step === 3) {
    state.plantMarket.current = all;
    state.plantMarket.future = [];
  } else {
    state.plantMarket.current = all.slice(0, 4);
    state.plantMarket.future = all.slice(4);
  }
}

/** Every plant currently on the board (current + future). */
export function marketPlants(state: GameState): number[] {
  return [...state.plantMarket.current, ...state.plantMarket.future];
}

/** Removes a plant id from wherever it sits in the market. */
export function removeFromMarket(state: GameState, plantId: number): boolean {
  const m = state.plantMarket;
  const ci = m.current.indexOf(plantId);
  if (ci >= 0) {
    m.current.splice(ci, 1);
    return true;
  }
  const fi = m.future.indexOf(plantId);
  if (fi >= 0) {
    m.future.splice(fi, 1);
    return true;
  }
  return false;
}

/* ------------------------------------------------------------------ *
 * Drawing replacements (§6, §9.3, §10)
 * ------------------------------------------------------------------ */

export type DrawOutcome =
  | { kind: 'placed'; plantId: number }
  /** Step 3 card surfaced. It is NOT in the market — the caller applies §10 timing. */
  | { kind: 'step3' }
  /** Stack exhausted; no replacement exists. §9.3. */
  | { kind: 'empty' };

/**
 * Draws one replacement from the stack into the market.
 *
 * Implements §6: "While the discount token remains on a plant, if the first
 * replacement drawn has a printed number lower than the discounted plant's
 * printed number, remove that replacement and the discount token, then draw
 * another replacement immediately."
 */
export function drawReplacement(state: GameState, now: number, reason: string): DrawOutcome {
  const m = state.plantMarket;
  for (let guard = 0; guard < 64; guard++) {
    const drawn = m.stack.shift();
    if (drawn === undefined) {
      pushLog(state, now, {
        category: 'market',
        message: 'The power plant stack is exhausted; no replacement is drawn.',
        data: { event: 'stackExhausted', reason },
      });
      return { kind: 'empty' };
    }

    if (drawn === STEP3_PLANT_ID) {
      m.step3CardRevealed = true;
      // §10: "Immediately shuffle the plant stack containing the cards below
      // the Step 3 card and place it face down again."
      const before = m.stack.slice();
      withRng(state, (rng) => {
        m.stack = rng.shuffle(m.stack);
      });
      pushLog(state, now, {
        category: 'step',
        message: 'The Step 3 card is drawn. The remaining plant stack is reshuffled.',
        data: { event: 'step3CardDrawn', reason, stackSize: before.length },
      });
      return { kind: 'step3' };
    }

    if (m.discountReplacementRuleArmed && m.discountPlantId !== null && drawn < m.discountPlantId) {
      m.removed.push(drawn);
      const token = m.discountPlantId;
      m.discountPlantId = null;
      m.discountReplacementRuleArmed = false;
      pushLog(state, now, {
        category: 'market',
        message:
          `Plant ${drawn} is drawn below the discounted plant ${token}; it is removed from the game ` +
          'along with the discount token, and another replacement is drawn.',
        data: { event: 'discountReplacementRemoved', removedPlantId: drawn, discountPlantId: token },
      });
      continue;
    }

    m.future.push(drawn);
    sortMarket(state);
    pushLog(state, now, {
      category: 'market',
      message: `Plant ${drawn} is drawn as a replacement.`,
      data: {
        event: 'replacementDrawn',
        plantId: drawn,
        reason,
        current: state.plantMarket.current.slice(),
        future: state.plantMarket.future.slice(),
      },
    });
    return { kind: 'placed', plantId: drawn };
  }
  /* istanbul ignore next — the guard can only trip on corrupt data */
  throw new Error('drawReplacement: runaway discount-replacement loop');
}

/* ------------------------------------------------------------------ *
 * Discount token (§6)
 * ------------------------------------------------------------------ */

/** At the start of Phase 2 the token sits on the lowest current-market plant. §6. */
export function placeDiscountToken(state: GameState, now: number): void {
  const lowest = minOf(state.plantMarket.current);
  state.plantMarket.discountPlantId = lowest;
  state.plantMarket.discountReplacementRuleArmed = lowest !== null;
  if (lowest !== null) {
    pushLog(state, now, {
      category: 'market',
      message: `The discount token is placed on plant ${lowest}; its minimum bid is 1 Elektro.`,
      data: { event: 'discountTokenPlaced', plantId: lowest },
    });
  }
}

/** Minimum opening bid for a plant. §6. */
export function minimumBid(state: GameState, plantId: number): number {
  return state.plantMarket.discountPlantId === plantId ? 1 : plantId;
}

/**
 * End of Phase 2: "If nobody buys the discounted plant, remove it from the game
 * at the end of Phase 2, draw a replacement, and leave the discount token next
 * to the market." §6.
 */
export function resolveUnsoldDiscountPlant(state: GameState, now: number): DrawOutcome | null {
  const m = state.plantMarket;
  const plantId = m.discountPlantId;
  if (plantId === null) return null;
  m.discountPlantId = null;
  m.discountReplacementRuleArmed = false;
  if (!removeFromMarket(state, plantId)) return null;
  m.removed.push(plantId);
  pushLog(state, now, {
    category: 'market',
    message: `Nobody bought the discounted plant ${plantId}; it is removed from the game.`,
    data: { event: 'discountPlantRemoved', plantId },
  });
  const outcome = drawReplacement(state, now, 'discountPlantRemoved');
  sortMarket(state);
  return outcome;
}

/* ------------------------------------------------------------------ *
 * Removals
 * ------------------------------------------------------------------ */

/** Removes the lowest-numbered current-market plant from the game. §9.3, §10. */
export function removeLowestCurrent(state: GameState, now: number, reason: string): number | null {
  const lowest = minOf(state.plantMarket.current);
  if (lowest === null) return null;
  removeFromMarket(state, lowest);
  state.plantMarket.removed.push(lowest);
  if (state.plantMarket.discountPlantId === lowest) {
    state.plantMarket.discountPlantId = null;
    state.plantMarket.discountReplacementRuleArmed = false;
  }
  pushLog(state, now, {
    category: 'market',
    message: `Plant ${lowest} is removed from the market.`,
    data: { event: 'lowestPlantRemoved', plantId: lowest, reason },
  });
  return lowest;
}

/**
 * §9.3 Steps 1–2: "Remove the highest-numbered plant in the future market ...
 * and place it face down under the plant supply stack."
 */
export function buryHighestFuture(state: GameState, now: number): number | null {
  const highest = maxOf(state.plantMarket.future);
  if (highest === null) return null;
  removeFromMarket(state, highest);
  state.plantMarket.stack.push(highest);
  if (state.plantMarket.discountPlantId === highest) {
    state.plantMarket.discountPlantId = null;
    state.plantMarket.discountReplacementRuleArmed = false;
  }
  pushLog(state, now, {
    category: 'market',
    message: `Plant ${highest} is placed face down under the plant stack.`,
    data: { event: 'highestPlantBuried', plantId: highest },
  });
  return highest;
}
