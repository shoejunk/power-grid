/**
 * Phase 3 — Buy Resources. §7.
 *
 * Players are resolved in reverse player order (§4). Purchases always come off
 * the cheapest occupied market space; the USA map adds a separate coal storage
 * area that sells at a flat 8 Elektro once the market is dry (§12).
 */

import type {
  GameState,
  OwnedPlant,
  PlayerId,
  ResourceBundle,
  ResourceType,
  ValidationResult,
} from '../types.js';
import { RESOURCE_TYPES, emptyResources } from '../types.js';
import { getPlant } from '../data/plants.js';
import { USA_COAL_STORAGE_PRICE } from './constants.js';
import { fail, getPlayer, ok, pushLog } from './state.js';
import { stateMap } from './mapAccess.js';
import {
  bundleTotal,
  maxFlowAssign,
  poolFits,
  rowToBundle,
  type PlantSlot,
} from './allocation.js';

/* ------------------------------------------------------------------ *
 * Market queries
 * ------------------------------------------------------------------ */

export function usesCoalStorage(state: GameState): boolean {
  return stateMap(state).rules.coalStorage?.enabled === true;
}

/** Tokens of `type` currently on the market. */
export function marketTokens(state: GameState, type: ResourceType): number {
  return state.resourceMarket[type].reduce((s, sp) => s + sp.filled, 0);
}

/** Tokens the player could buy at all, including USA coal storage. §7, §12. */
export function purchasableTokens(state: GameState, type: ResourceType): number {
  const onMarket = marketTokens(state, type);
  if (type === 'coal' && usesCoalStorage(state) && onMarket === 0) return state.usaCoalStorage;
  return onMarket;
}

/**
 * Cost of buying `count` tokens of `type`, cheapest space first.
 * Returns null when not enough tokens are available.
 */
export function purchaseCost(state: GameState, type: ResourceType, count: number): number | null {
  if (count <= 0) return 0;
  let remaining = count;
  let cost = 0;
  for (const space of state.resourceMarket[type]) {
    if (remaining === 0) break;
    const take = Math.min(space.filled, remaining);
    cost += take * space.price;
    remaining -= take;
  }
  if (remaining > 0) {
    // §12 USA: "After all market coal is purchased, players may continue buying
    // coal for 8 Elektro per token from that storage."
    if (type === 'coal' && usesCoalStorage(state) && marketTokens(state, 'coal') === 0) {
      const fromStorage = Math.min(state.usaCoalStorage, remaining);
      cost += fromStorage * USA_COAL_STORAGE_PRICE;
      remaining -= fromStorage;
    }
  }
  return remaining > 0 ? null : cost;
}

/** Removes `count` tokens of `type` from the market/storage. Returns the price paid. */
export function takeFromMarket(state: GameState, type: ResourceType, count: number): number {
  let remaining = count;
  let cost = 0;
  for (const space of state.resourceMarket[type]) {
    if (remaining === 0) break;
    const take = Math.min(space.filled, remaining);
    space.filled -= take;
    cost += take * space.price;
    remaining -= take;
  }
  if (remaining > 0 && type === 'coal' && usesCoalStorage(state)) {
    const take = Math.min(state.usaCoalStorage, remaining);
    state.usaCoalStorage -= take;
    cost += take * USA_COAL_STORAGE_PRICE;
    remaining -= take;
  }
  if (remaining > 0) throw new Error(`Not enough ${type} available to take ${count}`);
  return cost;
}

/**
 * Returns consumed/discarded tokens. §7: "Fuel consumed during production is
 * returned to the supply, not placed directly on market spaces."
 * §12 USA: burnt coal goes into the coal-storage area instead.
 */
export function returnResource(state: GameState, type: ResourceType, count: number): void {
  if (count <= 0) return;
  if (type === 'coal' && usesCoalStorage(state)) state.usaCoalStorage += count;
  else state.supply[type] += count;
}

