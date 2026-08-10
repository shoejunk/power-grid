/**
 * In-game UI surface.
 *
 * The match screen composes exactly these pieces. Everything reads authoritative
 * state from the store and every enabled/disabled decision comes from
 * `legalActions()` in @pg/shared — no rule is re-implemented here.
 */
export { BoardSlot } from './BoardSlot';
export { PlayerHud } from './Hud';
export { MomentOverlay } from './MomentOverlay';
export { PhaseRail } from './PhaseRail';
export { PlantMarket } from './PlantMarket';
export { ResourceMarket } from './ResourceMarket';
export { RulesLog } from './RulesLog';
export { RulesSheet } from './RulesSheet';
export { TurnOrderRail } from './TurnOrderRail';

export { MatchProvider, noLegalActions, orderedPlayers, playerName, useMatch } from './model';
export type { MatchValue } from './model';

export { PlantCard } from './parts/PlantCard';
export { StorageBar, Token } from './parts/Tokens';
