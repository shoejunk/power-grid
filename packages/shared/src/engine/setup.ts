/**
 * §2 Setup — zone selection, plant market/stack construction with the exact
 * setup removals, Trust placement and the optional experienced-player starting
 * cities.
 */

import type {
  AreaId,
  CityId,
  GameSettings,
  GameState,
  PlayerColor,
  PlayerId,
  Player,
  ResourceMarket,
  ResourceType,
  ValidationResult,
} from '../types.js';
import {
  PLAYER_COLORS,
  RESOURCE_TYPES,
  STEP3_PLANT_ID,
  emptyResources,
} from '../types.js';
import {
  HOUSES_PER_PLAYER,
  MARKET_LAYOUT,
  SETUP_REMOVALS_FALLBACK,
  STARTING_MONEY,
  TRUST_HOUSES,
  TRUST_INITIAL_PLACEMENTS,
  ZONE_AREA_COUNT,
} from './constants.js';
import { PLUG_PLANT_IDS, SETUP_REMOVALS, SOCKET_PLANT_IDS } from '../data/plants.js';
import { Rng } from '../rng.js';
import {
  fail,
  getPlayer,
  ok,
  pushLog,
  syncOrderIndices,
  trustPlayer,
} from './state.js';
import { isZoneContiguous, neighboursInZone, resolveMap, zoneCities } from './mapAccess.js';
import { sortMarket, withRng } from './plantMarket.js';

export interface SeatInput {
  id: PlayerId;
  name: string;
  color?: PlayerColor;
  isBot?: boolean;
}

export interface CreateGameOptions {
  /** Timestamp stamped into `createdAt`/`updatedAt` and the setup log. §14. */
  now?: number;
  gameId?: string;
}

export const TRUST_PLAYER_ID = 'trust';

/** Order in which the two humans place the six Trust houses. §13. */
export const TRUST_PLACEMENT_SEQUENCE: readonly number[] = [0, 1, 1, 0, 0, 1] as const;

/* ------------------------------------------------------------------ *
 * Resource market (§1)
 * ------------------------------------------------------------------ */

function buildResourceMarket(): { market: ResourceMarket; supply: Record<ResourceType, number> } {
  const market = {} as ResourceMarket;
  const supply = emptyResources();
  for (const type of RESOURCE_TYPES) {
    const layout = MARKET_LAYOUT[type];
    let placed = 0;
    market[type] = layout.prices.map((price) => {
      const filled = layout.initiallyOccupiedPrices.includes(price) ? layout.capacityPerSpace : 0;
      placed += filled;
      return { price, capacity: layout.capacityPerSpace, filled };
    });
    supply[type] = layout.totalTokens - placed;
  }
  return { market, supply };
}

/* ------------------------------------------------------------------ *
 * Plant market and stack (§2 steps 8 and 9)
 * ------------------------------------------------------------------ */

export interface PlantSetup {
  current: number[];
  future: number[];
  stack: number[];
  removed: number[];
}

export function buildPlantSetup(rng: Rng, playerCount: number): PlantSetup {
  // 8. Shuffle the plug-backed plants 03–15, draw 8, sort, split 4/4,
  //    then set one more plug-backed plant aside face down.
  const plugs = rng.shuffle(PLUG_PLANT_IDS);
  const opening = plugs.slice(0, 8).sort((a, b) => a - b);
  const setAside = plugs[8]!;
  const remainingPlugs = plugs.slice(9);

  // 9. Randomly remove cards without looking at them.
  const removals = SETUP_REMOVALS[playerCount] ?? SETUP_REMOVALS_FALLBACK;
  const plugPool = remainingPlugs.slice();
  const removedPlugs = rng.takeRandom(plugPool, removals.plug);
  const socketPool = rng.shuffle(SOCKET_PLANT_IDS);
  const removedSockets = rng.takeRandom(socketPool, removals.socket);

  // Shuffle all remaining plant cards together into a face-down supply stack,
  // put the Step 3 card face down under it, and the set-aside plug on top.
  const body = rng.shuffle([...plugPool, ...socketPool]);
  const stack = [setAside, ...body, STEP3_PLANT_ID];

  return {
    current: opening.slice(0, 4),
    future: opening.slice(4),
    stack,
    removed: [...removedPlugs, ...removedSockets].sort((a, b) => a - b),
  };
}

/* ------------------------------------------------------------------ *
 * createGame
 * ------------------------------------------------------------------ */

