/**
 * §14 "Legal-action validation" — everything the client needs to grey out an
 * illegal choice before the player makes it.
 *
 * `legalActions(state, playerId)` answers, for the player whose turn it is:
 *  - which plants may be nominated and at what minimum bid,
 *  - what the legal bid range is inside a running auction,
 *  - how many of each resource may be bought and what each quantity costs,
 *  - which cities may be connected and the exact total cost of each,
 *  - which plant combinations may be operated and how many cities they supply.
 */

import type {
  CityId,
  GameState,
  PlayerId,
  ResourceType,
  Step,
} from '../types.js';
import { RESOURCE_TYPES, emptyResources } from '../types.js';
import { getPlant } from '../data/plants.js';
import { MAX_PLANTS_PER_PLAYER, payoutFor } from './constants.js';
import { getPlayer } from './state.js';
import { minimumBid } from './plantMarket.js';
import { clockwiseBidders, isEligible, mustBuyThisRound, nextNominator } from './auction.js';
import {
  marketTokens,
  purchasableTokens,
  purchaseCost,
  poolStorable,
  storedPool,
  usesCoalStorage,
} from './resources.js';
import { buildTargets, type BuildTarget } from './building.js';
import { operableCombinations } from './production.js';
import {
  startCitySeat,
  trustPlacementSeat,
  validateMarkStartCity,
  validatePlaceTrustHouse,
} from './setup.js';
import { stateMap } from './mapAccess.js';

/* ------------------------------------------------------------------ *
 * Shapes
 * ------------------------------------------------------------------ */

export interface NominatablePlant {
  plantId: number;
  minimumBid: number;
  discounted: boolean;
  /** False when the player cannot even meet the minimum bid. */
  affordable: boolean;
  /** True when nobody else can bid, so this bid must equal the minimum. §6. */
  uncontested: boolean;
}

export interface BiddingOption {
  plantId: number;
  currentBid: number;
  minimumRaise: number;
  maximumBid: number;
  canRaise: boolean;
}

export interface ResourceOption {
  resource: ResourceType;
  /** Most tokens the player may buy: limited by market, storage and money. */
  maxCount: number;
  /** Tokens physically available (market + USA coal storage). */
  available: number;
  /** Cumulative cost: `costFor[n]` is the price of buying `n` tokens. */
  costFor: number[];
  /** True when the market is dry and only USA coal storage remains. §12. */
  fromUsaCoalStorage: boolean;
  /** Why the player may not buy any, when maxCount is 0. */
  blockedReason: string | null;
}

export interface PowerOption {
  plantIds: number[];
  capacity: number;
  /** Cities actually suppliable: capacity capped by network size. */
  maxCities: number;
  payoutAtMax: number;
}

export interface LegalActions {
  playerId: PlayerId;
  phase: GameState['phase'];
  step: Step;
  /** True when the engine is waiting on this player right now. */
  isActive: boolean;

  /* setup */
  zoneRequired: boolean;
  trustHouseCities: CityId[];
  startCityChoices: CityId[];

  /* phase 2 */
  nominatablePlants: NominatablePlant[];
  canPassNomination: boolean;
  bidding: BiddingOption | null;
  scrappablePlants: number[];

  /* phase 3 */
  resourceOptions: ResourceOption[];
  canPassResources: boolean;

  /* phase 4 */
  buildableCities: BuildTarget[];
  canPassBuilding: boolean;
  canUndoBuild: boolean;

