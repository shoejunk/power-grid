/**
 * Shared engine state utilities: cloning, the random stream, logging, entity
 * lookup, zone bookkeeping and the two counters — morale and the effect stack —
 * that almost every rule touches.
 *
 * Nothing here makes a rules decision on its own. The point of the file is that
 * the phase, action and effect modules never reach into `GameState` directly
 * for anything subtle: zone membership, capacity, casualty ordering and morale
 * clamping all have exactly one implementation, so a rule cited in one place
 * cannot drift from the same rule cited in another.
 */

import { Rng } from '@tt/core';

import type { ContentIndex, ContentPack } from '../content/schema.js';
import { indexPack } from '../content/schema.js';
import { assertUsableContent } from '../content/validate.js';
import {
  COLONY,
  NON_COLONY_LOCATIONS,
  type CardInstanceId,
  type LocationId,
  type NonColonyLocationId,
  type SurvivorInstanceId,
} from '../content/primitives.js';
import type {
  EngineEffect,
  EntranceState,
  GameState,
  ItemInstance,
  LogCategory,
  PendingChoice,
  PlayerId,
  PlayerState,
  SurvivorInstance,
} from '../types.js';
import { clampMorale } from './policy.js';

/* ------------------------------------------------------------------ *
 * Content registry
 * ------------------------------------------------------------------ */

/**
 * Packs available to this process, keyed by `id@version`.
 *
 * A match persists only the pack id and version (§22), never the pack itself,
 * so a state loaded from disk has to find its content again. Registering by
 * *versioned* key is what stops a later content patch from silently rewriting
 * an in-progress game: if the exact version is gone, the engine says so instead
 * of substituting a newer one.
 */
const PACKS = new Map<string, ContentIndex>();

export const packKey = (id: string, version: string): string => `${id}@${version}`;

export function registerContentPack(pack: ContentPack): ContentIndex {
  assertUsableContent(pack);
  const index = indexPack(pack);
  PACKS.set(packKey(pack.id, pack.version), index);
  return index;
}

export function getContentPack(id: string, version: string): ContentIndex {
  const found = PACKS.get(packKey(id, version));
  if (!found) {
    throw new Error(
      `Content pack '${packKey(id, version)}' is not registered; ` +
        'a match may not fall back to a different version (§22).',
    );
  }
  return found;
}

/** The content this match was created against. */
export function contentOf(state: GameState): ContentIndex {
  return getContentPack(state.contentPackId, state.contentVersion);
}

/* ------------------------------------------------------------------ *
 * Cloning and identity
 * ------------------------------------------------------------------ */

/**
 * Deep clone used by `applyAction`. The JSON round-trip is deliberate: state is
 * pure data, and dropping `undefined`-valued keys keeps two states produced by
 * the same action sequence byte-identical under `JSON.stringify`, which is what
 * the determinism test compares (§22).
 */
export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Mints the next deterministic id. Never uses the clock or `Math.random`. */
export function nextId(state: GameState, prefix: string): string {
  state.nextSeq += 1;
  return `${prefix}${state.nextSeq}`;
}

/* ------------------------------------------------------------------ *
 * Random stream (§2.5, §22)
 * ------------------------------------------------------------------ */

/**
 * Runs `fn` against the match's random stream and persists the advanced cursor.
 *
 * Every shuffle, draw, theft, action die and exposure die goes through here, so
 * the cursor in state is always exactly the number of values consumed — the
 * property replay depends on.
 */
export function withRng<T>(state: GameState, fn: (rng: Rng) => T): T {
  const rng = new Rng(state.seed, state.rngCursor);
  const out = fn(rng);
  state.rngCursor = rng.position;
  return out;
}

/* ------------------------------------------------------------------ *
 * Logging (§20, §22)
 * ------------------------------------------------------------------ */

export interface LogInput {
  category: LogCategory;
  message: string;
  playerId?: PlayerId;
  data?: Record<string, unknown>;
  /**
   * When present, only these players may read the entry. §3 forbids the public
   * log from leaking hidden identities; the full entry survives in the audit
   * projection that `redactStateFor(state, null)` is not given.
   */
  audience?: PlayerId[];
}

export function pushLog(state: GameState, now: number, entry: LogInput): void {
  state.log.push({
    id: state.log.length + 1,
    round: state.round,
    phase: state.phase,
    category: entry.category,
    ...(entry.playerId !== undefined ? { playerId: entry.playerId } : {}),
    message: entry.message,
    ...(entry.data !== undefined ? { data: entry.data } : {}),
    ...(entry.audience !== undefined ? { audience: entry.audience } : {}),
    at: now,
  });
}