export function createGame(
  settings: GameSettings,
  seats: readonly SeatInput[],
  hostId: PlayerId,
  code: string,
  options: CreateGameOptions = {},
): GameState {
  const now = options.now ?? 0;
  const humanCount = seats.length;
  if (settings.againstTheTrust) {
    if (humanCount !== 2) throw new Error('Against the Trust requires exactly 2 human players');
    if (settings.playerCount !== 2) throw new Error('Against the Trust requires playerCount = 2');
  } else if (humanCount !== settings.playerCount) {
    throw new Error(`Expected ${settings.playerCount} players, received ${humanCount}`);
  }
  if (settings.playerCount < 2 || settings.playerCount > 6) {
    throw new Error('Power Grid supports 2–6 players');
  }
  if (!seats.some((s) => s.id === hostId)) throw new Error('hostId must be one of the players');
  if (new Set(seats.map((s) => s.id)).size !== seats.length) {
    throw new Error('Duplicate player ids');
  }

  const rng = new Rng(settings.seed, 0);

  const players: Record<PlayerId, Player> = {};
  seats.forEach((seat, i) => {
    players[seat.id] = {
      id: seat.id,
      name: seat.name,
      color: seat.color ?? PLAYER_COLORS[i % PLAYER_COLORS.length]!,
      isTrust: false,
      isBot: seat.isBot ?? false,
      money: STARTING_MONEY,
      housesRemaining: HOUSES_PER_PLAYER,
      plants: [],
      cities: [],
      orderIndex: i,
      phaseStatus: 'eligible',
      hasNetwork: false,
      connected: true,
      lastSeen: now,
    };
  });

  // 4. Randomly determine the initial player order.
  const humanOrder = rng.shuffle(seats.map((s) => s.id));

  let playerOrder: PlayerId[] = humanOrder;
  if (settings.againstTheTrust) {
    players[TRUST_PLAYER_ID] = {
      id: TRUST_PLAYER_ID,
      name: 'The Trust',
      color: 'black',
      isTrust: true,
      isBot: true,
      money: 0,
      housesRemaining: TRUST_HOUSES,
      plants: [],
      cities: [],
      orderIndex: 1,
      phaseStatus: 'eligible',
      hasNetwork: false,
      connected: true,
      lastSeen: now,
    };
    // §13: first human at position 1, Trust permanently at 2, other human at 3.
    playerOrder = [humanOrder[0]!, TRUST_PLAYER_ID, humanOrder[1]!];
  }

  const plantSetup = buildPlantSetup(rng, settings.playerCount);
  const { market, supply } = buildResourceMarket();
  const map = resolveMap(settings.mapId);

  const citySlots: Record<CityId, (PlayerId | null)[]> = {};
  for (const c of map.cities) citySlots[c.id] = [null, null, null];

  const state: GameState = {
    version: 1,
    gameId: options.gameId ?? `game-${code}`,
    code,
    hostId,
    settings: { ...settings },

    phase: 'setup',
    setupStage: 'zoneSelection',
    step: 1,
    round: 0,

    zone: [],

    players,
    playerOrder,
    activePlayerId: hostId,

    plantMarket: {
      current: plantSetup.current,
      future: plantSetup.future,
      stack: plantSetup.stack,
      removed: plantSetup.removed,
      discountPlantId: null,
      discountReplacementRuleArmed: false,
      step3CardRevealed: false,
    },
    resourceMarket: market,
    supply,
    usaCoalStorage: 0,

    citySlots,

    auction: null,
    pendingScrap: null,
    acquiredThisRound: [],
    passedThisPhase: [],

    uraniumPhaseOut: false,

    endGameTriggered: false,
    winnerId: null,

    rngCursor: rng.position,

    log: [],
    createdAt: now,
    updatedAt: now,

    pendingStep3: null,
    trustStartCities: [],
    buildHistory: [],
    finalEvaluation: null,
    step2Triggered: false,
  };

  syncOrderIndices(state);

  pushLog(state, now, {
    category: 'setup',
    message: `Game created on the ${map.name} map for ${settings.playerCount} player(s).`,
    data: {
      event: 'gameCreated',
      mapId: settings.mapId,
      playerCount: settings.playerCount,
      againstTheTrust: settings.againstTheTrust,
      experiencedStart: settings.experiencedStart,
      seed: settings.seed,
      initialOrder: playerOrder.slice(),
      plantMarket: { current: plantSetup.current.slice(), future: plantSetup.future.slice() },
      removedPlants: plantSetup.removed.slice(),
      stackSize: plantSetup.stack.length,
    },
  });

  return state;
}

/* ------------------------------------------------------------------ *
 * Zone selection (§1, §2)
 * ------------------------------------------------------------------ */

