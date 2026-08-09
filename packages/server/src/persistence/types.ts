/**
 * Persistence contract.
 *
 * Requirement 4: *every* game — lobby or in progress — survives a full server
 * restart. The store is therefore the source of truth on boot; the in-memory
 * `GameHub` is a cache rebuilt from it.
 *
 * Anything that is genuinely runtime-only (an open socket, a bot turn timer,
 * whether a player is connected *right now*) is intentionally NOT persisted:
 * after a restart every player is disconnected until they reconnect.
 */

import type { GameSettings, GameState, PlayerColor, PlayerId } from '@pg/shared';

/** A seat at a table. Survives disconnects, restarts and game start. */
export interface Seat {
  playerId: PlayerId;
  name: string;
  color: PlayerColor;
  isBot: boolean;
  ready: boolean;
  /** Used to promote "the longest-seated connected player" to host. */
  joinedAt: number;
}

export interface ChatEntry {
  from: PlayerId;
  name: string;
  text: string;
  at: number;
}

export interface PersistedGame {
  gameId: string;
  /** Short join code. Unique across live games. */
  code: string;
  hostId: PlayerId;
  settings: GameSettings;
  seats: Seat[];
  /** Null while the game is still in the lobby. */
  state: GameState | null;
  started: boolean;
  chat: ChatEntry[];
  createdAt: number;
  updatedAt: number;
}

/** Maps an opaque bearer token to a seat. Persisted so reloads can resume. */
export interface SessionRecord {
  token: string;
  gameId: string;
  playerId: PlayerId;
  createdAt: number;
  lastSeen: number;
}

export interface GameStore {
  /** Which backend is in use — reported on /health. */
  readonly kind: 'sqlite' | 'json' | 'memory';
  /** File path, or ':memory:'. */
  readonly location: string;

  loadGames(): PersistedGame[];
  saveGame(game: PersistedGame): void;
  deleteGame(gameId: string): void;

  loadSessions(): SessionRecord[];
  saveSession(session: SessionRecord): void;
  deleteSessionsForGame(gameId: string): void;

  close(): void;
}
