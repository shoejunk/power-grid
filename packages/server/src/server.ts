/**
 * Composition root: wires config → persistence → rules engine → hub → HTTP +
 * WebSocket, and hands back a handle the caller (CLI or test) can shut down.
 *
 * Everything is injectable. The integration tests use that to bind an
 * ephemeral port, point the store at a throwaway directory, and supply a
 * deterministic engine — the exact same code path production runs.
 */

import http from 'node:http';
import { WebSocketServer } from 'ws';
import { loadConfig, type ServerConfig } from './config.js';
import { loadEngine } from './engine/loadEngine.js';
import type { RulesEngine } from './engine/types.js';
import { GameHub } from './hub.js';
import { createHttpApp } from './httpApp.js';
import { createLogger, type Logger } from './logger.js';
import { createStore } from './persistence/index.js';
import type { GameStore } from './persistence/types.js';
import { parseClientMessage } from './protocol.js';
import { Connection } from './wire.js';

export interface StartServerOptions extends Partial<ServerConfig> {
  /** Pre-built store. When supplied, `storeKind`/`dataDir` are ignored. */
  store?: GameStore;
  /** Pre-built engine. When supplied, the dynamic engine lookup is skipped. */
  engine?: RulesEngine;
  logger?: Logger;
}

export interface RunningServer {
  readonly config: ServerConfig;
  /** The port actually bound (resolves `port: 0`). */
  readonly port: number;
  readonly url: string;
  readonly wsUrl: string;
  readonly hub: GameHub;
  readonly store: GameStore;
  readonly engine: RulesEngine;
  readonly engineIsFallback: boolean;
  close(): Promise<void>;
}

/** WebSocket endpoint. Everything gameplay-related flows through here. */
export const WS_PATH = '/ws';

export async function startServer(options: StartServerOptions = {}): Promise<RunningServer> {
  const startedAt = Date.now();
  const config: ServerConfig = { ...loadConfig(), ...stripInjectables(options) };
  const logger = options.logger ?? createLogger(config.logLevel, 'pg');

  const store = options.store ?? (await createStore(config, logger));

  let engine: RulesEngine;
  let engineIsFallback = false;
  let engineName: string;
  if (options.engine) {
    engine = options.engine;
    engineName = options.engine.name ?? 'injected';
  } else {
    const loaded = await loadEngine(logger);
    engine = loaded.engine;
    engineIsFallback = loaded.isFallback;
    engineName = loaded.engine.name ?? loaded.source;
  }

  const hub = new GameHub({ store, engine, config, logger });
  hub.load();

  const app = createHttpApp({ config, hub, store, logger, engineName, engineIsFallback, startedAt });
  const httpServer = http.createServer(app);

  /**
   * `maxPayload` gives us the bounded message size required by requirement 10
   * at the protocol level — an oversized frame is rejected by `ws` before a
   * single byte reaches our parser.
   */
  const wss = new WebSocketServer({
    server: httpServer,
    path: WS_PATH,
    maxPayload: config.maxPayloadBytes,
  });

  const connections = new Set<Connection>();

  wss.on('connection', (ws, req) => {
    const conn = new Connection(ws, {
      maxBufferedBytes: config.maxBufferedBytes,
      maxMessagesPerSecond: config.maxMessagesPerSecond,
      logger,
    });
    connections.add(conn);
    logger.debug('Socket opened', { connection: conn.id, ip: req.socket.remoteAddress });

    ws.on('pong', () => {
      conn.isAlive = true;
    });

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        conn.error('badMessage', 'Binary frames are not supported.');
        return;
      }
      if (!conn.allowInbound()) return;

      const parsed = parseClientMessage(data.toString());
      if (!parsed.ok) {
        logger.debug('Malformed message', { connection: conn.id, code: parsed.code });
        conn.error(parsed.code, parsed.message);
        return;
      }
      try {
        hub.handleMessage(conn, parsed.message);
      } catch (err) {
        // A bug in one handler must never take the process down mid-game.
        logger.error('Unhandled error while handling a message', {
          connection: conn.id,
          t: parsed.message.t,
          error: err instanceof Error ? (err.stack ?? err.message) : String(err),
        });
        conn.error('serverError', 'The server failed to process that message.');
      }
    });

    ws.on('close', () => {
      connections.delete(conn);
      logger.debug('Socket closed', { connection: conn.id, playerId: conn.playerId });
      try {
        hub.handleDisconnect(conn);
      } catch (err) {
        logger.error('Error during disconnect handling', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    ws.on('error', (err) => {
      logger.debug('Socket error', { connection: conn.id, error: err.message });
    });
  });

  /**
   * Heartbeat (requirement 10). A socket that misses one full interval is
   * considered dead and terminated — TCP alone will happily keep a
   * half-open connection around for many minutes.
   */
  const heartbeat = setInterval(() => {
    for (const conn of connections) {
      if (!conn.isAlive) {
        logger.debug('Terminating unresponsive socket', { connection: conn.id });
        connections.delete(conn);
        conn.terminate();
        continue;
      }
      conn.isAlive = false;
      conn.ping();
    }
  }, config.heartbeatMs);
  heartbeat.unref?.();

  const port = await listen(httpServer, config.port, config.host);
  const url = `http://localhost:${port}`;
  logger.info('Power Grid server listening', {
    url,
    ws: `${url.replace('http', 'ws')}${WS_PATH}`,
    engine: engineName,
    persistence: store.kind,
  });

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    hub.shutdown();
    for (const conn of connections) conn.terminate();
    connections.clear();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    store.close();
    logger.info('Power Grid server stopped');
  };

  return {
    config,
    port,
    url,
    wsUrl: `${url.replace('http', 'ws')}${WS_PATH}`,
    hub,
    store,
    engine,
    engineIsFallback,
    close,
  };
}

function listen(server: http.Server, port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('Server did not bind to a TCP port'));
        return;
      }
      resolve(address.port);
    });
  });
}

/** Removes the non-config injectables so they cannot pollute `ServerConfig`. */
function stripInjectables(options: StartServerOptions): Partial<ServerConfig> {
  const { store: _store, engine: _engine, logger: _logger, ...rest } = options;
  return rest;
}
