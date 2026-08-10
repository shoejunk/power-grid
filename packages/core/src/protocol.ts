/**
 * The wire protocol, shared by every game.
 *
 * Game-specific payloads travel as `unknown` and are validated by the owning
 * plugin the moment they arrive, so adding a game never means editing this
 * file. That is the whole point: a message the platform can route is a message
 * the platform can validate, and a payload only the game understands is a
 * payload only the game validates.
 */

import type { GameKey, LobbyState, PlayerId, SeatColor } from './types.js';

/* ------------------------------------------------------------------ *
 * Client → server
 * ------------------------------------------------------------------ */

export type ClientMessage =
  /** Opening frame. A token, if present, resumes an existing seat. */
  | { t: 'hello'; sessionToken?: string }
  | { t: 'rejoin'; sessionToken: string }
  /** `settings` is opaque here and parsed by the plugin named by `gameKey`. */
  | { t: 'createGame'; gameKey: GameKey; name: string; settings: unknown }
  | { t: 'joinGame'; code: string; name: string }
  | { t: 'leaveGame' }
  | { t: 'setReady'; ready: boolean }
  | { t: 'setName'; name: string }
  | { t: 'setColor'; color: SeatColor }
  | { t: 'updateSettings'; settings: unknown }
  | { t: 'addBot' }
  | { t: 'removePlayer'; playerId: PlayerId }
  | { t: 'startGame' }
  /** `action` is opaque here and parsed by the table's plugin. */
  | { t: 'action'; action: unknown; nonce?: string }
  | { t: 'chat'; text: string }
  | { t: 'ping' };

/* ------------------------------------------------------------------ *
 * Server → client
 * ------------------------------------------------------------------ */

export type ServerMessage =
  | { t: 'welcome'; sessionToken: string; playerId: PlayerId; gameKey: GameKey }
  | { t: 'lobby'; lobby: LobbyState }
  /** A redacted game-state snapshot. Shape is the game's own. */
  | { t: 'state'; gameKey: GameKey; state: unknown }
  | { t: 'error'; code: string; message: string }
  | { t: 'actionRejected'; nonce?: string; reason: string }
  | { t: 'chat'; from: PlayerId; name: string; text: string; at: number }
  | { t: 'pong' };

/* ------------------------------------------------------------------ *
 * Close codes
 * ------------------------------------------------------------------ */

/**
 * Application close codes, in the 4000–4999 range reserved for private use.
 * The client distinguishes "you were replaced by another tab" (do not
 * reconnect) from "the server is restarting" (reconnect shortly).
 */
export const CLOSE = {
  NORMAL: 1000,
  /** A newer socket took over this seat. Do not reconnect. */
  REPLACED: 4001,
  /** The socket buffered more than the server is willing to hold. */
  BACKPRESSURE: 4002,
  /** The client sent frames faster than the rate limit allows. */
  RATE_LIMITED: 4003,
  /** The server is going away; reconnect after a backoff. */
  SHUTDOWN: 4004,
  /** The client sent something structurally invalid. */
  PROTOCOL_ERROR: 4005,
} as const;

export type CloseCode = (typeof CLOSE)[keyof typeof CLOSE];
