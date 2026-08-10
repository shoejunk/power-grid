/**
 * HTTP surface.
 *
 * Deliberately tiny: a game is played entirely over the WebSocket. HTTP exists
 * for health checks, the portal's game catalogue, a pre-flight "is this join
 * code real?" lookup so the client can validate a code before opening a
 * socket, and — in production — serving the built client bundle.
 */

import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express, { type Express, type Request, type Response } from 'express';
import type { ServerConfig } from './config.js';
import type { GameHub } from './hub.js';
import type { Logger } from './logger.js';
import type { GameStore } from './persistence/types.js';

export interface HttpAppDeps {
  config: ServerConfig;
  hub: GameHub;
  store: GameStore;
  logger: Logger;
  startedAt: number;
}

export function createHttpApp(deps: HttpAppDeps): Express {
  const { config, hub, store, logger } = deps;
  const app = express();

  app.disable('x-powered-by');
  app.use(cors());
  app.use(express.json({ limit: '32kb' }));

  /** Liveness + a little operational insight. */
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      uptimeMs: Date.now() - deps.startedAt,
      persistence: { backend: store.kind, location: store.location },
      titles: hub.registry.keys,
      ...hub.stats(),
    });
  });

  /**
   * The portal's catalogue. Descriptors are pure data, so the home page can
   * render every game — name, blurb, seat range, play time, theme — without
   * importing a single game package.
   */
  app.get('/api/games', (_req: Request, res: Response) => {
    res.json({ ok: true, games: hub.registry.descriptors() });
  });

  /**
   * Cheap code lookup so the join screen can say "no such game" without a
   * socket round-trip, and can route the player into the right game's UI.
   * Returns nothing that is not already public to anyone holding the code.
   */
  app.get('/api/games/code/:code', (req: Request, res: Response) => {
    const code = String(req.params.code ?? '').toUpperCase();
    const room = hub.roomByCode(code);
    if (!room) {
      res.status(404).json({ ok: false, code: 'noSuchGame' });
      return;
    }
    res.json({
      ok: true,
      code: room.code,
      gameKey: room.gameKey,
      started: room.started,
      players: room.seats.length,
      minPlayers: room.minPlayers,
      maxPlayers: room.maxPlayers,
      joinable: !room.started && room.seats.length < room.maxPlayers,
    });
  });

  if (config.serveClient) {
    if (fs.existsSync(config.clientDist)) {
      logger.info('Serving built client', { dir: config.clientDist });
      app.use(express.static(config.clientDist, { index: false, maxAge: '1h' }));
      // SPA fallback — anything that is not an API route renders the client.
      app.get(/^(?!\/(?:api|health|ws)\b).*/, (_req: Request, res: Response) => {
        res.sendFile(path.join(config.clientDist, 'index.html'));
      });
    } else {
      logger.warn('TT_SERVE_CLIENT is on but the client bundle is missing', {
        dir: config.clientDist,
      });
    }
  }

  return app;
}
