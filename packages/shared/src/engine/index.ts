/**
 * Power Grid rules engine — public API.
 *
 *   createGame(settings, players, hostId, code) → GameState
 *   validateAction(state, playerId, action)     → ValidationResult
 *   applyAction(state, playerId, action)        → GameState (new object)
 *
 * The reducer is pure and deterministic (§14): it never mutates its input, never
 * reads the clock or `Math.random`, and every random draw goes through `Rng`
 * seeded from `settings.seed` + `state.rngCursor`, whose advanced position is
 * persisted back into the returned state.
 *
 * `applyAction` auto-advances through phases and subphases — resolving every
 * automatic transition and Trust action along the way — until the game is once
 * again waiting on a human decision.
 */

import type { GameAction, GameState, PlayerId, ValidationResult } from '../types.js';
import {
  deepClone,
  fail,
  getPlayer,
  ok,
  pushLog,
  reverseOrder,
  setAllPhaseStatus,
} from './state.js';
import {
  advanceSetup,
  applyMarkStartCity,
  applyPlaceTrustHouse,
  applySelectZone,
  validateMarkStartCity,
  validatePlaceTrustHouse,
  validateSelectZone,
} from './setup.js';
import { applyPlayerOrder } from './order.js';
import {
  applyBid,
  applyNominatePlant,
  applyPassBid,
  applySubmitBidRange,
  applyPassNomination,
  applyScrapPlant,
  beginAuctionPhase,
  endAuctionPhase,
  nextNominator,
  validateBid,
  validateNominatePlant,
  validatePassBid,
  validateSubmitBidRange,
  validatePassNomination,
  validateScrapPlant,
} from './auction.js';
import {
  applyBuyResources,
  applyRedistribute,
  validateBuyResources,
  validateRedistribute,
} from './resources.js';
import {
  applyBuildCity,
  applyUndoLastBuild,
  validateBuildCity,
  validateUndoLastBuild,
} from './building.js';
import {
  applyPowerCities,
  beginBureaucracyPhase,
  finishBureaucracy,
  validatePowerCities,
} from './bureaucracy.js';
import { checkEndGameTrigger } from './endgame.js';
import { activateStep3 } from './steps.js';
import { trustAuctionTurn, trustBuyResources } from './trust.js';

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

export function validateAction(
  state: GameState,
  playerId: PlayerId,
  action: GameAction,
): ValidationResult {
  if (!state.players[playerId]) return fail(`Unknown player '${playerId}'`);
  if (state.phase === 'gameOver') return fail('The game is over');
  if (getPlayer(state, playerId).isTrust) return fail('The Trust acts automatically');

  switch (action.type) {
    case 'selectZone':
      return validateSelectZone(state, playerId, action.areas);
    case 'markStartCity':
      return validateMarkStartCity(state, playerId, action.cityId);
    case 'placeTrustHouse':
      return validatePlaceTrustHouse(state, playerId, action.cityId);
    case 'startGame':
      if (state.phase !== 'setup' || state.setupStage !== 'lobby') {
        return fail('The game has already started');
      }
      return playerId === state.hostId ? ok : fail('Only the host may start the game');

    case 'nominatePlant':
      return validateNominatePlant(state, playerId, action.plantId, action.bid, action.maxBid);
    case 'passNomination':
      return validatePassNomination(state, playerId);
    case 'submitBidRange':
      return validateSubmitBidRange(state, playerId, action.minBid, action.maxBid);
    case 'bid':
      return validateBid(state, playerId, action.amount);
    case 'passBid':
      return validatePassBid(state, playerId);
    case 'scrapPlant':
      return validateScrapPlant(state, playerId, action.plantId);

    case 'buyResources':
      return validateBuyResources(state, playerId, action.purchases);
    case 'redistributeResources':
      if (state.phase !== 'resources') return fail('Resources are rearranged during Phase 3');
      return validateRedistribute(state, playerId, action.assignment);
    case 'passResources':
      if (state.phase !== 'resources') return fail('Nothing to pass on outside Phase 3');
      if (state.activePlayerId !== playerId) return fail('It is not your turn');
      return ok;

    case 'buildCity':
      return validateBuildCity(state, playerId, action.cityId);
    case 'passBuilding':
      if (state.phase !== 'building') return fail('Nothing to pass on outside Phase 4');
      if (state.activePlayerId !== playerId) return fail('It is not your turn');
      return ok;
    case 'undoLastBuild':
      return validateUndoLastBuild(state, playerId);

    case 'powerCities':
      return validatePowerCities(state, playerId, action.decision);

    default:
      return fail('Unknown action');
  }
}

