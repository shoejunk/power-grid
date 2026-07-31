/**
 * The narrow contract the server needs from the rules engine.
 *
 * The real engine lives in `@pg/shared/engine` and is authored separately.
 * The server deliberately depends on this small structural interface rather
 * than on that module directly, so that:
 *
 *  - the server compiles and runs before the engine exists,
 *  - the integration tests can inject a deterministic fake, and
 *  - a future engine rewrite cannot break the transport layer.
 *
 * The server NEVER implements game rules itself. Anything it cannot express
 * through this interface (for example "what is a safe default move?") is
 * derived by probing `validateAction`, so the engine stays the only authority.
 */

import type {
  GameAction,
  GameSettings,
  GameState,
  PlayerColor,
  PlayerId,
  ValidationResult,
} from '@pg/shared';

/** The seat information the engine needs to build a game from a lobby. */
export interface EnginePlayerSeed {
  id: PlayerId;
  name: string;
  color: PlayerColor;
  isBot: boolean;
}

export interface RulesEngine {
  /** Builds a fully set-up `GameState` from finalised lobby settings. */
  createGame(
    settings: GameSettings,
    players: EnginePlayerSeed[],
    hostId: PlayerId,
    code: string,
  ): GameState;

  /** Pure check. Must not mutate `state`. */
  validateAction(state: GameState, playerId: PlayerId, action: GameAction): ValidationResult;

  /**
   * Applies a *previously validated* action and returns the next state.
   * Implementations may return a new object or mutate and return `state`;
   * the server treats the return value as authoritative either way.
   */
  applyAction(state: GameState, playerId: PlayerId, action: GameAction): GameState;

  /**
   * Optional: the safest legal move for a player who is not responding.
   * When absent the server probes `validateAction` with a list of pass-like
   * actions instead. §14 keeps rules knowledge in the engine, so an engine
   * that implements this wins over the server's generic probe.
   */
  defaultActionFor?(state: GameState, playerId: PlayerId): GameAction | null;

  /** Human-readable identifier, surfaced on /health. */
  readonly name?: string;
}
