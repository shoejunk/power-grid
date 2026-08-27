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
  /** Highest audit sequence included in this snapshot; legacy rows may omit it. */
  auditSequence?: number;
  started: boolean;
  chat: ChatEntry[];
  createdAt: number;
  updatedAt: number;
}

/**
 * One immutable entry in a table's authoritative replay stream.
 *
 * The server never interprets `action`; it records the already-parsed payload
 * and gives it back to the owning plugin during replay. `start` captures the
 * exact setup inputs because lobby edits and host changes are not game moves.
 */
export type GameAuditEvent =
  | {
      sequence: number;
      type: 'start';
      at: number;
      hostId: PlayerId;
      settings: unknown;
      seats: Seat[];
    }
  | {
      sequence: number;
      type: 'action';
      at: number;
      playerId: PlayerId;
      action: unknown;
    }
  | {
      sequence: number;
      type: 'hostChange';
      at: number;
      hostId: PlayerId;
    };

export type GameAuditEventInput =
  | Omit<Extract<GameAuditEvent, { type: 'start' }>, 'sequence'>
  | Omit<Extract<GameAuditEvent, { type: 'action' }>, 'sequence'>
  | Omit<Extract<GameAuditEvent, { type: 'hostChange' }>, 'sequence'>;

/** Maps an opaque bearer token to a seat. Persisted so reloads can resume. */
export interface SessionRecord {
  token: string;
  gameId: string;
  playerId: PlayerId;
  /** Google account that owns this seat. Absent only on legacy anonymous rows. */
  accountId?: string;
  createdAt: number;
  lastSeen: number;
}

/** Durable account profile keyed by Google's stable subject identifier. */
export interface AccountRecord {
  accountId: string;
  email: string;
  name: string;
  picture?: string;
  createdAt: number;
  lastSeen: number;
}

/** Opaque, server-side login session represented by an HttpOnly cookie. */
export interface AuthSessionRecord {
  token: string;
  accountId: string;
  createdAt: number;
  lastSeen: number;
  expiresAt: number;
}

export interface GameStore {
  /** Which backend is in use — reported on /health. */
  readonly kind: 'sqlite' | 'json' | 'memory';
  /** File path, or ':memory:'. */
  readonly location: string;

  loadGames(): PersistedGame[];
  saveGame(game: PersistedGame): void;
  /** Atomically persists a snapshot and appends its new audit events. */
  saveGameWithAudit(game: PersistedGame, events: readonly GameAuditEventInput[]): void;
  deleteGame(gameId: string): void;

  /** Returns the immutable, ordered action/event stream for one table. */
  loadAuditEvents(gameId: string): GameAuditEvent[];
  /** Appends exactly one event and assigns its next per-game sequence. */
  appendAuditEvent(gameId: string, event: GameAuditEventInput): GameAuditEvent;

  loadSessions(): SessionRecord[];
  saveSession(session: SessionRecord): void;
  deleteSession(token: string): void;
  deleteSessionsForGame(gameId: string): void;

  loadAccounts(): AccountRecord[];
  saveAccount(account: AccountRecord): void;
  loadAuthSessions(): AuthSessionRecord[];
  saveAuthSession(session: AuthSessionRecord): void;
  deleteAuthSession(token: string): void;

  close(): void;
}

/**
 * The key assumed for rows written before the server hosted more than one
 * game. Those rows have no `gameKey` column value, and every one of them is a
 * Power Grid table by construction.
 */
export const LEGACY_GAME_KEY: GameKey = 'power-grid';
