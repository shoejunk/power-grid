/**
 * Platform-level domain model.
 *
 * Everything in this file is true of *any* board game the site hosts: a table
 * has seats, a seat belongs to a person or a bot, a person holds a session
 * token, the host owns the lobby. Nothing here may name a game, a phase, a
 * resource, a card, or a rule — that all lives in `@game/*`.
 *
 * The test for whether something belongs here: would it still make sense if
 * Power Grid were deleted tomorrow?
 */

/** Opaque per-seat identity. Stable for the life of a table. */
export type PlayerId = string;

/** Registry key for a game implementation, e.g. `power-grid`. */
export type GameKey = string;

/**
 * A seat colour. Deliberately a bare string: each game publishes its own
 * palette through `GameDescriptor.seatColors`, and the platform only ever
 * compares colours for equality (no two seats may share one).
 */
export type SeatColor = string;

/** Result of validating anything. The reason is shown to the player verbatim. */
export type ValidationResult = { ok: true } | { ok: false; reason: string };

export const OK: ValidationResult = { ok: true };
export const invalid = (reason: string): ValidationResult => ({ ok: false, reason });

/* ------------------------------------------------------------------ *
 * Seats and lobbies
 * ------------------------------------------------------------------ */

/** The seat information a game needs in order to build its starting state. */
export interface SeatSeed {
  playerId: PlayerId;
  name: string;
  color: SeatColor;
  isBot: boolean;
}

/** A seat at a table. Survives disconnects, restarts and game start. */
export interface Seat extends SeatSeed {
  ready: boolean;
  /** Used to promote "the longest-seated connected player" to host. */
  joinedAt: number;
}

/** Public projection of a seat, as rendered in a lobby. */
export interface LobbySeat {
  id: PlayerId;
  name: string;
  color: SeatColor;
  isHost: boolean;
  isBot: boolean;
  ready: boolean;
  connected: boolean;
}

/**
 * Public projection of a table before (and during) a match.
 *
 * `settings` is opaque at this layer: the platform stores and echoes it, the
 * game package is the only thing that understands its shape.
 */
export interface LobbyState {
  gameKey: GameKey;
  code: string;
  gameId: string;
  hostId: PlayerId;
  settings: unknown;
  players: LobbySeat[];
  /** True once the host has started and an authoritative game state exists. */
  started: boolean;
  /** Seat bounds, echoed so the lobby UI needs no game-specific knowledge. */
  minPlayers: number;
  maxPlayers: number;
}

/* ------------------------------------------------------------------ *
 * Game state envelope
 * ------------------------------------------------------------------ */

/**
 * The only structural demand the platform makes of a game state.
 *
 * `version` exists so a persisted match written by an older build can be
 * recognised and migrated (see `GamePlugin.migrateState`). Everything else a
 * game needs is its own business — the server persists the object as JSON and
 * never reads inside it.
 *
 * Note the absence of an index signature. Adding one would force every game to
 * declare its state as a type alias rather than an interface (TypeScript does
 * not give interfaces implicit index signatures), and would buy nothing: the
 * platform never indexes into a game state, it only stores and forwards it.
 */
export interface GameStateEnvelope {
  version: number;
}

/** Context the platform supplies when a game builds its starting state. */
export interface CreateGameContext {
  gameId: string;
  /** The shareable join code. Games may surface it, but must not mint it. */
  code: string;
  hostId: PlayerId;
  /** Seed for every random operation, so setup is replayable. */
  seed: string;
  /** Wall-clock stamp, so the game itself never reads the clock. */
  now: number;
}

/* ------------------------------------------------------------------ *
 * Logs
 * ------------------------------------------------------------------ */

/**
 * A human-readable explanation of an automatic rule transition.
 *
 * Games extend this with their own `category` vocabulary and structured
 * `data` payload; the platform only guarantees ordering and identity so a
 * generic log panel can render any game's history.
 */
export interface CoreLogEntry {
  id: number;
  /** Game-defined bucket, used for filtering and icon selection. */
  category: string;
  /** Player the entry is about, when applicable. */
  playerId?: PlayerId;
  /** The sentence shown in the log panel. */
  message: string;
  /** Structured payload so the UI can animate the transition it describes. */
  data?: Record<string, unknown>;
  at: number;
}