/* ------------------------------------------------------------------ *
 * Validation results
 * ------------------------------------------------------------------ */

export const ok = { ok: true } as const;
export const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

/* ------------------------------------------------------------------ *
 * Players
 * ------------------------------------------------------------------ */

export function getPlayer(state: GameState, id: PlayerId): PlayerState {
  const p = state.players[id];
  if (!p) throw new Error(`Unknown player '${id}'`);
  return p;
}

export function tryPlayer(state: GameState, id: PlayerId): PlayerState | undefined {
  return state.players[id];
}

/** Seats in clockwise order, skipping eliminated players (§19.5). */
export function activeSeating(state: GameState): PlayerId[] {
  return state.seating.filter((id) => !getPlayer(state, id).eliminated);
}

/**
 * §5.1: turns proceed "clockwise to the player on the left". `seating` is the
 * clockwise order, so the next turn is the next index.
 */
export function nextSeatLeft(state: GameState, from: PlayerId): PlayerId {
  const order = activeSeating(state);
  const i = order.indexOf(from);
  if (i < 0) return order[0]!;
  return order[(i + 1) % order.length]!;
}

/**
 * §5.2 step 7 and §10: the first-player token passes *right*, and the
 * crossroads card is drawn by the player on the active player's right. Both
 * directions exist in the rules and §15 insists they stay distinguishable.
 */
export function nextSeatRight(state: GameState, from: PlayerId): PlayerId {
  const order = activeSeating(state);
  const i = order.indexOf(from);
  if (i < 0) return order[0]!;
  return order[(i - 1 + order.length) % order.length]!;
}

/** Players in turn order for this round, starting from the first player. */
export function turnOrder(state: GameState): PlayerId[] {
  const order = activeSeating(state);
  const start = Math.max(0, order.indexOf(state.firstPlayerId));
  return order.map((_, i) => order[(start + i) % order.length]!);
}

export function nonExiledPlayers(state: GameState): PlayerState[] {
  return activeSeating(state)
    .map((id) => getPlayer(state, id))
    .filter((p) => !p.exiled);
}

/* ------------------------------------------------------------------ *
 * Survivors
 * ------------------------------------------------------------------ */

export function getSurvivor(state: GameState, id: SurvivorInstanceId): SurvivorInstance {
  const s = state.survivors[id];
  if (!s) throw new Error(`Unknown survivor '${id}'`);
  return s;
}

export function trySurvivor(state: GameState, id: SurvivorInstanceId): SurvivorInstance | undefined {
  return state.survivors[id];
}

export function allSurvivors(state: GameState): SurvivorInstance[] {
  // Object key order is insertion order for string keys, which is deterministic
  // because ids are minted from `nextSeq`.
  return Object.values(state.survivors);
}

export function survivorsAt(state: GameState, location: LocationId): SurvivorInstance[] {
  return allSurvivors(state).filter((s) => s.location === location);
}

export function survivorsOf(state: GameState, playerId: PlayerId): SurvivorInstance[] {
  return allSurvivors(state).filter((s) => s.controllerId === playerId);
}

export function influenceOf(state: GameState, survivor: SurvivorInstance): number {
  return contentOf(state).survivors.get(survivor.cardId)?.influence ?? 0;
}

/**
 * §2.3: helpless survivors occupy colony survivor spaces and count as colony
 * survivors for food and zombie generation, so every capacity sum has to add
 * them in.
 */
export function colonyOccupants(state: GameState): number {
  return survivorsAt(state, COLONY).length + state.colony.helpless;
}

export function survivorCapacity(state: GameState, location: LocationId): number {
  if (location === COLONY) return state.colony.survivorSpaces;
  return state.locations[location]?.survivorCapacity ?? 0;
}

export function freeSurvivorSpaces(state: GameState, location: LocationId): number {
  const used = location === COLONY ? colonyOccupants(state) : survivorsAt(state, location).length;
  return Math.max(0, survivorCapacity(state, location) - used);
}

/* ------------------------------------------------------------------ *
 * Entrances (§2.1, §12)
 * ------------------------------------------------------------------ */

export function entrancesOf(state: GameState, location: LocationId): EntranceState[] {
  if (location === COLONY) return state.colony.entrances;
  const loc = state.locations[location];
  return loc ? [loc.entrance] : [];
}

