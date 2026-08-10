/**
 * Phase 1 — Determine Player Order. §4, §5.
 *
 * "rank players by the number of cities in their networks, highest first. For a
 * tie, rank the tied player with the highest-numbered owned plant first."
 *
 * The Trust never moves: "The Trust is always second in player order" (§13), so
 * ranking is computed among the humans and the Trust is re-inserted at index 1.
 */

import type { GameState, PlayerId } from '../types.js';
import { getPlayer, pushLog, syncOrderIndices, trustPlayer } from './state.js';

/** Highest plant number a player owns, or 0. §4 tie-break. */
export function largestPlant(state: GameState, id: PlayerId): number {
  const p = getPlayer(state, id);
  return p.plants.reduce((max, op) => (op.plantId > max ? op.plantId : max), 0);
}

/**
 * Ranks the given players first-to-last.
 *
 * Third-level tie-break (identical city count *and* identical largest plant —
 * possible in round 1 before anyone owns anything) falls back to the previous
 * order, which keeps the reducer deterministic. §14.
 */
export function rankPlayers(state: GameState, ids: readonly PlayerId[]): PlayerId[] {
  const previous = new Map<PlayerId, number>(state.playerOrder.map((id, i) => [id, i]));
  return ids.slice().sort((a, b) => {
    const ca = getPlayer(state, a).cities.length;
    const cb = getPlayer(state, b).cities.length;
    if (ca !== cb) return cb - ca;
    const pa = largestPlant(state, a);
    const pb = largestPlant(state, b);
    if (pa !== pb) return pb - pa;
    return (previous.get(a) ?? 0) - (previous.get(b) ?? 0);
  });
}

/** Recomputes `playerOrder`, keeping the Trust locked at position 2. §4, §13. */
export function computePlayerOrder(state: GameState): PlayerId[] {
  const trust = trustPlayer(state);
  const humans = state.playerOrder.filter((id) => !getPlayer(state, id).isTrust);
  const ranked = rankPlayers(state, humans);
  if (!trust) return ranked;
  const withTrust = ranked.slice();
  withTrust.splice(Math.min(1, withTrust.length), 0, trust.id);
  return withTrust;
}

export interface OrderChange {
  before: PlayerId[];
  after: PlayerId[];
}

/** Applies the recomputed order and logs it. */
export function applyPlayerOrder(state: GameState, now: number, reason: string): OrderChange {
  const before = state.playerOrder.slice();
  const after = computePlayerOrder(state);
  state.playerOrder = after;
  syncOrderIndices(state);
  pushLog(state, now, {
    category: 'order',
    message: `Player order: ${after.map((id) => getPlayer(state, id).name).join(' → ')}.`,
    data: {
      event: 'playerOrder',
      reason,
      before,
      after,
      standings: after.map((id) => ({
        playerId: id,
        cities: getPlayer(state, id).cities.length,
        largestPlant: largestPlant(state, id),
      })),
    },
  });
  return { before, after };
}
