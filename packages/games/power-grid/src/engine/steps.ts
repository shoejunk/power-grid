/**
 * Game Steps and the transitions between them. §10.
 *
 * Timing is the whole game here:
 *  - Step 2 starts *at the start of Phase 5* once a human reached the threshold
 *    during Phase 4.
 *  - Step 3 starts at the *next phase* after the Step 3 card is drawn, and the
 *    two draw sites (Phase 2 and Phase 5) have different removal sequences.
 *  - "If Step 3 begins before Step 2, apply all Step 2 changes first, then apply
 *    the Step 3 changes."
 */

import type { GameState } from '../types.js';
import { STEP3_PLANT_ID } from '../types.js';
import { STEP2_THRESHOLD } from '../data/tables.js';
import { pushLog, humanPlayers } from './state.js';
import {
  drawReplacement,
  marketPlants,
  removeFromMarket,
  removeLowestCurrent,
  sortMarket,
} from './plantMarket.js';

/** §10: Step 2 begins once at least one *human* has the threshold city count. */
export function step2ThresholdReached(state: GameState): boolean {
  const threshold = STEP2_THRESHOLD[state.settings.playerCount];
  if (threshold === undefined) return false;
  // §13: "Trust houses do not trigger Step 2."
  return humanPlayers(state).some((p) => p.cities.length >= threshold);
}

/**
 * Applies every Step 2 change. §10.
 * "Remove the lowest-numbered plant in the current market and replace it once
 * from the plant stack."
 */
export function beginStep2(state: GameState, now: number, reason: string): void {
  if (state.step2Triggered) return;
  state.step2Triggered = true;
  if (state.step === 1) state.step = 2;
  pushLog(state, now, {
    category: 'step',
    message: 'Step 2 begins: two houses per city, the second costs 15 Elektro.',
    data: {
      event: 'stepChange',
      step: 2,
      reason,
      threshold: STEP2_THRESHOLD[state.settings.playerCount],
    },
  });
  removeLowestCurrent(state, now, 'step2Transition');
  const outcome = drawReplacement(state, now, 'step2Transition');
  if (outcome.kind === 'step3') {
    // The Step 2 replacement itself was the Step 3 card.
    applyStep3Transition(state, now, 'phase5');
  }
  sortMarket(state);
}

/**
 * Performs the card removals that accompany the Step 3 transition, at the moment
 * the rules call for them. `timing` records when Step 3 actually becomes active:
 *  - 'phase2' → Step 3 begins at Phase 3 of the same round.
 *  - 'phase5' → Step 3 begins at Phase 1 of the next round.
 */
export function applyStep3Transition(
  state: GameState,
  now: number,
  timing: 'phase2' | 'phase5',
): void {
  // §10: "If Step 3 begins before Step 2, apply all Step 2 changes first."
  if (!state.step2Triggered) beginStep2(state, now, 'forcedByStep3');

  // "Remove the ... lowest-numbered current-market plant. Do not draw replacements."
  removeLowestCurrent(state, now, 'step3Transition');
  // The Step 3 card itself leaves the game — from the market when it was drawn
  // in Phase 2, or straight from the stack when it was drawn in Phase 5. Either
  // way it is recorded, so every card in the game stays accounted for. §14.
  if (marketPlants(state).includes(STEP3_PLANT_ID)) {
    removeFromMarket(state, STEP3_PLANT_ID);
  }
  if (!state.plantMarket.removed.includes(STEP3_PLANT_ID)) {
    state.plantMarket.removed.push(STEP3_PLANT_ID);
  }
  state.pendingStep3 = timing;
  sortMarket(state);
  pushLog(state, now, {
    category: 'step',
    message:
      timing === 'phase2'
        ? 'Step 3 will begin at Phase 3 of this round.'
        : 'Step 3 will begin at Phase 1 of the next round.',
    data: { event: 'step3Pending', timing },
  });
}

/** Makes Step 3 the current Step and collapses the market into six current plants. §10. */
export function activateStep3(state: GameState, now: number): void {
  if (state.step === 3) {
    state.pendingStep3 = null;
    return;
  }
  state.step = 3;
  state.pendingStep3 = null;
  sortMarket(state);
  pushLog(state, now, {
    category: 'step',
    message: 'Step 3 begins: three houses per city and six current plants, with no future market.',
    data: {
      event: 'stepChange',
      step: 3,
      current: state.plantMarket.current.slice(),
    },
  });
}
