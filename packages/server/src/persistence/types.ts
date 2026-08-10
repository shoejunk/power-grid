/**
 * Persistence contract.
 *
 * Every game — lobby or in progress — survives a full server restart. The
 * store is therefore the source of truth on boot; the in-memory `GameHub` is a
 * cache rebuilt from it.
 *
 * Anything genuinely runtime-only (an open socket, a bot turn timer, whether a
 * player is connected *right now*) is intentionally NOT persisted: after a
 * restart every player is disconnected until they reconnect.
 *
 * Note what this file does *not* import: no game package, no rules types. A
 * row knows which game it belongs to (`gameKey`) and carries that game's
 * settings and state as opaque JSON. The store can round-trip a game it has
 * never heard of, which is what lets a new title ship without a migration.
 */

import type { GameKey, PlayerId, Seat } from '@tt/core';

export type { Seat };

export interface ChatEntry {
  from: PlayerId;
  name: string;
  text: string;
  at: number;
}

export interface PersistedGame {
  gameId: string;
  /** Which game is being played. Selects the plugin on load. */
  gameKey: GameKey;
  /** Short join code. Unique across live games, across all titles. */
  code: string;
  hostId: PlayerId;
  /** Opaque to the platform; shaped by the owning game plugin. */
  settings: unknown;
  seats: Seat[];
  /** Null while the game is still in the lobby. Opaque to the platform. */
  state: unknown;
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

/**
 * The key assumed for rows written before the server hosted more than one
 * game. Those rows have no `gameKey` column value, and every one of them is a
 * Power Grid table by construction.
 */
export const LEGACY_GAME_KEY: GameKey = 'power-grid';
