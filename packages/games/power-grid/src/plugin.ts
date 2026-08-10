/**
 * Power Grid's implementation of the platform contract.
 *
 * This file is the *only* place the game and the platform meet. Everything the
 * server used to know about Power Grid — that a settings object has a map id,
 * that a bid is an integer, that the plant stack is face down, that sealed bid
 * ranges bypass the turn clock, that passing is always a safe fallback — has
 * moved here, behind `GamePlugin`.
 *
 * Nothing above this file may import from `./engine` or `./types`.
 */

import {
  invalid,
  isBool,
  isInt,
  isOneOf,
  isRecord,
  isString,
  OK,
  type CreateGameContext,
  type GameDescriptor,
  type GamePlugin,
  type PlayerId,
  type SeatSeed,
  type ValidationResult,
} from '@tt/core';

import {
  applyAction as engineApply,
  validateAction as engineValidate,
  createGame as engineCreateGame,
  defaultActionFor as engineDefaultAction,
} from './engine/index.js';
import {
  emptyResources,
  MAP_IDS,
  PLAYER_COLORS,
  RESOURCE_TYPES,
  type GameAction,
  type GameSettings,
  type GameState,
  type MapId,
  type PlayerColor,
  type ResourceBundle,
  type ResourceType,
} from './types.js';

/* ------------------------------------------------------------------ *
 * Seat bounds
 * ------------------------------------------------------------------ */

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;

/** Placeholder id substituted for face-down plant cards before broadcast. */
export const HIDDEN_PLANT_ID = -1;

/* ------------------------------------------------------------------ *
 * Descriptor
 * ------------------------------------------------------------------ */

const descriptor: GameDescriptor = {
  key: 'power-grid',
  name: 'Power Grid',
  tagline: 'Buy plants, corner the fuel market, light up the map.',
  blurb:
    'An auction and network-building game of brutal economics. Bid against the table for ' +
    'power plants, buy the fuel to run them before anyone else does, and expand your grid ' +
    'across the map — while the turn order punishes whoever is winning.',
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  playTime: '90–120 min',
  seatColors: PLAYER_COLORS,
  supportsBots: true,
  theme: {
    accent: '#f0b429',
    backdrop: '#131a24',
    ink: '#eef3f8',
  },
};

/* ------------------------------------------------------------------ *
 * Settings
 * ------------------------------------------------------------------ */

function defaultSettings(): GameSettings {
  return {
    mapId: 'germany',
    playerCount: 4,
    experiencedStart: false,
    againstTheTrust: false,
    seed: '',
  };
}

function parseSettingsPatch(raw: unknown): Partial<GameSettings> | null {
  if (!isRecord(raw)) return null;
  const out: Partial<GameSettings> = {};

  if ('mapId' in raw) {
    if (!isOneOf<MapId>(raw.mapId, MAP_IDS)) return null;
    out.mapId = raw.mapId;
  }
  if ('playerCount' in raw) {
    if (!isInt(raw.playerCount) || raw.playerCount < MIN_PLAYERS || raw.playerCount > MAX_PLAYERS) {
      return null;
    }
    out.playerCount = raw.playerCount;
  }
  if ('experiencedStart' in raw) {
    if (!isBool(raw.experiencedStart)) return null;
    out.experiencedStart = raw.experiencedStart;
  }
  if ('againstTheTrust' in raw) {
    if (!isBool(raw.againstTheTrust)) return null;
    out.againstTheTrust = raw.againstTheTrust;
  }
  if ('seed' in raw && raw.seed !== undefined) {
    if (!isString(raw.seed) || raw.seed.length > 64) return null;
    out.seed = raw.seed;
  }
  return out;
}

/**
 * Rules-level settings check. Called on every host edit and again at start, so
 * a table can never begin in a configuration the engine would reject.
 */
function validateSettings(settings: GameSettings, seatCount: number): ValidationResult {
  if (settings.playerCount < MIN_PLAYERS || settings.playerCount > MAX_PLAYERS) {
    return invalid(`Player count must be between ${MIN_PLAYERS} and ${MAX_PLAYERS}.`);
  }
  if (settings.playerCount < seatCount) {
    return invalid('Remove players before lowering the player count.');
  }
  if (settings.againstTheTrust && settings.playerCount !== 2) {
    return invalid('Against the Trust is a two-player variant. §13');
  }
  return OK;
}

/* ------------------------------------------------------------------ *
 * Action parsing
 * ------------------------------------------------------------------ */

/**
 * Structural check of an untrusted action payload — shape only. Legality is
 * `validateAction`'s job, and the engine remains the only authority on it.
 */
