/**
 * Phase 2 — Auction Power Plants. §6.
 *
 * Turn structure: the first eligible player in player order either nominates a
 * current-market plant with a sealed minimum/maximum bid, or passes out of the
 * phase. Every other eligible human simultaneously submits a sealed range or
 * passes; once all decisions are in, the engine deterministically replays the
 * ordinary clockwise auction and resolves it immediately.
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
  minBid: number,
  maxBid: number = minBid,
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
  if (Number.isInteger(minBid) && minBid < min) {
    return fail(`The minimum bid for plant ${plantId} is ${min}`);
  }
  const range = validateBidRange(minBid, maxBid, min, player.money);
  if (!range.ok) return range;
  // §6: "The last player to start an auction in the round pays the minimum bid
  // for the plant they choose, because no later eligible player remains to
  // create a higher bid."
  if (clockwiseBidders(state, playerId, false).length === 0 && (minBid !== min || maxBid !== min)) {
    return fail(`No one else can bid, so plant ${plantId} costs exactly ${min}`);
  }
  return ok;
}

export function applyNominatePlant(
  state: GameState,
  now: number,
  playerId: PlayerId,
  plantId: number,
  minBid: number,
  maxBid: number = minBid,
): void {
  const player = getPlayer(state, playerId);
  const others = clockwiseBidders(state, playerId, false);
  const discounted = state.plantMarket.discountPlantId === plantId;

  pushLog(state, now, {
    category: 'auction',
    playerId,
    message: `${player.name} puts plant ${plantId} up for auction.`,
    data: {
      event: 'plantNominated',
      playerId,
      plantId,
      discounted,
      minimumBid: minimumBid(state, plantId),
      bidders: [playerId, ...others],
    },
  });

  if (others.length === 0) {
    // Uncontested: the nominator takes it at the minimum.
    finishAuction(state, now, playerId, plantId, minBid, 'uncontested');
    return;
  }

  const eligibleBidders = clockwiseBidders(state, playerId, true);
  state.auction = {
    plantId,
    auctioneerId: playerId,
    // These legacy/public ladder fields deliberately contain no sealed value
    // while decisions are being collected.
    currentBid: minimumBid(state, plantId) - 1,
    highBidderId: null,
    activeBidders: eligibleBidders.slice(),
    currentBidderId: others[0]!,
    discounted,
    eligibleBidders,
    commitments: {
      [playerId]: { status: 'bid', minBid, maxBid },
    },
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
  return validateSubmitBidRange(state, playerId, amount, amount);
}

export function applyBid(
  state: GameState,
  now: number,
  playerId: PlayerId,
  amount: number,
): void {
  applySubmitBidRange(state, now, playerId, amount, amount);
}

export function validateSubmitBidRange(
  state: GameState,
  playerId: PlayerId,
  minBid: number,
  maxBid: number,
): ValidationResult {
  const a = state.auction;
  if (state.phase !== 'auction' || !a) return fail('No auction is running');
  if (!a.eligibleBidders.includes(playerId)) return fail('You are not eligible for this auction');
  if (a.commitments[playerId] !== undefined) return fail('You already submitted a decision');
  return validateBidRange(
    minBid,
    maxBid,
    minimumBid(state, a.plantId),
    getPlayer(state, playerId).money,
  );
}

export function applySubmitBidRange(
  state: GameState,
  now: number,
  playerId: PlayerId,
  minBid: number,
  maxBid: number,
): void {
  const a = state.auction!;
  a.commitments[playerId] = { status: 'bid', minBid, maxBid };
  logCommitment(state, now, playerId);
  resolveIfReady(state, now);
}

export function validatePassBid(state: GameState, playerId: PlayerId): ValidationResult {
  const a = state.auction;
  if (state.phase !== 'auction' || !a) return fail('No auction is running');
  if (!a.eligibleBidders.includes(playerId)) return fail('You are not eligible for this auction');
  if (a.commitments[playerId] !== undefined) return fail('You already submitted a decision');
  return ok;
}

export function applyPassBid(state: GameState, now: number, playerId: PlayerId): void {
  const a = state.auction!;
  a.commitments[playerId] = { status: 'pass' };
  logCommitment(state, now, playerId);
  resolveIfReady(state, now);
}

function validateBidRange(
  minBid: number,
  maxBid: number,
  floor: number,
  money: number,
): ValidationResult {
  if (!Number.isInteger(minBid) || !Number.isInteger(maxBid)) {
    return fail('Bids must be whole Elektro');
  }
  if (minBid < floor) return fail(`The minimum bid is ${floor}`);
  if (maxBid < minBid) return fail('The maximum bid must be at least the minimum bid');
  if (maxBid > money) return fail(`You only have ${money} Elektro`);
  return ok;
}

function logCommitment(state: GameState, now: number, playerId: PlayerId): void {
  const a = state.auction!;
  const player = getPlayer(state, playerId);
  pushLog(state, now, {
    category: 'bid',
    playerId,
    message: `${player.name} has submitted a sealed auction decision.`,
    data: { event: 'auctionCommitmentSubmitted', playerId, plantId: a.plantId },
  });
}

function resolveIfReady(state: GameState, now: number): void {
  const a = state.auction!;
  const pending = a.eligibleBidders.filter((id) => a.commitments[id] === undefined);
  if (pending.length > 0) {
    a.currentBidderId = pending[0]!;
    return;
  }
  simulateAuction(state, now);
}

/** Replays an ordinary one-Elektro clockwise auction from the sealed strategies. */
function simulateAuction(state: GameState, now: number): void {
  const a = state.auction!;
  const participants = a.eligibleBidders.filter(
    (id) => a.commitments[id]?.status === 'bid',
  );
  const auctioneer = a.commitments[a.auctioneerId];
  if (!auctioneer || auctioneer.status !== 'bid') {
    throw new Error('Auctioneer is missing a sealed bid');
  }

  let currentBid = auctioneer.minBid;
  let highBidderId = a.auctioneerId;
  let active = participants.slice();
  let cursor = active.length > 1 ? 1 : 0;

  pushSimulatedBid(state, now, highBidderId, a.plantId, currentBid);
  for (let guard = 0; active.length > 1 && guard < 100_000; guard++) {
    const bidderId = active[cursor % active.length]!;
    if (bidderId === highBidderId) {
      cursor = (cursor + 1) % active.length;
      continue;
    }
    const commitment = a.commitments[bidderId]!;
    if (commitment.status !== 'bid') throw new Error('Active bidder has no bid range');
    const nextBid = Math.max(commitment.minBid, currentBid + 1);
    if (nextBid <= commitment.maxBid) {
      currentBid = nextBid;
      highBidderId = bidderId;
      pushSimulatedBid(state, now, bidderId, a.plantId, currentBid);
      cursor = (cursor + 1) % active.length;
    } else {
      const index = active.indexOf(bidderId);
      active.splice(index, 1);
      pushLog(state, now, {
        category: 'bid',
        playerId: bidderId,
        message: `${getPlayer(state, bidderId).name} passes on plant ${a.plantId}.`,
        data: { event: 'bidPassed', playerId: bidderId, plantId: a.plantId, currentBid },
      });
      cursor = index % active.length;
    }
  }
  if (active.length !== 1) throw new Error('Sealed auction simulation did not settle');
  finishAuction(state, now, highBidderId, a.plantId, currentBid, 'outbid');
}

function pushSimulatedBid(
  state: GameState,
  now: number,
  playerId: PlayerId,
  plantId: number,
  amount: number,
): void {
  pushLog(state, now, {
    category: 'bid',
    playerId,
    message: `${getPlayer(state, playerId).name} bids ${amount} Elektro for plant ${plantId}.`,
    data: { event: 'bidPlaced', playerId, plantId, amount, simulated: true },
  });
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