export function requiredZoneSize(state: GameState): number {
  return ZONE_AREA_COUNT[state.settings.playerCount] ?? 3;
}

/** Deterministically grows a contiguous zone of the required size. §1. */
export function randomZone(state: GameState): AreaId[] {
  const map = resolveMap(state.settings.mapId);
  const size = requiredZoneSize(state);
  return withRng(state, (rng) => {
    for (let attempt = 0; attempt < 50; attempt++) {
      const start = rng.pick(map.areas).id;
      const chosen = [start];
      while (chosen.length < size) {
        const frontier = map.areas
          .filter((a) => !chosen.includes(a.id) && a.adjacentAreas.some((n) => chosen.includes(n)))
          .map((a) => a.id)
          .sort();
        if (frontier.length === 0) break;
        chosen.push(rng.pick(frontier));
      }
      if (chosen.length === size) return chosen.sort();
    }
    throw new Error('Unable to build a contiguous playing zone from the map data');
  });
}

export function validateSelectZone(
  state: GameState,
  playerId: PlayerId,
  areas: readonly AreaId[],
): ValidationResult {
  if (state.phase !== 'setup' || state.setupStage !== 'zoneSelection') {
    return fail('The playing zone can only be chosen during setup');
  }
  if (playerId !== state.hostId) return fail('Only the host selects the playing zone');
  if (areas.length === 0) return ok; // random selection
  const map = resolveMap(state.settings.mapId);
  const size = requiredZoneSize(state);
  if (areas.length !== size) return fail(`The playing zone must contain exactly ${size} areas`);
  if (new Set(areas).size !== areas.length) return fail('Duplicate areas in the playing zone');
  for (const a of areas) {
    if (!map.areas.some((x) => x.id === a)) return fail(`Unknown area '${a}'`);
  }
  if (!isZoneContiguous(map, areas as string[])) return fail('The playing zone must be contiguous');
  return ok;
}

export function applySelectZone(state: GameState, now: number, areas: readonly AreaId[]): void {
  const chosen = areas.length === 0 ? randomZone(state) : areas.slice();
  state.zone = chosen;
  const map = resolveMap(state.settings.mapId);
  pushLog(state, now, {
    category: 'setup',
    message: `Playing zone: ${chosen
      .map((a) => map.areas.find((x) => x.id === a)?.name ?? a)
      .join(', ')}.`,
    data: {
      event: 'zoneSelected',
      areas: chosen.slice(),
      random: areas.length === 0,
      cities: zoneCities(map, chosen).length,
    },
  });
}

/* ------------------------------------------------------------------ *
 * Trust house placement (§13)
 * ------------------------------------------------------------------ */

/** Which human places the next Trust house, or null when all six are placed. §13. */
export function trustPlacementSeat(state: GameState): PlayerId | null {
  const trust = trustPlayer(state);
  if (!trust) return null;
  const placed = (state.trustStartCities ?? []).length;
  if (placed >= TRUST_INITIAL_PLACEMENTS) return null;
  const humans = state.playerOrder.filter((id) => !getPlayer(state, id).isTrust);
  const seat = TRUST_PLACEMENT_SEQUENCE[placed]!;
  return humans[seat] ?? null;
}

export function validatePlaceTrustHouse(
  state: GameState,
  playerId: PlayerId,
  cityId: CityId,
): ValidationResult {
  if (state.phase !== 'setup' || state.setupStage !== 'trustPlacement') {
    return fail('Trust houses are only placed during Trust setup');
  }
  const expected = trustPlacementSeat(state);
  if (expected === null) return fail('All Trust houses are already placed');
  if (playerId !== expected) return fail('It is not your turn to place a Trust house');
  const map = resolveMap(state.settings.mapId);
  const city = map.cities.find((c) => c.id === cityId);
  if (!city) return fail(`Unknown city '${cityId}'`);
  if (!state.zone.includes(city.area)) return fail('That city is outside the playing zone');
  const slots = state.citySlots[cityId];
  if (!slots || slots[0] !== null) return fail('That city already has a house on the 10 Elektro slot');
  const placed = state.trustStartCities ?? [];
  if (placed.includes(cityId)) return fail('The Trust already occupies that city');
  if (placed.length > 0) {
    const adjacent = placed.some((c) => neighboursInZone(map, state.zone, c).includes(cityId));
    if (!adjacent) return fail('Each further Trust house must be adjacent to an existing Trust house');
  }
  return ok;
}

