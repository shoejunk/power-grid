/**
 * Placeholder rules engine.
 *
 * This exists so the *server* — lobbies, join codes, persistence, reconnection,
 * bot turn timers — can be built, run and tested end to end while the real rules
 * engine (`@pg/shared/engine`) is authored in parallel. It is loaded ONLY when
 * the real engine cannot be resolved, and it says so loudly on boot.
 *
 * It implements a legal-looking `GameState` (correct setup shapes, real map,
 * real plant and resource data) and a single mechanic: players take turns in
 * player order, nominating a plant from the current market or passing, with
 * phases cycling. That is enough to exercise turn ownership, out-of-turn
 * rejection, reconnection mid-turn, and bot turns —
 * but it is NOT Power Grid and must never ship to players.
 */

import {
  emptyResources,
  getMap,
  HOUSES_PER_PLAYER,
  MARKET_LAYOUT,
  PHASE_ORDER,
  PLANTS,
  PLUG_PLANT_IDS,
  Rng,
  STARTING_MONEY,
  ZONE_AREA_COUNT,
  type AreaId,
  type GameAction,
  type GameSettings,
  type GameState,
  type LogEntry,
  type MarketSpace,
  type Phase,
  type Player,
  type PlayerId,
  type ResourceMarket,
  type ResourceType,
  type ValidationResult,
} from '@pg/shared';
import type { EnginePlayerSeed, RulesEngine } from './types.js';

const ok: ValidationResult = { ok: true };
const no = (reason: string): ValidationResult => ({ ok: false, reason });

/** Phases the placeholder actually asks players to act in. */
const ACTING_PHASES: readonly Phase[] = ['auction', 'resources', 'building', 'bureaucracy'];

/* ------------------------------------------------------------------ *
 * Setup helpers
 * ------------------------------------------------------------------ */

/** Grows a contiguous set of `count` areas from a random seed area. */
function pickZone(mapId: GameSettings['mapId'], playerCount: number, rng: Rng): AreaId[] {
  const map = getMap(mapId);
  const want = ZONE_AREA_COUNT[playerCount] ?? 3;
  const byId = new Map(map.areas.map((a) => [a.id, a]));
  const start = rng.pick(map.areas).id;
  const zone: AreaId[] = [start];
  while (zone.length < want) {
    // Every area adjacent to the zone but not yet in it.
    const frontier = new Set<AreaId>();
    for (const id of zone) {
      for (const adj of byId.get(id)?.adjacentAreas ?? []) {
        if (!zone.includes(adj)) frontier.add(adj);
      }
    }
    if (frontier.size === 0) break;
    zone.push(rng.pick([...frontier]));
  }
  return zone;
}

function buildResourceMarket(): ResourceMarket {
  const build = (type: ResourceType): MarketSpace[] => {
    const layout = MARKET_LAYOUT[type];
    return layout.prices.map((price) => ({
      price,
      capacity: layout.capacityPerSpace,
      filled: layout.initiallyOccupiedPrices.includes(price) ? layout.capacityPerSpace : 0,
    }));
  };
  return { coal: build('coal'), oil: build('oil'), garbage: build('garbage'), uranium: build('uranium') };
}

function suppliesAfterMarket(market: ResourceMarket): Record<ResourceType, number> {
  const out = emptyResources();
  for (const type of ['coal', 'oil', 'garbage', 'uranium'] as const) {
    const onMarket = market[type].reduce((sum, s) => sum + s.filled, 0);
    out[type] = Math.max(0, MARKET_LAYOUT[type].totalTokens - onMarket);
  }
  return out;
}

function logEntry(state: GameState, entry: Omit<LogEntry, 'id' | 'round' | 'phase' | 'step' | 'at'>): void {
  state.log.push({
    id: state.log.length + 1,
    round: state.round,
    phase: state.phase,
    step: state.step,
    at: Date.now(),
    ...entry,
  });
}

/* ------------------------------------------------------------------ *
 * Engine
 * ------------------------------------------------------------------ */

