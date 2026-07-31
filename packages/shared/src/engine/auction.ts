/**
 * Phase 2 — Auction Power Plants. §6.
 *
 * Turn structure: the first eligible player in player order either nominates a
 * current-market plant with an opening bid, or passes out of the phase. Bidding
 * then runs clockwise from the auctioneer until one bidder remains.
 */

import type { GameState, PlayerId, ValidationResult } from '../types.js';
import { getPlant } from '../data/plants.js';
import { MAX_PLANTS_PER_PLAYER } from './constants.js';
import { fail, getPlayer, ok, pushLog, setAllPhaseStatus } from './state.js';
import {
  minimumBid,
  placeDiscountToken,
  resolveUnsoldDiscountPlant,
  sortMarket,
} from './plantMarket.js';
import { acquirePlant, scrapPlant } from './acquire.js';
import { activateStep3, applyStep3Transition } from './steps.js';
import { applyPlayerOrder } from './order.js';

/* ------------------------------------------------------------------ *
 * Phase bookkeeping
 * ------------------------------------------------------------------ */

export function beginAuctionPhase(state: GameState, now: number): void {
  state.phase = 'auction';
  state.auction = null;
  state.pendingScrap = null;
  state.acquiredThisRound = [];
  state.passedThisPhase = [];
  setAllPhaseStatus(state, 'eligible');
  placeDiscountToken(state, now);
  pushLog(state, now, {
    category: 'auction',
    message: 'Phase 2 — Auction Power Plants.',
    data: {
      event: 'phaseStart',
      phase: 'auction',
      order: state.playerOrder.slice(),
      current: state.plantMarket.current.slice(),
      future: state.plantMarket.future.slice(),
      discountPlantId: state.plantMarket.discountPlantId,
    },
  });
}

/** A player may still nominate/bid this phase. §6. */
export function isEligible(state: GameState, playerId: PlayerId): boolean {
  return (
    !state.acquiredThisRound.includes(playerId) &&
    !state.passedThisPhase.includes(playerId)
  );
}

/** The first eligible player in player order — including the Trust. §6, §13. */
export function nextNominator(state: GameState): PlayerId | null {
  for (const id of state.playerOrder) if (isEligible(state, id)) return id;
  return null;
}

/** Eligible human bidders other than `exceptId`, in clockwise order from `fromId`. §6. */
export function clockwiseBidders(
  state: GameState,
  fromId: PlayerId,
  includeSelf: boolean,
): PlayerId[] {
  const order = state.playerOrder;
  const start = order.indexOf(fromId);
  const out: PlayerId[] = [];
  for (let i = 0; i < order.length; i++) {
    const id = order[(start + i) % order.length]!;
    if (id === fromId && !includeSelf) continue;
    if (getPlayer(state, id).isTrust) continue; // §13: "The Trust never bids."
    if (!isEligible(state, id)) continue;
    out.push(id);
  }
  return out;
}

/** §6: "During the first round, every human player must acquire one plant." */
export function mustBuyThisRound(state: GameState, playerId: PlayerId): boolean {
  if (state.round !== 1) return false;
  const player = getPlayer(state, playerId);
  if (player.isTrust) return false;
  // A player who genuinely cannot meet any minimum bid is released from the
  // requirement — otherwise the phase would deadlock.
  return state.plantMarket.current.some((id) => minimumBid(state, id) <= player.money);
}

/* ------------------------------------------------------------------ *
 * nominatePlant
 * ------------------------------------------------------------------ */

export function validateNominatePlant(
  state: GameState,
  playerId: PlayerId,
  plantId: number,
  bid: number,
): ValidationResult {
  if (state.phase !== 'auction') return fail('Plants may only be auctioned during Phase 2');
  if (state.pendingScrap) return fail('A plant must be scrapped first');
  if (state.auction) return fail('An auction is already running');
  if (nextNominator(state) !== playerId) return fail('It is not your turn to choose a plant');
  const player = getPlayer(state, playerId);
  if (player.isTrust) return fail('The Trust does not auction plants');
  if (state.acquiredThisRound.includes(playerId)) return fail('You already bought a plant this round');
  // §6 / §14: "Bidding on a future-market plant in Steps 1-2."
  if (!state.plantMarket.current.includes(plantId)) {
    return fail('Only plants in the current market may be auctioned');
  }
  if (getPlant(plantId).isStep3) return fail('The Step 3 card cannot be auctioned');
  const min = minimumBid(state, plantId);
  if (!Number.isInteger(bid)) return fail('Bids must be whole Elektro');
  if (bid < min) return fail(`The minimum bid for plant ${plantId} is ${min}`);
  if (bid > player.money) return fail(`You only have ${player.money} Elektro`);
  // §6: "The last player to start an auction in the round pays the minimum bid
  // for the plant they choose, because no later eligible player remains to
  // create a higher bid."
  if (clockwiseBidders(state, playerId, false).length === 0 && bid !== min) {
    return fail(`No one else can bid, so plant ${plantId} costs exactly ${min}`);
  }
  return ok;
}

