/**
 * Match context — the one place the in-game UI reads authoritative state.
 *
 * Every panel in `src/game/**` renders from `GameState` plus `legalActions()`.
 * The client never re-derives a rule: if the engine says an action is not in
 * `LegalActions`, the control that would produce it is disabled and carries the
 * rule that forbids it (quality bar U2, spec §14 "Legal-action validation").
 */

import { createContext, useContext } from 'react';
import type {
  GameMap,
  GameState,
  LegalActions,
  MapCity,
  Player,
  PlayerId,
} from '@game/power-grid';

export interface MatchValue {
  state: GameState;
  /** The seat this browser occupies, or null when watching. */
  meId: PlayerId | null;
  me: Player | null;
  /** Always present — a blank set when this browser has no seat. */
  legal: LegalActions;
  map: GameMap;
  cityIndex: Map<string, MapCity>;
  /** True when the engine is waiting on this browser's seat right now. */
  isMyTurn: boolean;
}

const MatchContext = createContext<MatchValue | null>(null);

export const MatchProvider = MatchContext.Provider;

export function useMatch(): MatchValue {
  const value = useContext(MatchContext);
  if (!value) throw new Error('useMatch() must be used inside <MatchProvider>');
  return value;
}

/** Blank legal-action set — used for spectators and for a seat the engine has not heard of. */
export function noLegalActions(state: GameState, playerId: PlayerId): LegalActions {
  return {
    playerId,
    phase: state.phase,
    step: state.step,
    isActive: false,
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
}

/** Players in this round's order, Trust included. §4. */
export function orderedPlayers(state: GameState): Player[] {
  return state.playerOrder
    .map((id) => state.players[id])
    .filter((p): p is Player => p !== undefined);
}

export function playerName(state: GameState, id: PlayerId | null | undefined): string {
  if (!id) return 'nobody';
  return state.players[id]?.name ?? id;
}