export function returnBundle(state: GameState, bundle: ResourceBundle): void {
  for (const t of RESOURCE_TYPES) returnResource(state, t, bundle[t] ?? 0);
}

/* ------------------------------------------------------------------ *
 * Storage (§1, §7)
 * ------------------------------------------------------------------ */

/** Storage slots for a player: capacity = 2 × fuel, ecological plants store nothing. §1. */
export function storageSlots(state: GameState, playerId: PlayerId): PlantSlot[] {
  return getPlayer(state, playerId).plants.map((op) => {
    const plant = getPlant(op.plantId);
    return { accepts: plant.accepts.slice(), cap: plant.fuel * 2 };
  });
}

/** Every token the player currently holds across all their plants. */
export function storedPool(state: GameState, playerId: PlayerId): ResourceBundle {
  const pool = emptyResources();
  for (const op of getPlayer(state, playerId).plants) {
    for (const t of RESOURCE_TYPES) pool[t] += op.stored[t] ?? 0;
  }
  return pool;
}

/** True when the whole pool can legally sit on the player's plants. §1, §7. */
export function poolStorable(state: GameState, playerId: PlayerId, pool: ResourceBundle): boolean {
  return poolFits(pool, storageSlots(state, playerId));
}

/**
 * Lays the pool back out across the player's plants. Used after purchases and
 * after scrapping. §6 "Move resources from the scrapped plant to the remaining
 * plants if those plants have compatible capacity."
 *
 * Returns the tokens that could not be stored, which the caller must return to
 * the supply (never to the market).
 */
export function reassignPool(
  state: GameState,
  playerId: PlayerId,
  pool: ResourceBundle,
): ResourceBundle {
  const player = getPlayer(state, playerId);
  const slots = storageSlots(state, playerId);
  const { alloc } = maxFlowAssign(pool, slots);
  const leftover = { ...pool };
  player.plants.forEach((op: OwnedPlant, i) => {
    const bundle = rowToBundle(alloc[i] ?? []);
    op.stored = bundle;
    for (const t of RESOURCE_TYPES) leftover[t] -= bundle[t];
  });
  return leftover;
}

/* ------------------------------------------------------------------ *
 * buyResources
 * ------------------------------------------------------------------ */

export interface Purchase {
  resource: ResourceType;
  count: number;
}

export function validateBuyResources(
  state: GameState,
  playerId: PlayerId,
  purchases: readonly Purchase[],
): ValidationResult {
  if (state.phase !== 'resources') return fail('Resources may only be bought during Phase 3');
  if (state.activePlayerId !== playerId) return fail('It is not your turn to buy resources');
  const player = getPlayer(state, playerId);
  if (player.isTrust) return fail('The Trust takes resources automatically');
  if (purchases.length === 0) return fail('No resources selected');

  const wanted = emptyResources();
  for (const p of purchases) {
    if (!RESOURCE_TYPES.includes(p.resource)) return fail(`Unknown resource '${p.resource}'`);
    if (!Number.isInteger(p.count) || p.count < 0) return fail('Resource counts must be whole numbers');
    wanted[p.resource] += p.count;
  }
  if (bundleTotal(wanted) === 0) return fail('No resources selected');

  const accepted = new Set<ResourceType>();
  for (const op of player.plants) for (const t of getPlant(op.plantId).accepts) accepted.add(t);

  let total = 0;
  for (const t of RESOURCE_TYPES) {
    const want = wanted[t];
    if (want === 0) continue;
    // §14: "Buying resources a player's plants cannot use or store."
    if (!accepted.has(t)) return fail(`None of your plants can burn ${t}`);
    const available = purchasableTokens(state, t);
    if (want > available) {
      return fail(
        marketTokens(state, t) === 0
          ? `${t} is sold out until the next resupply`
          : `Only ${available} ${t} available`,
      );
    }
    const cost = purchaseCost(state, t, want);
    if (cost === null) return fail(`Only ${available} ${t} available`);
    total += cost;
  }
  if (total > player.money) return fail(`That costs ${total} Elektro; you have ${player.money}`);

  const pool = storedPool(state, playerId);
  for (const t of RESOURCE_TYPES) pool[t] += wanted[t];
  if (!poolStorable(state, playerId, pool)) return fail('Your plants cannot store that many tokens');
  return ok;
}

