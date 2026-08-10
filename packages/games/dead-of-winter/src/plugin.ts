/**
 * Dead of Winter's implementation of the platform contract.
 *
 * SCAFFOLD — the rules engine that backs these methods is being authored in
 * `./engine`. Every method below is wired to its final signature so the server,
 * the registry and the client can be built and typechecked against the real
 * shape; the bodies that need the engine throw rather than pretend to work.
 *
 * A stub that silently returns an empty state would be far worse than one that
 * throws: it would let a player create a table, sit in a lobby, press start,
 * and only then discover there is no game behind it.
 */

import {
  invalid,
  OK,
  type CreateGameContext,
  type GamePlugin,
  type PlayerId,
  type SeatSeed,
  type ValidationResult,
} from '@tt/core';

import { descriptor, MAX_PLAYERS, MIN_PLAYERS } from './descriptor.js';

/** Placeholder state shape; replaced by the engine's `GameState`. */
export interface DowState {
  version: number;
}

/** Placeholder action shape; replaced by the engine's `GameAction`. */
export type DowAction = { type: string };

/** Placeholder settings shape; replaced by the engine's `GameSettings`. */
export interface DowSettings {
  variant: 'standard';
  playerCount: number;
  seed: string;
}

const notReady = (): never => {
  throw new Error('The Dead of Winter rules engine is not wired up yet.');
};

export const deadOfWinter: GamePlugin<DowState, DowAction, DowSettings> = {
  descriptor,

  defaultSettings: () => ({ variant: 'standard', playerCount: 4, seed: '' }),
  parseSettingsPatch: () => null,
  validateSettings: (_settings, seatCount): ValidationResult =>
    seatCount >= MIN_PLAYERS && seatCount <= MAX_PLAYERS
      ? OK
      : invalid(`Dead of Winter seats ${MIN_PLAYERS}–${MAX_PLAYERS} players.`),

  parseAction: () => null,
  validateAction: (): ValidationResult => invalid('The Dead of Winter engine is not available.'),
  applyAction: notReady,

  createGame: (_ctx: CreateGameContext, _settings: DowSettings, _seats: SeatSeed[]) => notReady(),
  activePlayerOf: (): PlayerId | null => null,
  isGameOver: () => false,

  redactStateFor: (state) => state,
  allowsOutOfTurn: () => false,
};

export default deadOfWinter;