export const fallbackEngine: RulesEngine = {
  name: 'fallback-placeholder',

  createGame(settings: GameSettings, players: EnginePlayerSeed[], hostId: PlayerId, code: string): GameState {
    const rng = new Rng(settings.seed);
    const map = getMap(settings.mapId);
    const zone = pickZone(settings.mapId, players.length, rng);

    const order = rng.shuffle(players.map((p) => p.id));
    const playerRecords: Record<PlayerId, Player> = {};
    for (const seed of players) {
      playerRecords[seed.id] = {
        id: seed.id,
        name: seed.name,
        color: seed.color,
        isTrust: false,
        isBot: seed.isBot,
        money: STARTING_MONEY,
        housesRemaining: HOUSES_PER_PLAYER,
        plants: [],
        cities: [],
        orderIndex: order.indexOf(seed.id),
        phaseStatus: 'eligible',
        hasNetwork: false,
        connected: false,
        lastSeen: 0,
      };
    }

    // Plant market: eight low "plug" plants face up, four current / four future.
    const plugPool = rng.shuffle(PLUG_PLANT_IDS);
    const faceUp = plugPool.slice(0, 8).sort((a, b) => a - b);
    const current = faceUp.slice(0, 4);
    const future = faceUp.slice(4, 8);
    const stack = rng.shuffle(
      PLANTS.map((p) => p.id).filter((id) => !faceUp.includes(id)),
    );

    const resourceMarket = buildResourceMarket();
    const citySlots: Record<string, (PlayerId | null)[]> = {};
    for (const city of map.cities) {
      if (zone.includes(city.area)) citySlots[city.id] = [null, null, null];
    }

    const now = Date.now();
    const state: GameState = {
      version: 1,
      gameId: `${code}-${now}`,
      code,
      hostId,
      settings: { ...settings, playerCount: players.length },
      phase: 'auction',
      setupStage: 'complete',
      step: 1,
      round: 1,
      zone,
      players: playerRecords,
      playerOrder: order,
      activePlayerId: order[0] ?? null,
      plantMarket: {
        current,
        future,
        stack,
        removed: [],
        discountPlantId: current[0] ?? null,
        discountReplacementRuleArmed: true,
        step3CardRevealed: false,
      },
      resourceMarket,
      supply: suppliesAfterMarket(resourceMarket),
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
    };

    logEntry(state, {
      category: 'setup',
      message: `Placeholder engine created a ${players.length}-player game on ${map.name}.`,
      data: { zone },
    });
    return state;
  },

  validateAction(state: GameState, playerId: PlayerId, action: GameAction): ValidationResult {
    if (state.phase === 'gameOver') return no('The game is over.');
    if (!state.players[playerId]) return no('You are not in this game.');
    if (state.activePlayerId !== playerId) return no('It is not your turn.');

    switch (action.type) {
      case 'nominatePlant': {
        if (state.phase !== 'auction') return no('Plants can only be nominated during the auction phase.');
        if (!state.plantMarket.current.includes(action.plantId)) {
          return no('That plant is not in the current market.');
        }
        const minimum = state.plantMarket.discountPlantId === action.plantId ? 1 : action.plantId;
        if (action.bid < minimum) return no(`The minimum bid for that plant is ${minimum}.`);
        if ((state.players[playerId]?.money ?? 0) < action.bid) return no('You cannot afford that bid.');
        if (state.acquiredThisRound.includes(playerId)) return no('You have already bought a plant this round.');
        return ok;
      }
      case 'passNomination':
        return state.phase === 'auction' ? ok : no('Nothing to pass on right now.');
      case 'passResources':
        return state.phase === 'resources' ? ok : no('Not the resource phase.');
      case 'passBuilding':
        return state.phase === 'building' ? ok : no('Not the building phase.');
      case 'powerCities':
        return state.phase === 'bureaucracy' ? ok : no('Not the bureaucracy phase.');
      default:
        return no(`The placeholder engine does not implement '${action.type}'.`);
    }
  },

  applyAction(state: GameState, playerId: PlayerId, action: GameAction): GameState {
    const next: GameState = structuredClone(state);
    const player = next.players[playerId];
    if (!player) return next;

    switch (action.type) {
      case 'nominatePlant': {
        player.money -= action.bid;
        player.plants.push({ plantId: action.plantId, stored: emptyResources() });
        player.phaseStatus = 'purchased';
        next.acquiredThisRound.push(playerId);
        next.plantMarket.current = next.plantMarket.current.filter((id) => id !== action.plantId);
        const drawn = next.plantMarket.stack.shift();
        const pool = [...next.plantMarket.current, ...next.plantMarket.future];
        if (drawn !== undefined) pool.push(drawn);
        pool.sort((a, b) => a - b);
        next.plantMarket.current = pool.slice(0, 4);
        next.plantMarket.future = pool.slice(4);
        if (next.plantMarket.discountPlantId === action.plantId) next.plantMarket.discountPlantId = null;
        logEntry(next, {
          category: 'auction',
          playerId,
          message: `${player.name} bought plant ${action.plantId} for ${action.bid} Elektro.`,
          data: { plantId: action.plantId, bid: action.bid },
        });
        break;
      }
      default: {
        player.phaseStatus = 'passed';
        logEntry(next, {
          category: 'system',
          playerId,
          message: `${player.name} passed (${action.type}).`,
        });
        break;
      }
    }

    advanceTurn(next);
    next.updatedAt = Date.now();
    return next;
  },

  defaultActionFor(state: GameState, playerId: PlayerId): GameAction | null {
    if (state.activePlayerId !== playerId) return null;
    switch (state.phase) {
      case 'auction':
        return { type: 'passNomination' };
      case 'resources':
        return { type: 'passResources' };
      case 'building':
        return { type: 'passBuilding' };
      case 'bureaucracy':
        return { type: 'powerCities', decision: { operatePlantIds: [], citiesSupplied: 0 } };
      default:
        return null;
    }
  },
};

/** Round-robin through `playerOrder`, then through the phase list. */
function advanceTurn(state: GameState): void {
  const order = state.playerOrder;
  const idx = state.activePlayerId ? order.indexOf(state.activePlayerId) : -1;
  if (idx >= 0 && idx < order.length - 1) {
    state.activePlayerId = order[idx + 1] ?? null;
    return;
  }
  // Wrapped: move to the next acting phase, and to the next round after the last.
  const phaseIdx = PHASE_ORDER.indexOf(state.phase);
  let nextPhase: Phase = 'auction';
  for (let i = phaseIdx + 1; i < PHASE_ORDER.length; i++) {
    const candidate = PHASE_ORDER[i];
    if (candidate && ACTING_PHASES.includes(candidate)) {
      nextPhase = candidate;
      break;
    }
  }
  if (nextPhase === 'auction') {
    state.round += 1;
    state.acquiredThisRound = [];
  }
  state.phase = nextPhase;
  state.passedThisPhase = [];
  for (const id of order) {
    const p = state.players[id];
    if (p) p.phaseStatus = 'eligible';
  }
  state.activePlayerId = order[0] ?? null;
}