/* ------------------------------------------------------------------ *
 * Reduction
 * ------------------------------------------------------------------ */

export function applyAction(
  state: GameState,
  playerId: PlayerId,
  action: GameAction,
  now: number = state.updatedAt,
): GameState {
  const verdict = validateAction(state, playerId, action);
  if (!verdict.ok) throw new Error(verdict.reason);

  const next = deepClone(state);
  next.updatedAt = now;
  reduce(next, now, playerId, action);
  advance(next, now);
  return next;
}

function reduce(state: GameState, now: number, playerId: PlayerId, action: GameAction): void {
  switch (action.type) {
    case 'selectZone':
      applySelectZone(state, now, action.areas);
      return;
    case 'markStartCity':
      applyMarkStartCity(state, now, playerId, action.cityId);
      return;
    case 'placeTrustHouse':
      applyPlaceTrustHouse(state, now, action.cityId);
      return;
    case 'startGame':
      state.setupStage = 'zoneSelection';
      return;

    case 'nominatePlant':
      applyNominatePlant(state, now, playerId, action.plantId, action.bid, action.maxBid);
      return;
    case 'passNomination':
      applyPassNomination(state, now, playerId);
      return;
    case 'submitBidRange':
      applySubmitBidRange(state, now, playerId, action.minBid, action.maxBid);
      return;
    case 'bid':
      applyBid(state, now, playerId, action.amount);
      return;
    case 'passBid':
      applyPassBid(state, now, playerId);
      return;
    case 'scrapPlant':
      applyScrapPlant(state, now, playerId, action.plantId);
      return;

    case 'buyResources':
      applyBuyResources(state, now, playerId, action.purchases);
      return;
    case 'redistributeResources':
      applyRedistribute(state, now, playerId, action.assignment);
      return;
    case 'passResources': {
      const p = getPlayer(state, playerId);
      p.phaseStatus = 'acted';
      pushLog(state, now, {
        category: 'resource',
        playerId,
        message: `${p.name} finishes buying resources.`,
        data: { event: 'resourcesDone', playerId },
      });
      return;
    }

    case 'buildCity':
      applyBuildCity(state, now, playerId, action.cityId);
      return;
    case 'passBuilding': {
      const p = getPlayer(state, playerId);
      p.phaseStatus = 'acted';
      pushLog(state, now, {
        category: 'build',
        playerId,
        message: `${p.name} finishes building.`,
        data: { event: 'buildingDone', playerId, networkSize: p.cities.length },
      });
      return;
    }
    case 'undoLastBuild':
      applyUndoLastBuild(state, now, playerId);
      return;

    case 'powerCities':
      applyPowerCities(state, now, playerId, action.decision);
      return;

    /* istanbul ignore next — guarded by validateAction */
    default:
      throw new Error('Unknown action');
  }
}

/* ------------------------------------------------------------------ *
 * Phase driver (§3, §4)
 * ------------------------------------------------------------------ */

/** Runs every automatic transition until a human decision is required. */
export function advance(state: GameState, now: number): void {
  for (let guard = 0; guard < 10_000; guard++) {
    switch (state.phase) {
      case 'gameOver':
        state.activePlayerId = null;
        return;
      case 'setup':
        if (!advanceSetup(state, now)) return;
        continue;
      case 'order':
        runOrderPhase(state, now);
        continue;
      case 'auction':
        if (advanceAuction(state, now)) continue;
        return;
      case 'resources':
        if (advanceResources(state, now)) continue;
        return;
      case 'building':
        if (advanceBuilding(state, now)) continue;
        return;
      case 'bureaucracy':
        if (advanceBureaucracy(state, now)) continue;
        return;
      /* istanbul ignore next */
      default:
        return;
    }
  }
  /* istanbul ignore next */
  throw new Error('advance(): phase driver did not settle');
}

/** Phase 1 — Determine Player Order. §5. */
function runOrderPhase(state: GameState, now: number): void {
  // §10: a Step 3 card drawn in Phase 5 takes effect at Phase 1 of the next round.
  if (state.pendingStep3 === 'phase5') activateStep3(state, now);

  if (state.round === 1) {
    // §5: "In the first round only, the initial random order is used for the
    // plant auctions."
    pushLog(state, now, {
      category: 'order',
      message: `Round 1 uses the random setup order: ${state.playerOrder
        .map((id) => getPlayer(state, id).name)
        .join(' → ')}.`,
      data: {
        event: 'playerOrder',
        reason: 'initialRandomOrder',
        before: state.playerOrder.slice(),
        after: state.playerOrder.slice(),
      },
    });
  } else {
    applyPlayerOrder(state, now, 'roundStart');
  }
  beginAuctionPhase(state, now);
}