export function applyNominatePlant(
  state: GameState,
  now: number,
  playerId: PlayerId,
  plantId: number,
  bid: number,
): void {
  const player = getPlayer(state, playerId);
  const others = clockwiseBidders(state, playerId, false);
  const discounted = state.plantMarket.discountPlantId === plantId;

  pushLog(state, now, {
    category: 'auction',
    playerId,
    message: `${player.name} puts plant ${plantId} up for auction at ${bid} Elektro.`,
    data: {
      event: 'plantNominated',
      playerId,
      plantId,
      bid,
      discounted,
      minimumBid: minimumBid(state, plantId),
      bidders: [playerId, ...others],
    },
  });

  if (others.length === 0) {
    // Uncontested: the nominator takes it at the minimum.
    finishAuction(state, now, playerId, plantId, bid, 'uncontested');
    return;
  }

  state.auction = {
    plantId,
    auctioneerId: playerId,
    currentBid: bid,
    highBidderId: playerId,
    activeBidders: clockwiseBidders(state, playerId, true),
    currentBidderId: others[0]!,
    discounted,
  };
}

/* ------------------------------------------------------------------ *
 * passNomination
 * ------------------------------------------------------------------ */

export function validatePassNomination(state: GameState, playerId: PlayerId): ValidationResult {
  if (state.phase !== 'auction') return fail('Nothing to pass on outside Phase 2');
  if (state.pendingScrap) return fail('A plant must be scrapped first');
  if (state.auction) return fail('An auction is running — pass the bid instead');
  if (nextNominator(state) !== playerId) return fail('It is not your turn');
  if (mustBuyThisRound(state, playerId)) {
    return fail('Every player must buy a power plant in the first round');
  }
  return ok;
}

export function applyPassNomination(state: GameState, now: number, playerId: PlayerId): void {
  const player = getPlayer(state, playerId);
  state.passedThisPhase.push(playerId);
  player.phaseStatus = 'passed';
  pushLog(state, now, {
    category: 'auction',
    playerId,
    message: `${player.name} passes and is out of the auction phase.`,
    data: { event: 'nominationPassed', playerId },
  });
}

/* ------------------------------------------------------------------ *
 * Bidding
 * ------------------------------------------------------------------ */

export function validateBid(
  state: GameState,
  playerId: PlayerId,
  amount: number,
): ValidationResult {
  const a = state.auction;
  if (state.phase !== 'auction' || !a) return fail('No auction is running');
  if (a.currentBidderId !== playerId) return fail('It is not your turn to bid');
  if (!a.activeBidders.includes(playerId)) return fail('You already passed on this plant');
  if (!Number.isInteger(amount)) return fail('Bids must be whole Elektro');
  if (amount <= a.currentBid) return fail(`You must bid more than ${a.currentBid}`);
  const player = getPlayer(state, playerId);
  if (amount > player.money) return fail(`You only have ${player.money} Elektro`);
  return ok;
}

export function applyBid(
  state: GameState,
  now: number,
  playerId: PlayerId,
  amount: number,
): void {
  const a = state.auction!;
  const player = getPlayer(state, playerId);
  a.currentBid = amount;
  a.highBidderId = playerId;
  pushLog(state, now, {
    category: 'bid',
    playerId,
    message: `${player.name} bids ${amount} Elektro for plant ${a.plantId}.`,
    data: { event: 'bidPlaced', playerId, plantId: a.plantId, amount },
  });
  a.currentBidderId = successor(a.activeBidders, playerId);
}

export function validatePassBid(state: GameState, playerId: PlayerId): ValidationResult {
  const a = state.auction;
  if (state.phase !== 'auction' || !a) return fail('No auction is running');
  if (a.currentBidderId !== playerId) return fail('It is not your turn to bid');
  if (!a.activeBidders.includes(playerId)) return fail('You already passed on this plant');
  return ok;
}