export function applyBuyResources(
  state: GameState,
  now: number,
  playerId: PlayerId,
  purchases: readonly Purchase[],
): void {
  const player = getPlayer(state, playerId);
  const wanted = emptyResources();
  for (const p of purchases) wanted[p.resource] += p.count;

  let spent = 0;
  const detail: Record<string, number> = {};
  for (const t of RESOURCE_TYPES) {
    if (wanted[t] === 0) continue;
    const paid = takeFromMarket(state, t, wanted[t]);
    spent += paid;
    detail[t] = wanted[t];
  }
  player.money -= spent;

  const pool = storedPool(state, playerId);
  for (const t of RESOURCE_TYPES) pool[t] += wanted[t];
  reassignPool(state, playerId, pool);

  pushLog(state, now, {
    category: 'resource',
    playerId,
    message: `${player.name} buys ${RESOURCE_TYPES.filter((t) => wanted[t] > 0)
      .map((t) => `${wanted[t]} ${t}`)
      .join(', ')} for ${spent} Elektro.`,
    data: {
      event: 'resourcesBought',
      playerId,
      purchased: detail,
      cost: spent,
      moneyAfter: player.money,
      usaCoalStorage: state.usaCoalStorage,
    },
  });
}

/* ------------------------------------------------------------------ *
 * redistributeResources (§7)
 * ------------------------------------------------------------------ */

export function validateRedistribute(
  state: GameState,
  playerId: PlayerId,
  assignment: readonly { plantId: number; stored: ResourceBundle }[],
): ValidationResult {
  const player = getPlayer(state, playerId);
  if (player.isTrust) return fail('The Trust does not rearrange resources');
  if (state.activePlayerId !== playerId) return fail('It is not your turn');
  const owned = player.plants.map((p) => p.plantId).sort((a, b) => a - b);
  const given = assignment.map((a) => a.plantId).sort((a, b) => a - b);
  if (owned.length !== given.length || owned.some((id, i) => id !== given[i])) {
    return fail('The assignment must cover exactly your owned plants');
  }
  const pool = storedPool(state, playerId);
  const target = emptyResources();
  for (const a of assignment) {
    const plant = getPlant(a.plantId);
    let onPlant = 0;
    for (const t of RESOURCE_TYPES) {
      const n = a.stored[t] ?? 0;
      if (!Number.isInteger(n) || n < 0) return fail('Resource counts must be whole numbers');
      if (n > 0 && !plant.accepts.includes(t)) return fail(`Plant ${a.plantId} cannot hold ${t}`);
      onPlant += n;
      target[t] += n;
    }
    if (onPlant > plant.fuel * 2) return fail(`Plant ${a.plantId} can only store ${plant.fuel * 2} tokens`);
  }
  for (const t of RESOURCE_TYPES) {
    if (target[t] !== pool[t]) return fail('The assignment must keep every token you own');
  }
  return ok;
}

export function applyRedistribute(
  state: GameState,
  now: number,
  playerId: PlayerId,
  assignment: readonly { plantId: number; stored: ResourceBundle }[],
): void {
  const player = getPlayer(state, playerId);
  for (const a of assignment) {
    const op = player.plants.find((p) => p.plantId === a.plantId);
    if (!op) continue;
    const bundle = emptyResources();
    for (const t of RESOURCE_TYPES) bundle[t] = a.stored[t] ?? 0;
    op.stored = bundle;
  }
  pushLog(state, now, {
    category: 'resource',
    playerId,
    message: `${player.name} rearranges stored resources.`,
    data: {
      event: 'resourcesRearranged',
      playerId,
      plants: player.plants.map((p) => ({ plantId: p.plantId, stored: { ...p.stored } })),
    },
  });
}
