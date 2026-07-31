/**
 * Server configuration.
 *
 * Everything is overridable by environment variable so the same build runs in
 * dev, test and production; `startServer()` accepts explicit overrides which
 * always win (the integration tests use that to bind an ephemeral port and a
 * throwaway database directory).
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LogLevel } from './logger.js';

const here = path.dirname(fileURLToPath(import.meta.url));
/** `packages/server` — `src/` in dev/test, `dist/` after a build. */
export const SERVER_ROOT = path.resolve(here, '..');
/** `packages/` — used to locate the built client. */
const PACKAGES_ROOT = path.resolve(SERVER_ROOT, '..');

export interface ServerConfig {
  /** TCP port. 0 asks the OS for an ephemeral port (tests). */
  port: number;
  host: string;
  /** Directory holding the persistence file. Created on boot. */
  dataDir: string;
  /** File name inside `dataDir`. */
  dbFile: string;
  /** 'sqlite' | 'json' | 'memory'. 'sqlite' silently degrades to 'json'. */
  storeKind: 'sqlite' | 'json' | 'memory';
  /** Serve `packages/client/dist` as static files. */
  serveClient: boolean;
  clientDist: string;
  /**
   * How long the server waits for a *disconnected* player before playing a
   * safe default move on their behalf. Deliberately generous — a player who
   * reloads the page must never lose their turn. Requirement 8.
   */
  turnTimeoutMs: number;
  /** Think-time for bot seats, purely cosmetic pacing. */
  botDelayMs: number;
  /** WebSocket ping interval; two missed pongs terminate the socket. */
  heartbeatMs: number;
  /** Hard cap on a single inbound WebSocket frame. */
  maxPayloadBytes: number;
  /** Sockets buffering more than this are considered dead and terminated. */
  maxBufferedBytes: number;
  /** Inbound messages allowed per socket per second before we start dropping. */
  maxMessagesPerSecond: number;
  /** Chat lines retained (and persisted) per game. */
  chatHistoryLimit: number;
  /** Games untouched for longer than this are pruned on boot. */
  gameTtlMs: number;
  logLevel: LogLevel;
}

const num = (v: string | undefined, fallback: number): number => {
  if (v === undefined || v.trim() === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const bool = (v: string | undefined, fallback: boolean): boolean => {
  if (v === undefined || v.trim() === '') return fallback;
  return /^(1|true|yes|on)$/i.test(v.trim());
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const isProd = env.NODE_ENV === 'production';
  const dataDir = env.PG_DATA_DIR ? path.resolve(env.PG_DATA_DIR) : path.join(SERVER_ROOT, 'data');

  const storeKind = ((): ServerConfig['storeKind'] => {
    const raw = (env.PG_STORE ?? 'sqlite').toLowerCase();
    return raw === 'json' || raw === 'memory' ? raw : 'sqlite';
  })();

  return {
    port: num(env.PORT, 8787),
    host: env.HOST ?? '0.0.0.0',
    dataDir,
    dbFile: env.PG_DB_FILE ?? 'power-grid.db',
    storeKind,
    serveClient: bool(env.PG_SERVE_CLIENT, isProd),
    clientDist: env.PG_CLIENT_DIST
      ? path.resolve(env.PG_CLIENT_DIST)
      : path.join(PACKAGES_ROOT, 'client', 'dist'),
    // 3 minutes. Long enough to survive a page reload, a phone call, or a
    // laptop lid; short enough that a vanished player cannot stall a table.
    turnTimeoutMs: num(env.PG_TURN_TIMEOUT_MS, 180_000),
    botDelayMs: num(env.PG_BOT_DELAY_MS, 600),
    heartbeatMs: num(env.PG_HEARTBEAT_MS, 30_000),
    maxPayloadBytes: num(env.PG_MAX_PAYLOAD, 64 * 1024),
    maxBufferedBytes: num(env.PG_MAX_BUFFERED, 4 * 1024 * 1024),
    maxMessagesPerSecond: num(env.PG_MAX_MSG_RATE, 50),
    chatHistoryLimit: num(env.PG_CHAT_LIMIT, 200),
    // 30 days: long enough that "we'll finish it next month" works, short
    // enough that abandoned lobbies do not accumulate forever.
    gameTtlMs: num(env.PG_GAME_TTL_MS, 30 * 24 * 60 * 60 * 1000),
    logLevel: (env.PG_LOG_LEVEL as LogLevel | undefined) ?? (isProd ? 'info' : 'debug'),
  };
}
