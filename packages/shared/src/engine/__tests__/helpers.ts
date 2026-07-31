/** Shared test scaffolding. Not a test file itself. */

import type {
  AreaId,
  CityId,
  GameAction,
  GameSettings,
  GameState,
  MapId,
  PlayerId,
} from '../../types.js';
import { createGame, applyAction, legalActions } from '../index.js';
import type { SeatInput } from '../setup.js';

export const NOW = 1_000;

export function seats(n: number): SeatInput[] {
  return Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` }));
}

export interface GameOpts {
  playerCount?: number;
  mapId?: MapId;
  seed?: string;
  experiencedStart?: boolean;
  againstTheTrust?: boolean;
  zone?: AreaId[];
}

export function settingsFor(opts: GameOpts = {}): GameSettings {
  return {
    mapId: opts.mapId ?? 'germany',
    playerCount: opts.playerCount ?? 3,
    experiencedStart: opts.experiencedStart ?? false,
    againstTheTrust: opts.againstTheTrust ?? false,
    seed: opts.seed ?? 'SEED-ALPHA',
  };
}

/** A game that has been created but has not chosen a zone yet. */
export function fresh(opts: GameOpts = {}): GameState {
  const settings = settingsFor(opts);
  const roster = settings.againstTheTrust ? seats(2) : seats(settings.playerCount);
  return createGame(settings, roster, roster[0]!.id, 'CODE01', { now: NOW });
}

export function act(
  state: GameState,
  playerId: PlayerId,
  action: GameAction,
  now = NOW,
): GameState {
  return applyAction(state, playerId, action, now);
}

/** Drives setup to completion: zone, Trust placement and marked start cities. */
export function start(opts: GameOpts = {}): GameState {
  let s = fresh(opts);
  s = act(s, s.hostId, { type: 'selectZone', areas: opts.zone ?? [] });
  let guard = 0;
  while (s.phase === 'setup' && guard++ < 40) {
    const actor = s.activePlayerId!;
    const legal = legalActions(s, actor);
    if (s.setupStage === 'trustPlacement') {
      s = act(s, actor, { type: 'placeTrustHouse', cityId: legal.trustHouseCities[0]! });
    } else if (s.setupStage === 'startingCities') {
      s = act(s, actor, { type: 'markStartCity', cityId: legal.startCityChoices[0]! });
    } else {
      throw new Error(`stuck in setup stage ${s.setupStage}`);
    }
  }
  return s;
}

/** Every player nominates the cheapest plant they can and wins it uncontested. */
export function buyCheapestPlantEachRound(state: GameState): GameState {
  let s = state;
  let guard = 0;
  while (s.phase === 'auction' && guard++ < 60) {
    const actor = s.activePlayerId!;
    const legal = legalActions(s, actor);
    if (s.pendingScrap) {
      s = act(s, actor, { type: 'scrapPlant', plantId: legal.scrappablePlants[0]! });
      continue;
    }
    if (legal.bidding) {
      s = act(s, actor, { type: 'passBid' });
      continue;
    }
    const cheapest = legal.nominatablePlants.filter((p) => p.affordable)[0];
    if (!cheapest) {
      s = act(s, actor, { type: 'passNomination' });
      continue;
    }
    s = act(s, actor, { type: 'nominatePlant', plantId: cheapest.plantId, bid: cheapest.minimumBid });
  }
  return s;
}

/** Everyone passes on resources. */
export function skipResources(state: GameState): GameState {
  let s = state;
  let guard = 0;
  while (s.phase === 'resources' && guard++ < 40) {
    s = act(s, s.activePlayerId!, { type: 'passResources' });
  }
  return s;
}

/** Everyone passes on building. */
export function skipBuilding(state: GameState): GameState {
  let s = state;
  let guard = 0;
  while (s.phase === 'building' && guard++ < 40) {
    s = act(s, s.activePlayerId!, { type: 'passBuilding' });
  }
  return s;
}

/** Everyone powers as many cities as they can. */
export function powerEveryone(state: GameState): GameState {
  let s = state;
  let guard = 0;
  while (s.phase === 'bureaucracy' && guard++ < 40) {
    const actor = s.activePlayerId!;
    const legal = legalActions(s, actor);
    const best = legal.powerOptions[0] ?? { plantIds: [], maxCities: 0 };
    s = act(s, actor, {
      type: 'powerCities',
      decision: { operatePlantIds: best.plantIds, citiesSupplied: best.maxCities },
    });
  }
  return s;
}

/** Plays one whole round with a simple deterministic policy. */
export function playRound(state: GameState): GameState {
  let s = buyCheapestPlantEachRound(state);
  s = skipResources(s);
  s = skipBuilding(s);
  s = powerEveryone(s);
  return s;
}

/** Gives a player a plant directly (test scaffolding, bypasses the auction). */
export function grantPlant(state: GameState, playerId: PlayerId, plantId: number): void {
  state.players[playerId]!.plants.push({
    plantId,
    stored: { coal: 0, oil: 0, garbage: 0, uranium: 0 },
  });
  state.players[playerId]!.plants.sort((a, b) => a.plantId - b.plantId);
}

/** Puts a house in a city without paying (test scaffolding). */
export function placeHouse(state: GameState, playerId: PlayerId, cityId: CityId, slot = 0): void {
  state.citySlots[cityId]![slot] = playerId;
  state.players[playerId]!.cities.push(cityId);
  state.players[playerId]!.hasNetwork = true;
  state.players[playerId]!.housesRemaining -= 1;
}

export function money(state: GameState, id: PlayerId): number {
  return state.players[id]!.money;
}

export function findLog(state: GameState, event: string) {
  return state.log.filter((l) => (l.data as { event?: string } | undefined)?.event === event);
}

export function lastLog(state: GameState, event: string) {
  const all = findLog(state, event);
  return all[all.length - 1];
}