export function zombiesAt(state: GameState, location: LocationId): number {
  return entrancesOf(state, location).reduce((n, e) => n + e.zombies, 0);
}

export function barricadesAt(state: GameState, location: LocationId): number {
  return entrancesOf(state, location).reduce((n, e) => n + e.barricades, 0);
}

/** §2.5: zombies and barricades are mutually exclusive occupants of a space. */
export function entranceFree(entrance: EntranceState): number {
  return Math.max(0, entrance.capacity - entrance.zombies - entrance.barricades);
}

export function locationState(state: GameState, id: NonColonyLocationId) {
  const loc = state.locations[id];
  if (!loc) throw new Error(`Unknown location '${id}'`);
  return loc;
}

export const nonColonyLocations = (): readonly NonColonyLocationId[] => NON_COLONY_LOCATIONS;

/* ------------------------------------------------------------------ *
 * Item zones (§2.4)
 * ------------------------------------------------------------------ */

export type ItemZone =
  | { kind: 'hand'; playerId: PlayerId }
  | { kind: 'equipped'; survivorId: SurvivorInstanceId }
  | { kind: 'locationDeck'; location: NonColonyLocationId }
  | { kind: 'starterDeck' }
  | { kind: 'waste' }
  | { kind: 'crisis' }
  | { kind: 'objective' }
  | { kind: 'search' }
  | { kind: 'returnedToBox' }
  | { kind: 'removedFromGame' }
  | { kind: 'unknown' };

export function getItem(state: GameState, iid: CardInstanceId): ItemInstance {
  const item = state.items[iid];
  if (!item) throw new Error(`Unknown item instance '${iid}'`);
  return item;
}

/** Where an item currently lives. The zone arrays are authoritative. */
export function zoneOf(state: GameState, iid: CardInstanceId): ItemZone {
  for (const pid of state.seating) {
    if (getPlayer(state, pid).hand.includes(iid)) return { kind: 'hand', playerId: pid };
  }
  for (const s of allSurvivors(state)) {
    if (s.equipped.includes(iid)) return { kind: 'equipped', survivorId: s.id };
  }
  for (const loc of NON_COLONY_LOCATIONS) {
    if (state.locations[loc]?.deck.includes(iid)) return { kind: 'locationDeck', location: loc };
  }
  if (state.decks.starterItems.includes(iid)) return { kind: 'starterDeck' };
  if (state.colony.waste.includes(iid)) return { kind: 'waste' };
  if (state.crisis.contributions.some((c) => c.iid === iid)) return { kind: 'crisis' };
  if (state.mainObjective.contributions.includes(iid)) return { kind: 'objective' };
  if (state.search?.drawn.includes(iid)) return { kind: 'search' };
  if (state.decks.returnedToBox.items.includes(iid)) return { kind: 'returnedToBox' };
  if (state.decks.removedFromGame.items.includes(iid)) return { kind: 'removedFromGame' };
  return { kind: 'unknown' };
}

const pull = (arr: string[], value: string): boolean => {
  const i = arr.indexOf(value);
  if (i < 0) return false;
  arr.splice(i, 1);
  return true;
};

/** Detaches an item from wherever it is. Safe to call on an already-loose id. */
export function detachItem(state: GameState, iid: CardInstanceId): void {
  for (const pid of state.seating) pull(getPlayer(state, pid).hand, iid);
  for (const s of allSurvivors(state)) pull(s.equipped, iid);
  for (const loc of NON_COLONY_LOCATIONS) {
    const l = state.locations[loc];
    if (l) pull(l.deck, iid);
  }
  pull(state.decks.starterItems, iid);
  pull(state.colony.waste, iid);
  pull(state.mainObjective.contributions, iid);
  pull(state.decks.returnedToBox.items, iid);
  pull(state.decks.removedFromGame.items, iid);
  const ci = state.crisis.contributions.findIndex((c) => c.iid === iid);
  if (ci >= 0) state.crisis.contributions.splice(ci, 1);
  if (state.search) pull(state.search.drawn, iid);
}

/**
 * Sends a played card to the waste pile — or, for an exiled player, out of the
 * game entirely (§14.2: "Removes played cards from the game instead of adding
 * them to the waste pile").
 */
export function discardPlayedCard(state: GameState, iid: CardInstanceId, ownerId: PlayerId | null): void {
  detachItem(state, iid);
  const owner = ownerId ? tryPlayer(state, ownerId) : undefined;
  if (owner?.exiled) state.decks.removedFromGame.items.push(iid);
  else state.colony.waste.push(iid);
}

