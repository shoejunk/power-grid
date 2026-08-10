/**
 * Shared engine state utilities: cloning, logging, player lookups and the
 * small amount of bookkeeping the authoritative `GameState` needs on top of
 * the published domain model.
 *
 * The extra fields are added through *module augmentation* rather than by
 * editing `types.ts`, so the published contract keeps its original meaning.
 * §14 "Authoritative state" requires the engine to retain pending
 * Step-transition events, Trust state and end-game evaluation data.
 */

import type {
  CityId,
  GameState,
  LogCategory,
  PlayerId,
  Player,
} from '../types.js';

/* ------------------------------------------------------------------ *
 * Engine-private state extensions (§14)
 * ------------------------------------------------------------------ */

/** One house placement, recorded so `undoLastBuild` can be reversed exactly. §8. */
export interface BuildRecord {
  playerId: PlayerId;
  cityId: CityId;
  slot: number;
  routeCost: number;
  slotCost: number;
  /** True when this build caused a free Trust house to drop on the 15₤ slot. §13. */
  trustPlaced: boolean;
}

/** Per-player result of the end-game winner evaluation. §11. */
export interface FinalEvaluationRow {
  playerId: PlayerId;
  /** Cities the player could supply with current plants + stored resources. */
  citiesSupplied: number;
  money: number;
  networkSize: number;
  plantIds: number[];
}

declare module '../types.js' {
  interface GameState {
    /** Which Step-3 timing rule is pending, if any. §10. */
    pendingStep3?: 'phase2' | 'phase5' | null;
    /** The six cities the Trust occupies at setup — blocked during Step 1. §13. */
    trustStartCities?: CityId[];
    /** Builds made during the current Phase 4 turn, newest last. §8. */
    buildHistory?: BuildRecord[];
    /** Winner-evaluation table, filled during the final Phase 5. §11. */
    finalEvaluation?: FinalEvaluationRow[] | null;
    /** True once the Step 2 changes have been applied. §10. */
    step2Triggered?: boolean;
  }
}

/* ------------------------------------------------------------------ *
 * Cloning
 * ------------------------------------------------------------------ */

/**
 * Deep clone used by `applyAction`. A JSON round-trip is deliberate: the state
 * is pure data, and dropping `undefined`-valued keys keeps two states produced
 * by the same action sequence byte-identical under `JSON.stringify`. §14.
 */
export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/* ------------------------------------------------------------------ *
 * Logging (§14 "rules/effects log")
 * ------------------------------------------------------------------ */

export interface LogInput {
  category: LogCategory;
  message: string;
  playerId?: PlayerId;
  data?: Record<string, unknown>;
}

/** Appends a structured log entry. Every automatic transition must call this. */
export function pushLog(state: GameState, now: number, entry: LogInput): void {
  state.log.push({
    id: state.log.length + 1,
    round: state.round,
    phase: state.phase,
    step: state.step,
    category: entry.category,
    ...(entry.playerId !== undefined ? { playerId: entry.playerId } : {}),
    message: entry.message,
    ...(entry.data !== undefined ? { data: entry.data } : {}),
    at: now,
  });
}

/* ------------------------------------------------------------------ *
 * Player helpers
 * ------------------------------------------------------------------ */

export function getPlayer(state: GameState, id: PlayerId): Player {
  const p = state.players[id];
  if (!p) throw new Error(`Unknown player '${id}'`);
  return p;
}

export function tryPlayer(state: GameState, id: PlayerId): Player | undefined {
  return state.players[id];
}

/** Players in current turn order. */
export function orderedPlayers(state: GameState): Player[] {
  return state.playerOrder.map((id) => getPlayer(state, id));
}

/** Reverse player order — Phases 3 and 4. §4. */
export function reverseOrder(state: GameState): PlayerId[] {
  return state.playerOrder.slice().reverse();
}

/** Human (non-Trust) players in turn order. */
export function humanPlayers(state: GameState): Player[] {
  return orderedPlayers(state).filter((p) => !p.isTrust);
}

export function trustPlayer(state: GameState): Player | null {
  for (const id of state.playerOrder) {
    const p = state.players[id];
    if (p?.isTrust) return p;
  }
  return null;
}

export function setAllPhaseStatus(
  state: GameState,
  status: Player['phaseStatus'],
  opts: { trust?: Player['phaseStatus'] } = {},
): void {
  for (const id of state.playerOrder) {
    const p = getPlayer(state, id);
    p.phaseStatus = p.isTrust && opts.trust !== undefined ? opts.trust : status;
  }
}

/** Keeps `Player.orderIndex` in sync with `playerOrder`. */
export function syncOrderIndices(state: GameState): void {
  state.playerOrder.forEach((id, i) => {
    getPlayer(state, id).orderIndex = i;
  });
}

/* ------------------------------------------------------------------ *
 * Small generic helpers
 * ------------------------------------------------------------------ */

export const ok = { ok: true } as const;
export const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

export function sortedNumbers(ids: readonly number[]): number[] {
  return ids.slice().sort((a, b) => a - b);
}

export function minOf(ids: readonly number[]): number | null {
  if (ids.length === 0) return null;
  return ids.reduce((a, b) => (b < a ? b : a), ids[0]!);
}

export function maxOf(ids: readonly number[]): number | null {
  if (ids.length === 0) return null;
  return ids.reduce((a, b) => (b > a ? b : a), ids[0]!);
}
