/**
 * Plant acquisition mechanics shared by the human auction (§6) and the Trust's
 * free take (§13): hand the card over, clear the discount token, fire the
 * German nuclear phase-out, draw the replacement and resort the market.
 *
 * Kept separate from `auction.ts` so `trust.ts` can reuse it without a cycle.
 */

import type { GameState, PlayerId } from '../types.js';
import { STEP3_PLANT_ID, emptyResources } from '../types.js';
import { MAX_PLANTS_PER_PLAYER } from './constants.js';
import { getPlayer, pushLog } from './state.js';
import { stateMap } from './mapAccess.js';
import { drawReplacement, removeFromMarket, sortMarket } from './plantMarket.js';
import { reassignPool, returnBundle, storedPool } from './resources.js';

export interface AcquireOptions {
  /** Elektro paid to the bank. 0 for the Trust. §13. */
  price: number;
  /** Log wording: 'auction' | 'trust'. */
  via: 'auction' | 'trust';
}

/**
 * Moves `plantId` from the market to `playerId`.
 * Returns true when the player now holds a 4th plant and must scrap. §6.
 */
export function acquirePlant(
  state: GameState,
  now: number,
  playerId: PlayerId,
  plantId: number,
  opts: AcquireOptions,
): boolean {
  const player = getPlayer(state, playerId);
  removeFromMarket(state, plantId);
  player.money -= opts.price;
  player.plants.push({ plantId, stored: emptyResources() });
  player.plants.sort((a, b) => a.plantId - b.plantId);
  if (!state.acquiredThisRound.includes(playerId)) state.acquiredThisRound.push(playerId);
  player.phaseStatus = 'purchased';

  pushLog(state, now, {
    category: opts.via === 'trust' ? 'trust' : 'auction',
    playerId,
    message:
      opts.via === 'trust'
        ? `The Trust takes plant ${plantId} for free.`
        : `${player.name} wins plant ${plantId} for ${opts.price} Elektro.`,
    data: {
      event: 'plantAcquired',
      playerId,
      plantId,
      price: opts.price,
      via: opts.via,
      moneyAfter: player.money,
      plants: player.plants.map((p) => p.plantId),
    },
  });

  // §6: "If the discounted plant is bought, move the discount token next to the market."
  if (state.plantMarket.discountPlantId === plantId) {
    state.plantMarket.discountPlantId = null;
    state.plantMarket.discountReplacementRuleArmed = false;
    pushLog(state, now, {
      category: 'market',
      message: 'The discounted plant was bought; the discount token moves beside the market.',
      data: { event: 'discountTokenCleared', plantId },
    });
  }

  // §9.2 / §12 Germany: the phase-out only fires when a player *buys* plant 39.
  const phaseOutPlant = stateMap(state).rules.nuclearPhaseOutPlant;
  if (phaseOutPlant !== undefined && plantId === phaseOutPlant && !state.uraniumPhaseOut) {
    state.uraniumPhaseOut = true;
    pushLog(state, now, {
      category: 'market',
      playerId,
      message: `Plant ${plantId} was bought: the nuclear phase-out begins and uranium is never resupplied again.`,
      data: { event: 'uraniumPhaseOut', plantId, playerId },
    });
  }

  // §6: "After every plant acquisition, draw a replacement from the plant stack
  // and resort all market plants by number."
  const outcome = drawReplacement(state, now, 'plantAcquired');
  if (outcome.kind === 'step3') {
    // §10: during Phase 2 the card is treated as the highest plant and placed at
    // the end of the future market; the removals happen at the end of Phase 2.
    state.plantMarket.future.push(STEP3_PLANT_ID);
    state.pendingStep3 = 'phase2';
    pushLog(state, now, {
      category: 'step',
      message: 'The Step 3 card joins the end of the future market for the rest of this auction phase.',
      data: { event: 'step3CardInMarket', timing: 'phase2' },
    });
  }
  sortMarket(state);

  return player.plants.length > MAX_PLANTS_PER_PLAYER;
}

/**
 * Removes `plantId` from the player and re-lays their resources across the
 * plants that remain. §6: "Move resources from the scrapped plant to the
 * remaining plants if those plants have compatible capacity. Return any
 * resources that cannot be stored to the resource supply, never to the market."
 */
export function scrapPlant(
  state: GameState,
  now: number,
  playerId: PlayerId,
  plantId: number,
): void {
  const player = getPlayer(state, playerId);
  const pool = storedPool(state, playerId);
  player.plants = player.plants.filter((p) => p.plantId !== plantId);
  state.plantMarket.removed.push(plantId);

  const leftover = reassignPool(state, playerId, pool);
  returnBundle(state, leftover);

  pushLog(state, now, {
    category: 'auction',
    playerId,
    message: `${player.name} scraps plant ${plantId}.`,
    data: {
      event: 'plantScrapped',
      playerId,
      plantId,
      plants: player.plants.map((p) => ({ plantId: p.plantId, stored: { ...p.stored } })),
      returnedToSupply: { ...leftover },
    },
  });
}
