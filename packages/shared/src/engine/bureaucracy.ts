/**
 * Phase 5 — Bureaucracy. §9.
 *
 * Three subphases in strict order: earn cash (normal player order), resupply the
 * resource market (price-ordered and finite), then update the plant market.
 */

import type {
  GameState,
  PlayerId,
  PowerDecision,
  ResourceType,
  Step,
  ValidationResult,
} from '../types.js';
import { RESOURCE_TYPES, STEP3_PLANT_ID, emptyResources } from '../types.js';
import { getPlant } from '../data/plants.js';
import { payoutFor, refillFor } from './constants.js';
import { fail, getPlayer, ok, pushLog, setAllPhaseStatus, trustPlayer } from './state.js';
import { maxFlowAssign } from './allocation.js';
import { canOperate, fuelSlots } from './production.js';
import {
  buryHighestFuture,
  drawReplacement,
  removeLowestCurrent,
  sortMarket,
} from './plantMarket.js';
import {
  reassignPool,
  returnResource,
  storedPool,
  usesCoalStorage,
} from './resources.js';
import { applyStep3Transition, beginStep2, step2ThresholdReached } from './steps.js';
import { trustReturnResources } from './trust.js';
import { runFinalEvaluation } from './endgame.js';

/* ------------------------------------------------------------------ *
 * Phase entry
 * ------------------------------------------------------------------ */

export function beginBureaucracyPhase(state: GameState, now: number): void {
  state.phase = 'bureaucracy';
  pushLog(state, now, {
    category: 'power',
    message: 'Phase 5 — Bureaucracy.',
    data: { event: 'phaseStart', phase: 'bureaucracy', order: state.playerOrder.slice() },
  });

  // §10: "Step 2 begins at the start of Phase 5 after at least one player has
  // connected the required number of cities during Phase 4."
  if (!state.step2Triggered && step2ThresholdReached(state)) {
    beginStep2(state, now, 'cityThreshold');
  }

  // §11: the Phase 5 after the trigger is a winner evaluation, not a payout.
  if (state.endGameTriggered) {
    runFinalEvaluation(state, now);
    return;
  }

  setAllPhaseStatus(state, 'eligible', { trust: 'ineligible' });
}

/* ------------------------------------------------------------------ *
 * 9.1 Earning cash and producing electricity
 * ------------------------------------------------------------------ */

export function validatePowerCities(
  state: GameState,
  playerId: PlayerId,
  decision: PowerDecision,
): ValidationResult {
  if (state.phase !== 'bureaucracy') return fail('Electricity is produced during Phase 5');
  if (state.activePlayerId !== playerId) return fail('It is not your turn to produce electricity');
  const player = getPlayer(state, playerId);
  if (player.isTrust) return fail('The Trust does not produce for payment');
  const ids = decision.operatePlantIds ?? [];
  if (new Set(ids).size !== ids.length) return fail('Duplicate plants in the operating list');
  for (const id of ids) {
    if (!player.plants.some((p) => p.plantId === id)) return fail(`You do not own plant ${id}`);
  }
  if (!canOperate(state, playerId, ids)) {
    return fail('You do not have the exact fuel those plants require');
  }
  const capacity = ids.reduce((s, id) => s + getPlant(id).cities, 0);
  const supplied = decision.citiesSupplied;
  if (!Number.isInteger(supplied) || supplied < 0) return fail('Supplied cities must be 0 or more');
  if (supplied > capacity) return fail(`Those plants only power ${capacity} cities`);
  if (supplied > player.cities.length) {
    return fail(`You only have ${player.cities.length} cities in your network`);
  }
  return ok;
}

export function applyPowerCities(
  state: GameState,
  now: number,
  playerId: PlayerId,
  decision: PowerDecision,
): void {
  const player = getPlayer(state, playerId);
  const ids = [...(decision.operatePlantIds ?? [])].sort((a, b) => a - b);
  const pool = storedPool(state, playerId);

  // Burn exactly the requirement of each operating plant. §9.1.
  const consumed = emptyResources();
  const { alloc } = maxFlowAssign(pool, fuelSlots(ids));
  alloc.forEach((row) => {
    RESOURCE_TYPES.forEach((t, i) => {
      consumed[t] += row[i] ?? 0;
    });
  });
  const remaining = { ...pool };
  for (const t of RESOURCE_TYPES) remaining[t] -= consumed[t];
  reassignPool(state, playerId, remaining);
  for (const t of RESOURCE_TYPES) returnResource(state, t, consumed[t]);

  const payout = payoutFor(decision.citiesSupplied);
  player.money += payout;
  player.phaseStatus = 'acted';

  pushLog(state, now, {
    category: 'power',
    playerId,
    message: `${player.name} supplies ${decision.citiesSupplied} cities and earns ${payout} Elektro.`,
    data: {
      event: 'citiesPowered',
      playerId,
      operatePlantIds: ids,
      citiesSupplied: decision.citiesSupplied,
      capacity: ids.reduce((s, id) => s + getPlant(id).cities, 0),
      consumed: { ...consumed },
      payout,
      moneyAfter: player.money,
      usaCoalStorage: state.usaCoalStorage,
    },
  });
}

/* ------------------------------------------------------------------ *
 * 9.2 Resupply the resource market
 * ------------------------------------------------------------------ */

function sourcePool(state: GameState, type: ResourceType): number {
  if (type === 'coal' && usesCoalStorage(state)) return state.usaCoalStorage;
  return state.supply[type];
}