function parseAction(raw: unknown): GameAction | null {
  if (!isRecord(raw) || !isString(raw.type)) return null;
  switch (raw.type) {
    case 'selectZone':
      return Array.isArray(raw.areas) && raw.areas.every(isString) && raw.areas.length <= 6
        ? { type: 'selectZone', areas: raw.areas as string[] }
        : null;
    case 'markStartCity':
      return isString(raw.cityId) ? { type: 'markStartCity', cityId: raw.cityId } : null;
    case 'placeTrustHouse':
      return isString(raw.cityId) ? { type: 'placeTrustHouse', cityId: raw.cityId } : null;
    case 'startGame':
      return { type: 'startGame' };

    case 'nominatePlant': {
      if (!isInt(raw.plantId) || !isInt(raw.bid) || raw.bid < 0) return null;
      if (raw.maxBid !== undefined && (!isInt(raw.maxBid) || raw.maxBid < 0)) return null;
      return {
        type: 'nominatePlant',
        plantId: raw.plantId,
        bid: raw.bid,
        ...(raw.maxBid !== undefined ? { maxBid: raw.maxBid as number } : {}),
      };
    }
    case 'passNomination':
      return { type: 'passNomination' };
    case 'submitBidRange':
      return isInt(raw.minBid) && raw.minBid >= 0 && isInt(raw.maxBid) && raw.maxBid >= 0
        ? { type: 'submitBidRange', minBid: raw.minBid, maxBid: raw.maxBid }
        : null;
    case 'bid':
      return isInt(raw.amount) && raw.amount >= 0 ? { type: 'bid', amount: raw.amount } : null;
    case 'passBid':
      return { type: 'passBid' };
    case 'scrapPlant':
      return isInt(raw.plantId) ? { type: 'scrapPlant', plantId: raw.plantId } : null;

    case 'buyResources': {
      if (!Array.isArray(raw.purchases)) return null;
      const purchases: { resource: ResourceType; count: number }[] = [];
      for (const p of raw.purchases) {
        if (!isRecord(p) || !isInt(p.count) || p.count < 0) return null;
        if (!isOneOf<ResourceType>(p.resource, RESOURCE_TYPES)) return null;
        purchases.push({ resource: p.resource, count: p.count });
      }
      return { type: 'buyResources', purchases };
    }
    case 'redistributeResources': {
      if (!Array.isArray(raw.assignment)) return null;
      const assignment: { plantId: number; stored: ResourceBundle }[] = [];
      for (const a of raw.assignment) {
        if (!isRecord(a) || !isInt(a.plantId) || !isRecord(a.stored)) return null;
        const stored = emptyResources();
        for (const key of RESOURCE_TYPES) {
          const n = a.stored[key];
          if (!isInt(n) || n < 0) return null;
          stored[key] = n;
        }
        assignment.push({ plantId: a.plantId, stored });
      }
      return { type: 'redistributeResources', assignment };
    }
    case 'passResources':
      return { type: 'passResources' };

    case 'buildCity':
      return isString(raw.cityId) ? { type: 'buildCity', cityId: raw.cityId } : null;
    case 'passBuilding':
      return { type: 'passBuilding' };

    case 'powerCities': {
      const d = raw.decision;
      if (!isRecord(d)) return null;
      if (!Array.isArray(d.operatePlantIds) || !d.operatePlantIds.every(isInt)) return null;
      if (!isInt(d.citiesSupplied) || d.citiesSupplied < 0) return null;
      return {
        type: 'powerCities',
        decision: {
          operatePlantIds: d.operatePlantIds as number[],
          citiesSupplied: d.citiesSupplied,
        },
      };
    }

    case 'undoLastBuild':
      return { type: 'undoLastBuild' };

    default:
      return null;
  }
}

/* ------------------------------------------------------------------ *
 * Lifecycle
 * ------------------------------------------------------------------ */

function createGame(
  ctx: CreateGameContext,
  settings: GameSettings,
  seats: SeatSeed[],
): GameState {
  let state = engineCreateGame(
    { ...settings, seed: settings.seed || ctx.seed },
    /*
     * Seat colours are plain strings at the platform boundary; here they are
     * narrowed back to the palette this game published in its descriptor, so
     * an unrecognised colour becomes an engine error rather than a silently
     * unrenderable house.
     */
    seats.map((s) => {
      if (!(PLAYER_COLORS as readonly string[]).includes(s.color)) {
        throw new Error(`Seat '${s.name}' has colour '${s.color}', which is not a Power Grid colour`);
      }
      return { id: s.playerId, name: s.name, color: s.color as PlayerColor, isBot: s.isBot };
    }),
    ctx.hostId,
    ctx.code,
    { now: ctx.now, gameId: ctx.gameId },
  );

  /*
   * Region choice is automatic for every new game. The empty selection is the
   * engine's request to draw a seeded random zone; running it here rather than
   * in the server keeps contiguity and replay rules inside the engine, and
   * keeps the server from knowing that Power Grid has regions at all.
   */
  if (state.phase === 'setup' && state.setupStage === 'zoneSelection') {
    const action: GameAction = { type: 'selectZone', areas: [] };
    const verdict = engineValidate(state, ctx.hostId, action);
    if (!verdict.ok) {
      throw new Error(`Engine rejected automatic zone selection: ${verdict.reason}`);
    }
    state = engineApply(state, ctx.hostId, action, ctx.now);
  }

  return state;
}

