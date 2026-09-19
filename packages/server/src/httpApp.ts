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
import type { GoogleAuth } from './auth.js';
import type { Logger } from './logger.js';
import type { GameStore } from './persistence/types.js';
import type { TurnNotifications } from './notifications.js';

export interface HttpAppDeps {
  config: ServerConfig;
  hub: GameHub;
  store: GameStore;
  logger: Logger;
  startedAt: number;
  auth: GoogleAuth;
  notifications: TurnNotifications;
}

export function createHttpApp(deps: HttpAppDeps): Express {
  const { config, hub, store, logger } = deps;
  const app = express();

  app.disable('x-powered-by');
  app.use(cors());
  app.use(express.json({ limit: '32kb' }));

  // Require same-origin JSON writes; browsers cannot submit these via cross-site forms.
  app.use(['/auth', '/api/auth', '/api/notifications'], (req, res, next) => {
    if (req.method === 'POST' && (!req.is('application/json') ||
        (req.get('origin') && req.get('origin') !== (config.publicOrigin ?? `${req.protocol}://${req.get('host')}`)))) {
      res.status(403).json({ message: 'Please use the account form on this site.' });
      return;
    }
    next();
  });
  app.post('/auth/register', (req, res) => { void deps.auth.passwordLogin(req, res, true); });
  app.post('/auth/login', (req, res) => { void deps.auth.passwordLogin(req, res, false); });
  app.post('/api/auth/link-games', (req, res) => {
    const accountId = deps.auth.accountIdForRequest(req);
    if (!accountId) { res.status(401).json({ message: 'Sign in first.' }); return; }
    const tokens: unknown = req.body?.tokens;
    if (!Array.isArray(tokens) || tokens.length > 100 || tokens.some(t => typeof t !== 'string' || t.length > 256)) {
      res.status(400).json({ message: 'Invalid local games.' }); return;
    }
    const linked = tokens.filter(token => deps.hub.claimLegacySession(token, accountId) ||
      deps.store.loadSessions().some(session => session.token === token && session.accountId === accountId));
    res.json({ linked });
  });

  app.use('/api/notifications', (_req, res) => { res.status(410).json({ message: 'Turn alerts have been removed.' }); });

  app.get('/api/notifications/config', (_req, res) => {
    res.json(deps.notifications.publicConfig());
  });

  app.post('/api/notifications/settings', (req, res) => {
    const accountId = deps.auth.accountIdForRequest(req);
    const sessionToken = typeof req.body?.sessionToken === 'string' ? req.body.sessionToken : null;
    try {
      res.json(deps.notifications.settings(accountId, sessionToken));
    } catch (error) {
      res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to load alert settings.' });
    }
  });

  app.post('/api/notifications/push/subscribe', (req, res) => {
    if (!deps.notifications.publicConfig().pushEnabled) {
      res.status(503).json({ message: 'Browser push is not configured on this server.' });
      return;
    }
    const accountId = deps.auth.accountIdForRequest(req);
    const sessionToken = typeof req.body?.sessionToken === 'string' ? req.body.sessionToken : null;
    try {
      deps.notifications.savePushSubscription(accountId, sessionToken, req.body?.subscription);
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to enable browser alerts.' });
    }
  });

  app.post('/api/notifications/push/unsubscribe', (req, res) => {
    const accountId = deps.auth.accountIdForRequest(req);
    const sessionToken = typeof req.body?.sessionToken === 'string' ? req.body.sessionToken : null;
    try {
      deps.notifications.removePushSubscription(accountId, sessionToken, req.body?.endpoint);
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to disable browser alerts.' });
    }
  });

  app.post('/api/notifications/email', async (req, res) => {
    const accountId = deps.auth.accountIdForRequest(req);
    if (!accountId) { res.status(401).json({ message: 'Sign in to manage email alerts.' }); return; }
    if (req.body?.enabled === true && !deps.notifications.publicConfig().emailEnabled) {
      res.status(503).json({ message: 'Email alerts are not configured on this server.' });
      return;
    }
    try {
      const result = await deps.notifications.updateEmailAlerts(accountId, req.body?.email, req.body?.enabled);
      res.json({ ok: true, ...result });
    } catch (error) {
      res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to update email alerts.' });
    }
  });

  app.post('/api/notifications/email/verify', (req, res) => {
    const accountId = deps.auth.accountIdForRequest(req);
    if (!accountId) { res.status(401).json({ message: 'Sign in to verify your email.' }); return; }
    try {
      deps.notifications.verifyEmail(accountId, req.body?.code);
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to verify that email.' });
    }
  });

  app.get('/auth/google/start', (req: Request, res: Response) => {
    deps.auth.start(req, res);
  });

  app.get('/auth/google/callback', (req: Request, res: Response) => {
    void deps.auth.callback(req, res);
  });

  app.post('/auth/logout', (req: Request, res: Response) => {
    deps.auth.logout(req, res);
  });

  app.get('/api/auth/me', (req: Request, res: Response) => {
    const status = deps.auth.status(req);
    const accountId = status.account?.id;
    res.json({
      ...status,
      games: accountId ? hub.gamesForAccount(accountId) : [],
    });
  });

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