function drawFromSource(state: GameState, type: ResourceType, n: number): void {
  if (type === 'coal' && usesCoalStorage(state)) state.usaCoalStorage -= n;
  else state.supply[type] -= n;
}

/**
 * §9.2: "Start at the highest-priced empty space and fill toward the lowest-priced
 * spaces. If the supply has fewer tokens than the required refill amount, place
 * all available tokens and leave the market partially empty."
 */
/**
 * §9.2 resupply.
 *
 * `stepOverride` exists for one case only: §10 requires "Step 2 refill values
 * one final time for the current bureaucracy" when the Step 3 card surfaces
 * while the game is still in Step 1. That card surfaces during the plant-market
 * update, which §9 resolves *after* this — so the caller resolves the Step the
 * refill should use and passes it in, rather than this reading a `state.step`
 * that is about to change.
 */
export function refillMarket(state: GameState, now: number, stepOverride?: Step): void {
  const usedStep: Step = stepOverride ?? state.step;
  const row = refillFor(state.settings.mapId, state.settings.playerCount, usedStep);
  const added: Record<string, number> = {};
  const shortfall: Record<string, number> = {};

  for (const type of RESOURCE_TYPES) {
    const want = row[type] ?? 0;
    if (want === 0) continue;
    // §12 Germany: after the phase-out uranium is never resupplied again.
    if (type === 'uranium' && state.uraniumPhaseOut) {
      shortfall[type] = want;
      continue;
    }
    const available = Math.min(want, sourcePool(state, type));
    let remaining = available;
    const spaces = state.resourceMarket[type];
    for (let i = spaces.length - 1; i >= 0 && remaining > 0; i--) {
      const space = spaces[i]!;
      const room = space.capacity - space.filled;
      if (room <= 0) continue;
      const put = Math.min(room, remaining);
      space.filled += put;
      remaining -= put;
    }
    const placed = available - remaining;
    drawFromSource(state, type, placed);
    added[type] = placed;
    if (placed < want) shortfall[type] = want - placed;
  }

  pushLog(state, now, {
    category: 'resource',
    message: `The resource market is resupplied (Step ${usedStep}).`,
    data: {
      event: 'marketRefilled',
      // The Step whose column was actually used, which is not always
      // `state.step` — see `stepOverride` above (§10).
      step: usedStep,
      mapId: state.settings.mapId,
      playerCount: state.settings.playerCount,
      required: { ...row },
      added,
      shortfall,
      uraniumPhaseOut: state.uraniumPhaseOut,
      supply: { ...state.supply },
      usaCoalStorage: state.usaCoalStorage,
      market: RESOURCE_TYPES.reduce<Record<string, number[]>>((acc, t) => {
        acc[t] = state.resourceMarket[t].map((s) => s.filled);
        return acc;
      }, {}),
    },
  });
}

/* ------------------------------------------------------------------ *
 * 9.3 Update the plant market
 * ------------------------------------------------------------------ */

export function updatePlantMarket(state: GameState, now: number): void {
  // §9.3: "If the plant stack is exhausted, do not draw replacements. During each
  // later Phase 5, remove the smallest-numbered plant from the market."
  if (state.plantMarket.stack.length === 0) {
    removeLowestCurrent(state, now, 'stackExhausted');
    sortMarket(state);
    return;
  }

  if (state.step === 3) {
    removeLowestCurrent(state, now, 'step3MarketUpdate');
  } else {
    buryHighestFuture(state, now);
  }
  const outcome = drawReplacement(state, now, 'phase5MarketUpdate');
  if (outcome.kind === 'step3') {
    // §10 Phase 5 timing: removals now, Step 3 active from Phase 1 next round.
    applyStep3Transition(state, now, 'phase5');
  }
  sortMarket(state);
}

/* ------------------------------------------------------------------ *
 * End of Phase 5
 * ------------------------------------------------------------------ */

export function finishBureaucracy(state: GameState, now: number): void {
  // §13: the Trust hands its free tokens back once production is resolved.
  if (trustPlayer(state)) trustReturnResources(state, now);

  /*
   * §10's Phase-5 Step 3 branch: "Use Step 2 refill values one final time for
   * the current bureaucracy", reinforced by "If Step 3 begins before Step 2,
   * apply all Step 2 changes first".
   *
   * The Step 3 card surfaces during the plant-market update, which §9 resolves
   * *after* the resupply — so at refill time `state.step` is still 1 and the
   * market was being under-supplied by four tokens at four players, once and
   * permanently. Rather than reordering the two subphases (§9 fixes their
   * order, and the rules log should reflect it), we look ahead: the update
   * draws from the top of the stack, so the Step 3 card being there means
   * Step 2 is about to be forced.
   */
  const step3AboutToSurface = state.plantMarket.stack[0] === STEP3_PLANT_ID;
  const refillStep: Step = !state.step2Triggered && step3AboutToSurface ? 2 : state.step;

  refillMarket(state, now, refillStep);
  updatePlantMarket(state, now);

  pushLog(state, now, {
    category: 'system',
    message: `Round ${state.round} ends.`,
    data: {
      event: 'roundEnd',
      round: state.round,
      step: state.step,
      standings: state.playerOrder.map((id) => ({
        playerId: id,
        cities: getPlayer(state, id).cities.length,
        money: getPlayer(state, id).money,
      })),
    },
  });

  state.round += 1;
  state.phase = 'order';
  state.auction = null;
  state.pendingScrap = null;
  state.acquiredThisRound = [];
  state.passedThisPhase = [];
  state.buildHistory = [];
  setAllPhaseStatus(state, 'eligible');
}