/* ------------------------------------------------------------------ *
 * Information control
 * ------------------------------------------------------------------ */

/**
 * The per-recipient view. Two secrets exist in Power Grid:
 *
 *  - the face-down plant supply stack, whose order is knowledge no player has;
 *  - other players' sealed bid ranges while commitments are being collected.
 *
 * Submission *presence* stays public so the table can see who still owes an
 * answer without learning whether they bid or passed.
 */
function redactStateFor(state: GameState, playerId: PlayerId | null): GameState {
  const view = structuredClone(state);
  view.plantMarket.stack = view.plantMarket.stack.map(() => HIDDEN_PLANT_ID);
  if (view.auction) {
    for (const id of view.auction.eligibleBidders) {
      if (id === playerId || view.auction.commitments[id] === undefined) continue;
      view.auction.commitments[id] = { status: 'submitted' };
    }
  }
  return view;
}

/**
 * Sealed auction decisions are genuinely simultaneous: every eligible bidder
 * may answer while `activePlayerId` names only the first outstanding one.
 */
function allowsOutOfTurn(state: GameState, _playerId: PlayerId, action: GameAction): boolean {
  if (state.auction === null) return false;
  return action.type === 'submitBidRange' || action.type === 'bid' || action.type === 'passBid';
}

/* ------------------------------------------------------------------ *
 * Host handover
 * ------------------------------------------------------------------ */

/**
 * Moves the crown, and the clock with it.
 *
 * Setup decisions belong to the host by rule (§2), so promoting a host without
 * also moving `activePlayerId` strands the table permanently: the new host is
 * refused because it is not their turn, the departing host is refused because
 * they are no longer the host, and no default action can rescue it. That stale
 * state is then persisted, so not even a server restart recovers it.
 */
function applyHostChange(state: GameState, newHostId: PlayerId, _now: number): GameState {
  state.hostId = newHostId;
  if (state.phase === 'setup' && state.activePlayerId !== null) {
    state.activePlayerId = newHostId;
  }
  return state;
}

/* ------------------------------------------------------------------ *
 * Presence
 * ------------------------------------------------------------------ */

/**
 * Mirrors live socket presence into `GameState.players` so the board can dim
 * an absent player's assets and the turn rail can show who is actually here.
 *
 * Deliberately outside the reducer: presence is not a move, it is never
 * validated, and it must not appear in a replay. Nothing determinism depends
 * on is touched — `rngCursor`, the log and every rule-bearing field are left
 * exactly as they were.
 */
function applyPresence(
  state: GameState,
  connected: Readonly<Record<PlayerId, boolean>>,
  now: number,
): GameState {
  for (const [playerId, isConnected] of Object.entries(connected)) {
    const player = state.players[playerId];
    if (!player) continue;
    player.connected = isConnected;
    if (isConnected) player.lastSeen = now;
  }
  return state;
}

/* ------------------------------------------------------------------ *
 * Automation
 * ------------------------------------------------------------------ */

/**
 * Pass-like moves the server may fall back on when the strategist has no
 * opinion. Order matters: each is tried against `validateAction` and the first
 * legal one is played, so a table can never stall on an unplanned position.
 */
const SAFE_DEFAULTS: readonly GameAction[] = [
  { type: 'passBid' },
  { type: 'passNomination' },
  { type: 'passResources' },
  { type: 'passBuilding' },
  { type: 'powerCities', decision: { operatePlantIds: [], citiesSupplied: 0 } },
];

/* ------------------------------------------------------------------ *
 * The plugin
 * ------------------------------------------------------------------ */

export const powerGrid: GamePlugin<GameState, GameAction, GameSettings> = {
  descriptor,

  defaultSettings,
  parseSettingsPatch,
  validateSettings,
  // The host chooses the table size; a fifth player must not be able to sit
  // down at a game configured for four.
  seatCapacity: (settings) => settings.playerCount,

  parseAction,
  validateAction: engineValidate,
  applyAction: (state, playerId, action, now) => engineApply(state, playerId, action, now),

  createGame,
  activePlayerOf: (state) => state.activePlayerId,
  isGameOver: (state) => state.phase === 'gameOver',

  redactStateFor,
  allowsOutOfTurn,
  applyPresence,
  applyHostChange,

  defaultActionFor: engineDefaultAction,
  safeDefaultActions: () => [...SAFE_DEFAULTS],
};

export default powerGrid;