  /* phase 5 */
  powerOptions: PowerOption[];
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

export function legalActions(state: GameState, playerId: PlayerId): LegalActions {
  const player = getPlayer(state, playerId);
  const isActive = state.activePlayerId === playerId;

  const out: LegalActions = {
    playerId,
    phase: state.phase,
    step: state.step,
    isActive,
    zoneRequired: false,
    trustHouseCities: [],
    startCityChoices: [],
    nominatablePlants: [],
    canPassNomination: false,
    bidding: null,
    scrappablePlants: [],
    resourceOptions: [],
    canPassResources: false,
    buildableCities: [],
    canPassBuilding: false,
    canUndoBuild: false,
    powerOptions: [],
  };

  if (state.phase === 'gameOver' || player.isTrust) return out;

  if (state.phase === 'setup') {
    out.zoneRequired = state.setupStage === 'zoneSelection' && playerId === state.hostId;
    if (state.setupStage === 'trustPlacement' && trustPlacementSeat(state) === playerId) {
      out.trustHouseCities = eligibleCities(state).filter(
        (c) => validatePlaceTrustHouse(state, playerId, c).ok,
      );
    }
    if (state.setupStage === 'startingCities' && startCitySeat(state) === playerId) {
      out.startCityChoices = eligibleCities(state).filter(
        (c) => validateMarkStartCity(state, playerId, c).ok,
      );
    }
    return out;
  }

  if (state.phase === 'auction') {
    if (state.pendingScrap && state.pendingScrap.playerId === playerId) {
      // §6 / §14: the newly acquired plant may never be scrapped.
      out.scrappablePlants = player.plants
        .map((p) => p.plantId)
        .filter((id) => id !== state.pendingScrap!.newPlantId);
      return out;
    }
    if (state.auction) {
      const a = state.auction;
      if (a.eligibleBidders.includes(playerId) && a.commitments[playerId] === undefined) {
        out.isActive = true;
        const floor = minimumBid(state, a.plantId);
        out.bidding = {
          plantId: a.plantId,
          currentBid: floor - 1,
          minimumRaise: floor,
          maximumBid: player.money,
          canRaise: player.money >= floor,
        };
      }
      return out;
    }
    if (nextNominator(state) === playerId && isEligible(state, playerId)) {
      const uncontested = clockwiseBidders(state, playerId, false).length === 0;
      out.nominatablePlants = state.plantMarket.current
        .filter((id) => !getPlant(id).isStep3)
        .map((id) => {
          const min = minimumBid(state, id);
          return {
            plantId: id,
            minimumBid: min,
            discounted: state.plantMarket.discountPlantId === id,
            affordable: min <= player.money,
            uncontested,
          };
        });
      out.canPassNomination = !mustBuyThisRound(state, playerId);
    }
    return out;
  }

  if (state.phase === 'resources') {
    if (isActive) {
      out.resourceOptions = RESOURCE_TYPES.map((t) => resourceOption(state, playerId, t));
      out.canPassResources = true;
    }
    return out;
  }

  if (state.phase === 'building') {
    if (isActive) {
      out.buildableCities = buildTargets(state, playerId);
      out.canPassBuilding = true;
      const history = state.buildHistory ?? [];
      const last = history[history.length - 1];
      out.canUndoBuild = !!last && last.playerId === playerId;
    }
    return out;
  }

  if (state.phase === 'bureaucracy') {
    if (isActive) {
      const network = player.cities.length;
      out.powerOptions = operableCombinations(state, playerId).map((opt) => {
        const maxCities = Math.min(opt.capacity, network);
        return {
          plantIds: opt.plantIds.slice(),
          capacity: opt.capacity,
          maxCities,
          payoutAtMax: payoutFor(maxCities),
        };
      });
    }
    return out;
  }

  return out;
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function eligibleCities(state: GameState): CityId[] {
  const map = stateMap(state);
  return map.cities.filter((c) => state.zone.includes(c.area)).map((c) => c.id);
}

/**
 * Everything the UI needs for one resource row: how many are buyable, why not,
 * and the running cost of each quantity. §7, §12, §14.
 */
export function resourceOption(
  state: GameState,
  playerId: PlayerId,
  resource: ResourceType,
): ResourceOption {
  const player = getPlayer(state, playerId);
  const available = purchasableTokens(state, resource);
  const usable = player.plants.some((p) => getPlant(p.plantId).accepts.includes(resource));
  const costFor: number[] = [0];

  if (!usable) {
    return {
      resource,
      maxCount: 0,
      available,
      costFor,
      fromUsaCoalStorage: false,
      blockedReason: 'None of your plants can burn that resource',
    };
  }
  if (available === 0) {
    return {
      resource,
      maxCount: 0,
      available,
      costFor,
      fromUsaCoalStorage: false,
      blockedReason: `${resource} is sold out until the next resupply`,
    };
  }

  const basePool = storedPool(state, playerId);
  let maxCount = 0;
  for (let n = 1; n <= available; n++) {
    const cost = purchaseCost(state, resource, n);
    if (cost === null || cost > player.money) break;
    const pool = { ...basePool };
    pool[resource] += n;
    if (!poolStorable(state, playerId, pool)) break;
    costFor[n] = cost;
    maxCount = n;
  }

  const blocked =
    maxCount === 0
      ? (() => {
          const pool = { ...basePool };
          pool[resource] += 1;
          if (!poolStorable(state, playerId, pool)) return 'Your plants are full';
          return 'You cannot afford another token';
        })()
      : null;

  return {
    resource,
    maxCount,
    available,
    costFor,
    fromUsaCoalStorage:
      resource === 'coal' && usesCoalStorage(state) && marketTokens(state, 'coal') === 0,
    blockedReason: blocked,
  };
}

/**
 * How much free storage the player has, per resource type, ignoring money and
 * market supply. Handy for tooltips. §1.
 */
export function freeStorage(state: GameState, playerId: PlayerId): Record<ResourceType, number> {
  const out = emptyResources();
  const base = storedPool(state, playerId);
  for (const t of RESOURCE_TYPES) {
    let n = 0;
    for (;;) {
      const pool = { ...base };
      pool[t] += n + 1;
      if (!poolStorable(state, playerId, pool)) break;
      n += 1;
      if (n > 64) break;
    }
    out[t] = n;
  }
  return out;
}

/** True when the player already holds the maximum number of plants. §6. */
export function atPlantLimit(state: GameState, playerId: PlayerId): boolean {
  return getPlayer(state, playerId).plants.length >= MAX_PLANTS_PER_PLAYER;
}