export function applyPlaceTrustHouse(state: GameState, now: number, cityId: CityId): void {
  const trust = trustPlayer(state)!;
  state.citySlots[cityId]![0] = trust.id;
  trust.cities.push(cityId);
  trust.hasNetwork = true;
  trust.housesRemaining -= 1;
  state.trustStartCities = [...(state.trustStartCities ?? []), cityId];
  pushLog(state, now, {
    category: 'trust',
    message: `A Trust house is placed in ${cityId}.`,
    data: {
      event: 'trustHousePlaced',
      cityId,
      slot: 0,
      housesRemaining: trust.housesRemaining,
      phase: 'setup',
    },
  });
}

/* ------------------------------------------------------------------ *
 * Experienced-player starting cities (§2)
 * ------------------------------------------------------------------ */

/** Next human who must mark a starting city, in player order. §2. */
export function startCitySeat(state: GameState): PlayerId | null {
  for (const id of state.playerOrder) {
    const p = getPlayer(state, id);
    if (!p.isTrust && p.markedStartCity === undefined) return id;
  }
  return null;
}

export function validateMarkStartCity(
  state: GameState,
  playerId: PlayerId,
  cityId: CityId,
): ValidationResult {
  if (state.phase !== 'setup' || state.setupStage !== 'startingCities') {
    return fail('Starting cities are only marked during setup');
  }
  const expected = startCitySeat(state);
  if (expected === null) return fail('Every player has already marked a starting city');
  if (playerId !== expected) return fail('It is not your turn to mark a starting city');
  const map = resolveMap(state.settings.mapId);
  const city = map.cities.find((c) => c.id === cityId);
  if (!city) return fail(`Unknown city '${cityId}'`);
  if (!state.zone.includes(city.area)) return fail('That city is outside the playing zone');
  const slots = state.citySlots[cityId];
  if (!slots || slots[0] !== null) return fail('That city is already occupied');
  for (const id of state.playerOrder) {
    if (getPlayer(state, id).markedStartCity === cityId) {
      return fail('Another player already marked that city');
    }
  }
  return ok;
}

export function applyMarkStartCity(
  state: GameState,
  now: number,
  playerId: PlayerId,
  cityId: CityId,
): void {
  const p = getPlayer(state, playerId);
  p.markedStartCity = cityId;
  pushLog(state, now, {
    category: 'setup',
    message: `${p.name} marks ${cityId} as their starting city.`,
    data: { event: 'startCityMarked', playerId, cityId },
  });
  // §13 experienced setup: the Trust occupies the 15 Elektro slot of each city
  // the humans mark, leaving it with 8 houses in supply.
  const trust = trustPlayer(state);
  if (trust && trust.housesRemaining > 0) {
    state.citySlots[cityId]![1] = trust.id;
    trust.cities.push(cityId);
    trust.housesRemaining -= 1;
    pushLog(state, now, {
      category: 'trust',
      message: `A Trust house is placed on the 15 Elektro slot of ${cityId}.`,
      data: {
        event: 'trustHousePlaced',
        cityId,
        slot: 1,
        housesRemaining: trust.housesRemaining,
        phase: 'setup',
      },
    });
  }
}

/* ------------------------------------------------------------------ *
 * Setup progression
 * ------------------------------------------------------------------ */

/**
 * Moves setup to the next stage that needs a human decision. Returns true once
 * setup is complete and the round loop may start.
 */
export function advanceSetup(state: GameState, now: number): boolean {
  if (state.setupStage === 'lobby') {
    state.activePlayerId = state.hostId;
    return false;
  }
  if (state.setupStage === 'zoneSelection') {
    if (state.zone.length === 0) {
      state.activePlayerId = state.hostId;
      return false;
    }
    state.setupStage = state.settings.againstTheTrust ? 'trustPlacement' : 'startingCities';
  }
  if (state.setupStage === 'trustPlacement') {
    const seat = trustPlacementSeat(state);
    if (seat !== null) {
      state.activePlayerId = seat;
      return false;
    }
    state.setupStage = 'startingCities';
  }
  if (state.setupStage === 'startingCities') {
    if (state.settings.experiencedStart) {
      const seat = startCitySeat(state);
      if (seat !== null) {
        state.activePlayerId = seat;
        return false;
      }
    }
    state.setupStage = 'complete';
    sortMarket(state);
    pushLog(state, now, {
      category: 'setup',
      message: 'Setup is complete.',
      data: {
        event: 'setupComplete',
        zone: state.zone.slice(),
        order: state.playerOrder.slice(),
      },
    });
  }
  if (state.setupStage === 'complete' && state.phase === 'setup') {
    state.phase = 'order';
    state.round = 1;
    state.activePlayerId = null;
    return true;
  }
  return true;
}
