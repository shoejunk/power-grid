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
  /** Google OAuth client credentials. Authentication is enabled when both exist. */
  googleClientId: string | null;
  googleClientSecret: string | null;
  /** Require Google authentication for creating, joining and resuming games. */
  googleAuthRequired: boolean;
  /** Canonical public origin used to build the Google callback URL. */
  publicOrigin: string | null;
  /** Lifetime of the HttpOnly account-login cookie. */
  authSessionTtlMs: number;
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

/**
 * Reads a variable under its current `TT_` name, falling back to the legacy
 * `PG_` name from when this server hosted only Power Grid.
 *
 * The fallback is not cosmetic: an existing deployment's systemd unit sets
 * `PG_DATA_DIR`, and silently ignoring it would point the server at an empty
 * directory inside the checkout — losing every in-progress game on the next
 * deploy, which is precisely the failure the persistence design exists to
 * prevent.
 */
function envVar(env: NodeJS.ProcessEnv, name: string): string | undefined {
  return env[`TT_${name}`] ?? env[`PG_${name}`];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const isProd = env.NODE_ENV === 'production';
  const read = (name: string): string | undefined => envVar(env, name);

  const dataDirRaw = read('DATA_DIR');
  const dataDir = dataDirRaw ? path.resolve(dataDirRaw) : path.join(SERVER_ROOT, 'data');

  const storeKind = ((): ServerConfig['storeKind'] => {
    const raw = (read('STORE') ?? 'sqlite').toLowerCase();
    return raw === 'json' || raw === 'memory' ? raw : 'sqlite';
  })();

  const clientDistRaw = read('CLIENT_DIST');

  return {
    port: num(env.PORT, 8787),
    host: env.HOST ?? '0.0.0.0',
    dataDir,
    // The filename is unchanged so an existing deployment keeps its database.
    dbFile: read('DB_FILE') ?? 'power-grid.db',
    storeKind,
    serveClient: bool(read('SERVE_CLIENT'), isProd),
    clientDist: clientDistRaw
      ? path.resolve(clientDistRaw)
      : path.join(PACKAGES_ROOT, 'client', 'dist'),
    botDelayMs: num(read('BOT_DELAY_MS'), 600),
    heartbeatMs: num(read('HEARTBEAT_MS'), 30_000),
    maxPayloadBytes: num(read('MAX_PAYLOAD'), 64 * 1024),
    maxBufferedBytes: num(read('MAX_BUFFERED'), 4 * 1024 * 1024),
    maxMessagesPerSecond: num(read('MAX_MSG_RATE'), 50),
    chatHistoryLimit: num(read('CHAT_LIMIT'), 200),
    // 30 days: long enough that "we'll finish it next month" works, short
    // enough that abandoned lobbies do not accumulate forever.
    gameTtlMs: num(read('GAME_TTL_MS'), 30 * 24 * 60 * 60 * 1000),
    googleClientId: read('GOOGLE_CLIENT_ID') ?? null,
    googleClientSecret: read('GOOGLE_CLIENT_SECRET') ?? null,
    googleAuthRequired: bool(read('GOOGLE_AUTH_REQUIRED'), true),
    publicOrigin: read('PUBLIC_ORIGIN') ?? null,
    authSessionTtlMs: num(read('AUTH_SESSION_TTL_MS'), 30 * 24 * 60 * 60 * 1000),
    logLevel: (read('LOG_LEVEL') as LogLevel | undefined) ?? (isProd ? 'info' : 'debug'),
  };
}
