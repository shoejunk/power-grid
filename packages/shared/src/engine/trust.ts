/**
 * §13 — Two-player variant: Against the Trust.
 *
 * The Trust is an automated third faction. It never bids, never holds money,
 * never scores, and cannot win. Everything it does resolves automatically, so
 * every Trust action is logged with a structured payload (§14).
 *
 * Its other touch points live where the rule belongs:
 *  - setup placement of the six starting houses → `setup.ts`
 *  - permanent order position 2                → `order.ts`
 *  - free house on each newly connected empty city → `building.ts`
 *  - Step 1 blocking of its starting cities    → `building.ts`
 */

import type { GameState, ResourceType } from '../types.js';
import { RESOURCE_TYPES, emptyResources } from '../types.js';
import { getPlant } from '../data/plants.js';
import { MAX_PLANTS_PER_PLAYER } from './constants.js';
import { maxOf, minOf, pushLog, trustPlayer } from './state.js';
import { acquirePlant, scrapPlant } from './acquire.js';
import { purchasableTokens, returnBundle, takeFromMarket } from './resources.js';

/* ------------------------------------------------------------------ *
 * Phase 2 — the Trust takes the highest current-market plant for free
 * ------------------------------------------------------------------ */

/**
 * §13: "The Trust takes the highest-numbered plant in the current market for
 * free; there is no auction." With three plants already, it only takes when the
 * plant is higher than its smallest, scrapping that smallest first.
 */
export function trustAuctionTurn(state: GameState, now: number): void {
  const trust = trustPlayer(state);
  if (!trust) return;

  const candidates = state.plantMarket.current.filter((id) => !getPlant(id).isStep3);
  const highest = maxOf(candidates);

  if (highest === null) {
    trust.phaseStatus = 'passed';
    if (!state.passedThisPhase.includes(trust.id)) state.passedThisPhase.push(trust.id);
    pushLog(state, now, {
      category: 'trust',
      message: 'The Trust finds no plant in the current market and takes nothing.',
      data: { event: 'trustNoPlant', reason: 'emptyMarket' },
    });
    return;
  }

  if (trust.plants.length >= MAX_PLANTS_PER_PLAYER) {
    const smallest = minOf(trust.plants.map((p) => p.plantId))!;
    if (highest <= smallest) {
      trust.phaseStatus = 'passed';
      if (!state.passedThisPhase.includes(trust.id)) state.passedThisPhase.push(trust.id);
      pushLog(state, now, {
        category: 'trust',
        message: `The Trust keeps its plants: market plant ${highest} is not higher than its smallest plant ${smallest}.`,
        data: { event: 'trustNoPlant', reason: 'notAnUpgrade', marketPlant: highest, smallestOwned: smallest },
      });
      return;
    }
    scrapPlant(state, now, trust.id, smallest);
  }

  acquirePlant(state, now, trust.id, highest, { price: 0, via: 'trust' });
}

/* ------------------------------------------------------------------ *
 * Phase 3 — free resources, nothing stored between rounds
 * ------------------------------------------------------------------ */

/**
 * §13: "The Trust takes all resources needed for normal production for all of
 * its plants, for free. ... If the market lacks enough resources, take as many
 * as are available. For a hybrid plant, take alternating coal and oil while both
 * are available, starting with coal."
 */
export function trustBuyResources(state: GameState, now: number): void {
  const trust = trustPlayer(state);
  if (!trust) return;

  const taken = emptyResources();
  for (const owned of trust.plants) {
    const plant = getPlant(owned.plantId);
    if (plant.accepts.length === 0 || plant.fuel === 0) continue;
    const onPlant = emptyResources();

    if (plant.accepts.length === 1) {
      const type = plant.accepts[0]!;
      const n = Math.min(plant.fuel, purchasableTokens(state, type));
      if (n > 0) {
        takeFromMarket(state, type, n);
        onPlant[type] += n;
        taken[type] += n;
      }
    } else {
      // Hybrid: alternate coal, oil, coal, ... falling back to whichever remains.
      const preference: ResourceType[] = ['coal', 'oil'];
      for (let i = 0; i < plant.fuel; i++) {
        const first = preference[i % 2]!;
        const second = preference[(i + 1) % 2]!;
        const type = purchasableTokens(state, first) > 0
          ? first
          : purchasableTokens(state, second) > 0
            ? second
            : null;
        if (type === null) break;
        takeFromMarket(state, type, 1);
        onPlant[type] += 1;
        taken[type] += 1;
      }
    }
    owned.stored = onPlant;
  }

  pushLog(state, now, {
    category: 'trust',
    message: `The Trust takes ${RESOURCE_TYPES.filter((t) => taken[t] > 0)
      .map((t) => `${taken[t]} ${t}`)
      .join(', ') || 'no resources'} for free.`,
    data: {
      event: 'trustResourcesTaken',
      taken: { ...taken },
      plants: trust.plants.map((p) => ({ plantId: p.plantId, stored: { ...p.stored } })),
    },
  });
}

/* ------------------------------------------------------------------ *
 * Phase 5 — return everything
 * ------------------------------------------------------------------ */

/** §13: "Return all resource tokens taken by the Trust to the resource supply." */
export function trustReturnResources(state: GameState, now: number): void {
  const trust = trustPlayer(state);
  if (!trust) return;
  const returned = emptyResources();
  for (const owned of trust.plants) {
    for (const t of RESOURCE_TYPES) returned[t] += owned.stored[t] ?? 0;
    owned.stored = emptyResources();
  }
  returnBundle(state, returned);
  pushLog(state, now, {
    category: 'trust',
    message: 'The Trust returns every resource token it took to the supply.',
    data: { event: 'trustResourcesReturned', returned: { ...returned }, supply: { ...state.supply } },
  });
}