export function applyPassBid(state: GameState, now: number, playerId: PlayerId): void {
  const a = state.auction!;
  const player = getPlayer(state, playerId);
  const index = a.activeBidders.indexOf(playerId);
  a.activeBidders.splice(index, 1);
  pushLog(state, now, {
    category: 'bid',
    playerId,
    message: `${player.name} passes on plant ${a.plantId}.`,
    data: { event: 'bidPassed', playerId, plantId: a.plantId, currentBid: a.currentBid },
  });

  if (a.activeBidders.length <= 1) {
    const winner = a.highBidderId ?? a.activeBidders[0]!;
    finishAuction(state, now, winner, a.plantId, a.currentBid, 'outbid');
    return;
  }
  a.currentBidderId = a.activeBidders[index % a.activeBidders.length]!;
}

function successor(list: readonly PlayerId[], id: PlayerId): PlayerId {
  const i = list.indexOf(id);
  return list[(i + 1) % list.length]!;
}

function finishAuction(
  state: GameState,
  now: number,
  winnerId: PlayerId,
  plantId: number,
  price: number,
  reason: 'uncontested' | 'outbid',
): void {
  state.auction = null;
  pushLog(state, now, {
    category: 'auction',
    playerId: winnerId,
    message: `Plant ${plantId} is sold for ${price} Elektro.`,
    data: { event: 'auctionResolved', plantId, winnerId, price, reason },
  });
  const needsScrap = acquirePlant(state, now, winnerId, plantId, { price, via: 'auction' });
  if (needsScrap) {
    state.pendingScrap = { playerId: winnerId, newPlantId: plantId };
    pushLog(state, now, {
      category: 'auction',
      playerId: winnerId,
      message: `${getPlayer(state, winnerId).name} owns four plants and must scrap one.`,
      data: {
        event: 'scrapRequired',
        playerId: winnerId,
        newPlantId: plantId,
        plants: getPlayer(state, winnerId).plants.map((p) => p.plantId),
      },
    });
  }
}

/* ------------------------------------------------------------------ *
 * scrapPlant (§6 plant ownership limit)
 * ------------------------------------------------------------------ */

export function validateScrapPlant(
  state: GameState,
  playerId: PlayerId,
  plantId: number,
): ValidationResult {
  const pending = state.pendingScrap;
  if (!pending) return fail('You do not need to scrap a plant');
  if (pending.playerId !== playerId) return fail('It is not your plant to scrap');
  // §14: "Scrapping the newly acquired plant when a player exceeds the
  // three-plant limit."
  if (plantId === pending.newPlantId) return fail('The newly acquired plant cannot be scrapped');
  if (!getPlayer(state, playerId).plants.some((p) => p.plantId === plantId)) {
    return fail('You do not own that plant');
  }
  return ok;
}

export function applyScrapPlant(
  state: GameState,
  now: number,
  playerId: PlayerId,
  plantId: number,
): void {
  scrapPlant(state, now, playerId, plantId);
  state.pendingScrap = null;
  const player = getPlayer(state, playerId);
  if (player.plants.length > MAX_PLANTS_PER_PLAYER) {
    /* istanbul ignore next — unreachable with a single acquisition per round */
    state.pendingScrap = { playerId, newPlantId: plantId };
  }
}

/* ------------------------------------------------------------------ *
 * End of Phase 2
 * ------------------------------------------------------------------ */

export function endAuctionPhase(state: GameState, now: number): void {
  // §6: an unsold discounted plant leaves the game and is replaced.
  const outcome = resolveUnsoldDiscountPlant(state, now);
  if (outcome && outcome.kind === 'step3') state.pendingStep3 = 'phase2';

  // §10: Step 3 card drawn during Phase 2 → removals now, Step 3 from Phase 3.
  if (state.pendingStep3 === 'phase2') {
    applyStep3Transition(state, now, 'phase2');
    activateStep3(state, now);
  }
  sortMarket(state);

  // §6: "After Phase 2, reset all player-order phase-status markers."
  setAllPhaseStatus(state, 'eligible');

  // §5 one-time first-round exception: recompute order before Phases 3-5.
  if (state.round === 1) {
    applyPlayerOrder(state, now, 'firstRoundAfterAuctions');
  }

  pushLog(state, now, {
    category: 'auction',
    message: 'Phase 2 ends.',
    data: {
      event: 'phaseEnd',
      phase: 'auction',
      acquired: state.acquiredThisRound.slice(),
      passed: state.passedThisPhase.slice(),
      current: state.plantMarket.current.slice(),
      future: state.plantMarket.future.slice(),
    },
  });
}