export function removeFromGame(state: GameState, iid: CardInstanceId): void {
  detachItem(state, iid);
  state.decks.removedFromGame.items.push(iid);
}

/* ------------------------------------------------------------------ *
 * Dice (§6, §7)
 * ------------------------------------------------------------------ */

export function hasDie(player: PlayerState, value: number): boolean {
  return player.unusedDice.includes(value);
}

/** §7: a threshold action needs a die "greater than or equal to" the threshold. */
export function hasDieAtLeast(player: PlayerState, threshold: number): boolean {
  return player.unusedDice.some((d) => d >= threshold);
}

/** Moves one die of exactly `value` from the unused to the used pool. */
export function spendDie(player: PlayerState, value: number): boolean {
  const i = player.unusedDice.indexOf(value);
  if (i < 0) return false;
  player.unusedDice.splice(i, 1);
  player.usedDice.push(value);
  return true;
}

/* ------------------------------------------------------------------ *
 * Morale (§9.3, §11, §16, §24)
 * ------------------------------------------------------------------ */

/**
 * Applies a morale change, clamping to the printed track (§24 policy) and
 * recording the direction so a `moraleChanged` crossroads trigger can see it.
 *
 * The zero test is *not* here: §11.4 defers it during zombie placement and §16
 * makes it immediate everywhere else, so the caller runs `checkMoraleZero` when
 * the rules say to.
 */
export function adjustMorale(
  state: GameState,
  now: number,
  delta: number,
  reason: string,
  playerId?: PlayerId,
): void {
  if (delta === 0) return;
  const before = state.colony.morale;
  state.colony.morale = clampMorale(before + delta, state.colony.maxMorale);
  const applied = state.colony.morale - before;
  pushLog(state, now, {
    category: 'morale',
    ...(playerId ? { playerId } : {}),
    message:
      applied === 0
        ? `Morale stays at ${before} (${reason}).`
        : `Morale ${applied > 0 ? 'rises' : 'falls'} to ${state.colony.morale} (${reason}).`,
    data: { event: 'morale', before, after: state.colony.morale, delta: applied, reason },
  });
  if (state.turn && applied !== 0) {
    state.turn.events.push({ event: 'moraleChanged', moraleDirection: applied > 0 ? 'up' : 'down' });
  }
}

/* ------------------------------------------------------------------ *
 * The effect stack (§20)
 * ------------------------------------------------------------------ */

export const EMPTY_CTX = {
  sourceCardId: null,
  sourceInstanceId: null,
  controllerId: null,
  sourceSurvivorId: null,
} as const;

/**
 * Pushes a new frame on top of the stack.
 *
 * Stack, not queue: a nested effect (a requested card played as the input to
 * another ability, §8.6) must finish before the effect that asked for it
 * continues, and §8.1 forbids an ordinary item play from wedging in between.
 */
export function pushFrame(
  state: GameState,
  effects: EngineEffect[],
  ctx: Partial<typeof EMPTY_CTX & { controllerId: PlayerId | null }> = {},
): void {
  if (effects.length === 0) return;
  state.effectStack.push({
    id: state.nextSeq + 1,
    queue: [...effects],
    vars: {},
    ctx: { ...EMPTY_CTX, ...ctx },
  });
  state.nextSeq += 1;
}

/** Queues effects at the *front* of the current frame, ahead of its remainder. */
export function unshiftIntoCurrentFrame(state: GameState, effects: EngineEffect[]): void {
  const frame = state.effectStack[state.effectStack.length - 1];
  if (!frame) {
    pushFrame(state, effects);
    return;
  }
  frame.queue.unshift(...effects);
}

/** True while any effect is mid-resolution — §8.1's interruption guard. */
export function effectsResolving(state: GameState): boolean {
  return state.effectStack.some((f) => f.queue.length > 0) || state.pendingChoices.length > 0;
}

/* ------------------------------------------------------------------ *
 * Pending choices (§20, §21)
 * ------------------------------------------------------------------ */

export function pushChoice(state: GameState, choice: Omit<PendingChoice, 'id'>): PendingChoice {
  const full: PendingChoice = { id: nextId(state, 'ch'), ...choice };
  state.pendingChoices.push(full);
  return full;
}

export function headChoice(state: GameState): PendingChoice | null {
  return state.pendingChoices[0] ?? null;
}