/** Phase 2 — in player order. §4. Returns true when the phase ended. */
function advanceAuction(state: GameState, now: number): boolean {
  if (state.pendingScrap) {
    state.activePlayerId = state.pendingScrap.playerId;
    getPlayer(state, state.pendingScrap.playerId).phaseStatus = 'acting';
    return false;
  }
  if (state.auction) {
    state.activePlayerId = state.auction.currentBidderId;
    getPlayer(state, state.auction.currentBidderId).phaseStatus = 'acting';
    return false;
  }
  for (let guard = 0; guard < 64; guard++) {
    const next = nextNominator(state);
    if (next === null) break;
    const player = getPlayer(state, next);
    if (player.isTrust) {
      // §13: the Trust takes its turn automatically between the two humans.
      trustAuctionTurn(state, now);
      continue;
    }
    state.activePlayerId = next;
    player.phaseStatus = 'acting';
    return false;
  }
  endAuctionPhase(state, now);
  beginResourcesPhase(state, now);
  return true;
}

function beginResourcesPhase(state: GameState, now: number): void {
  state.phase = 'resources';
  setAllPhaseStatus(state, 'eligible');
  pushLog(state, now, {
    category: 'resource',
    message: 'Phase 3 — Buy Resources, in reverse player order.',
    data: { event: 'phaseStart', phase: 'resources', order: reverseOrder(state) },
  });
}

/** Phase 3 — reverse player order. §4, §7. */
function advanceResources(state: GameState, now: number): boolean {
  for (const id of reverseOrder(state)) {
    const player = getPlayer(state, id);
    if (player.phaseStatus === 'acted' || player.phaseStatus === 'passed') continue;
    if (player.isTrust) {
      trustBuyResources(state, now);
      player.phaseStatus = 'acted';
      continue;
    }
    state.activePlayerId = id;
    player.phaseStatus = 'acting';
    return false;
  }
  beginBuildingPhase(state, now);
  return true;
}

function beginBuildingPhase(state: GameState, now: number): void {
  state.phase = 'building';
  state.buildHistory = [];
  // §13: the Trust never builds on its own turn; its houses arrive reactively.
  setAllPhaseStatus(state, 'eligible', { trust: 'ineligible' });
  pushLog(state, now, {
    category: 'build',
    message: 'Phase 4 — Build Houses, in reverse player order.',
    data: { event: 'phaseStart', phase: 'building', order: reverseOrder(state), step: state.step },
  });
}

/** Phase 4 — reverse player order. §4, §8. */
function advanceBuilding(state: GameState, now: number): boolean {
  for (const id of reverseOrder(state)) {
    const player = getPlayer(state, id);
    if (player.isTrust) continue;
    if (player.phaseStatus === 'acted' || player.phaseStatus === 'passed') continue;
    state.activePlayerId = id;
    player.phaseStatus = 'acting';
    return false;
  }
  // §11: the game ends immediately after Phase 4 once the threshold is reached.
  checkEndGameTrigger(state, now);
  beginBureaucracyPhase(state, now);
  return true;
}

/** Phase 5 — cash payment starts with the first player. §4, §9. */
function advanceBureaucracy(state: GameState, now: number): boolean {
  if (state.phase !== 'bureaucracy') return true; // the evaluation ended the game
  for (const id of state.playerOrder) {
    const player = getPlayer(state, id);
    if (player.isTrust) continue;
    if (player.phaseStatus === 'acted' || player.phaseStatus === 'passed') continue;
    state.activePlayerId = id;
    player.phaseStatus = 'acting';
    return false;
  }
  finishBureaucracy(state, now);
  return true;
}

/* ------------------------------------------------------------------ *
 * Re-exports
 * ------------------------------------------------------------------ */

export * from './state.js';
export * from './mapAccess.js';
export * from './allocation.js';
export * from './plantMarket.js';
export * from './order.js';
export * from './setup.js';
export * from './auction.js';
export * from './acquire.js';
export * from './resources.js';
export * from './building.js';
export * from './production.js';
export * from './bureaucracy.js';
export * from './steps.js';
export * from './endgame.js';
export * from './trust.js';
export * from './legal.js';
export * from './autoplay.js';
