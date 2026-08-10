/**
 * The hub owns every table on this server and routes client messages to them.
 *
 * On boot it rehydrates itself completely from the store — rooms, seats, game
 * states, chat and session tokens — so a restart is invisible to players
 * beyond a dropped socket. Nothing in here holds game-rules knowledge; it is
 * pure routing, identity and lifecycle.
 *
 * The one game-shaped thing it does is resolve a table's `gameKey` to a plugin
 * and hand that plugin to the room. Join codes are unique across every title,
 * so a player only ever needs the code — never the game's name as well.
 */

import { randomBytes, randomUUID } from 'node:crypto';
import {
  makeGameCode,
  type ClientMessage,
  type GameKey,
  type GameRegistry,
  type PlayerId,
} from '@tt/core';
import type { ServerConfig } from './config.js';
import type { Logger } from './logger.js';
import type { GameStore, PersistedGame, SessionRecord } from './persistence/types.js';
import { GameRoom } from './room.js';
import type { Connection } from './wire.js';

export interface HubDeps {
  store: GameStore;
  registry: GameRegistry;
  config: ServerConfig;
  logger: Logger;
}

const seatKey = (gameId: string, playerId: PlayerId): string => `${gameId}:${playerId}`;

export class GameHub {
  private readonly rooms = new Map<string, GameRoom>();
  private readonly roomsByCode = new Map<string, string>();
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly tokenBySeat = new Map<string, string>();
  private readonly logger: Logger;

  constructor(private readonly deps: HubDeps) {
    this.logger = deps.logger.child('hub');
  }

  get registry(): GameRegistry {
    return this.deps.registry;
  }

  /**
   * Builds a live room around a persisted record, binding it to the plugin
   * named by `record.gameKey`.
   *
   * Returns null for a game this build does not host — a table written by a
   * deployment with an extra title, or one whose game has since been removed.
   * Such a record is deliberately left untouched on disk rather than deleted,
   * so re-adding the game brings the table back with its state intact.
   */
  private buildRoom(record: PersistedGame): GameRoom | null {
    const plugin = this.deps.registry.get(record.gameKey);
    if (!plugin) {
      this.logger.warn('Skipping a game this server does not host', {
        gameId: record.gameId,
        code: record.code,
        gameKey: record.gameKey,
      });
      return null;
    }
    return new GameRoom({ ...this.deps, plugin, logger: this.logger.child(record.code) }, record);
  }

  /* ---------------------------------------------------------------- *
   * Boot
   * ---------------------------------------------------------------- */

  /** Rebuilds every room from disk. Call once, before accepting sockets. */
  load(): void {
    const cutoff = Date.now() - this.deps.config.gameTtlMs;
    let pruned = 0;
    let skipped = 0;

    for (const record of this.deps.store.loadGames()) {
      if (record.updatedAt < cutoff) {
        this.deps.store.deleteGame(record.gameId);
        pruned += 1;
        continue;
      }
      // A duplicate code on disk (should be impossible — the column is UNIQUE)
      // would make one of the two games unreachable; drop the stale one.
      if (this.roomsByCode.has(record.code)) {
        this.logger.warn('Duplicate join code on disk; dropping the older game', {
          code: record.code,
          gameId: record.gameId,
        });
        this.deps.store.deleteGame(record.gameId);
        continue;
      }
      const room = this.buildRoom(record);
      if (!room) {
        skipped += 1;
        continue;
      }
      /*
       * Nobody is connected immediately after a restart. The room folds that
       * into the game state through the plugin's presence hook the first time
       * it broadcasts, so the server never has to touch a player record.
       */
      this.rooms.set(room.gameId, room);
      this.roomsByCode.set(room.code, room.gameId);
    }

    for (const session of this.deps.store.loadSessions()) {
      if (!this.rooms.has(session.gameId)) continue;
      this.sessions.set(session.token, session);
      this.tokenBySeat.set(seatKey(session.gameId, session.playerId), session.token);
    }

    this.logger.info('Restored games from persistent store', {
      games: this.rooms.size,
      sessions: this.sessions.size,
      pruned,
      skipped,
      backend: this.deps.store.kind,
    });

    // Bot seats may already be on the clock in a restored game.
    for (const room of this.rooms.values()) room.rescheduleAutoAction();
  }

  /* ---------------------------------------------------------------- *
   * Accessors
   * ---------------------------------------------------------------- */

  get roomCount(): number {
    return this.rooms.size;
  }

  roomByCode(code: string): GameRoom | undefined {
    const gameId = this.roomsByCode.get(code.toUpperCase());
    return gameId ? this.rooms.get(gameId) : undefined;
  }

  roomById(gameId: string): GameRoom | undefined {
    return this.rooms.get(gameId);
  }

  stats(): {
    games: number;
    started: number;
    seats: number;
    sessions: number;
    byGame: Record<GameKey, number>;
  } {
    let started = 0;
    let seats = 0;
    const byGame: Record<GameKey, number> = {};
    for (const room of this.rooms.values()) {
      if (room.started) started += 1;
      seats += room.seats.length;
      byGame[room.gameKey] = (byGame[room.gameKey] ?? 0) + 1;
    }
    return { games: this.rooms.size, started, seats, sessions: this.sessions.size, byGame };
  }

  /* ---------------------------------------------------------------- *
   * Codes and sessions
   * ---------------------------------------------------------------- */

  /**
   * Mints a join code that no live game is using — across every title, so a
   * player never has to say which game their code is for. `makeGameCode`
   * already avoids ambiguous glyphs (no O/0/I/1); this adds the uniqueness
   * guarantee and, as a last resort, widens the code so we can never fail to
   * create a game.
   */
  private mintCode(): string {
    for (let i = 0; i < 200; i++) {
      const code = makeGameCode();
      if (!this.roomsByCode.has(code)) return code;
    }
    for (let i = 0; i < 200; i++) {
      const code = `${makeGameCode()}${makeGameCode().slice(0, 2)}`;
      if (!this.roomsByCode.has(code)) return code;
    }
    throw new Error('Unable to mint a unique join code');
  }

  /** One opaque bearer token per seat. Reused if the seat already has one. */
  private issueSession(gameId: string, playerId: PlayerId): SessionRecord {
    const existing = this.tokenBySeat.get(seatKey(gameId, playerId));
    if (existing) {
      const session = this.sessions.get(existing);
      if (session) {
        session.lastSeen = Date.now();
        this.deps.store.saveSession(session);
        return session;
      }
    }
    const session: SessionRecord = {
      token: randomBytes(24).toString('base64url'),
      gameId,
      playerId,
      createdAt: Date.now(),
      lastSeen: Date.now(),
    };
    this.sessions.set(session.token, session);
    this.tokenBySeat.set(seatKey(gameId, playerId), session.token);
    this.deps.store.saveSession(session);
    return session;
  }

  private dropSession(gameId: string, playerId: PlayerId): void {
    const key = seatKey(gameId, playerId);
    const token = this.tokenBySeat.get(key);
    if (token) {
      this.sessions.delete(token);
      this.tokenBySeat.delete(key);
    }
  }

  /* ---------------------------------------------------------------- *
   * Message dispatch
   * ---------------------------------------------------------------- */

  handleMessage(conn: Connection, message: ClientMessage): void {
    switch (message.t) {
      case 'ping':
        conn.send({ t: 'pong' });
        return;
      case 'hello':
        this.onHello(conn, message.sessionToken);
        return;
      case 'rejoin':
        this.onRejoin(conn, message.sessionToken);
        return;
      case 'createGame':
        this.onCreateGame(conn, message.gameKey, message.name, message.settings);
        return;
      case 'joinGame':
        this.onJoinGame(conn, message.code, message.name);
        return;
      case 'leaveGame':
        this.onLeaveGame(conn);
        return;
      default:
        this.onSeatedMessage(conn, message);
    }
  }

  /** Every message below this point requires an authenticated seat. */
  private onSeatedMessage(conn: Connection, message: ClientMessage): void {
    const bound = this.boundRoom(conn);
    if (!bound) {
      conn.error('notInGame', 'Join or create a game first.');
      return;
    }
    const { room, playerId } = bound;

    switch (message.t) {
      case 'setReady':
        this.applyLobbyChange(conn, room, room.setReady(playerId, message.ready));
        return;
      case 'setColor':
        this.applyLobbyChange(conn, room, room.setColor(playerId, message.color));
        return;
      case 'setName':
        this.applyLobbyChange(conn, room, room.setName(playerId, message.name));
        return;
      case 'updateSettings':
        this.applyLobbyChange(conn, room, room.updateSettings(playerId, message.settings));
        return;
      case 'addBot':
        this.applyLobbyChange(conn, room, room.addBot(playerId));
        return;
      case 'removePlayer': {
        const target = message.playerId;
        const result = room.removePlayer(playerId, target);
        if (result.ok) this.dropSession(room.gameId, target);
        this.applyLobbyChange(conn, room, result);
        return;
      }
      case 'startGame': {
        const result = room.start(playerId);
        if (!result.ok) {
          conn.error(result.code, result.message);
          return;
        }
        room.persist();
        room.broadcast();
        room.rescheduleAutoAction();
        return;
      }
      case 'action': {
        const result = room.applyPlayerAction(playerId, message.action);
        if (!result.ok) {
          conn.send({
            t: 'actionRejected',
            ...(message.nonce !== undefined ? { nonce: message.nonce } : {}),
            reason: result.message,
          });
          this.logger.debug('Action rejected', {
            gameId: room.gameId,
            gameKey: room.gameKey,
            playerId,
            reason: result.message,
          });
          return;
        }
        room.persist();
        room.broadcastState();
        room.rescheduleAutoAction();
        return;
      }
      case 'chat':
        room.postChat(playerId, message.text);
        room.persist();
        return;
      default:
        conn.error('unknownMessage', 'Unsupported message for a seated player.');
    }
  }

  private applyLobbyChange(
    conn: Connection,
    room: GameRoom,
    result: { ok: boolean; code?: string; message?: string },
  ): void {
    if (!result.ok) {
      conn.error(result.code ?? 'rejected', result.message ?? 'Rejected.');
      return;
    }
    room.persist();
    room.broadcast();
  }

  private boundRoom(conn: Connection): { room: GameRoom; playerId: PlayerId } | null {
    if (!conn.gameId || !conn.playerId) return null;
    const room = this.rooms.get(conn.gameId);
    if (!room) return null;
    if (!room.seat(conn.playerId)) return null;
    return { room, playerId: conn.playerId };
  }

  /* ---------------------------------------------------------------- *
   * Handshakes
   * ---------------------------------------------------------------- */

  private onHello(conn: Connection, token?: string): void {
    if (token && this.resume(conn, token)) return;
    // No usable session: the client should show the game picker.
    conn.error('noSession', 'No active session. Create or join a game.');
  }

  private onRejoin(conn: Connection, token: string): void {
    if (this.resume(conn, token)) return;
    conn.error('unknownSession', 'That session is no longer valid. Join the game again by code.');
  }

  /**
   * Re-attaches a socket to an existing seat and replays the full current
   * state — lobby or mid-game, including when it is that player's turn.
   */
  private resume(conn: Connection, token: string): boolean {
    const session = this.sessions.get(token);
    if (!session) return false;
    const room = this.rooms.get(session.gameId);
    if (!room) {
      this.sessions.delete(token);
      return false;
    }
    const seat = room.seat(session.playerId);
    if (!seat) {
      this.sessions.delete(token);
      this.tokenBySeat.delete(seatKey(session.gameId, session.playerId));
      return false;
    }

    session.lastSeen = Date.now();
    this.deps.store.saveSession(session);
    conn.sessionToken = token;
    room.attach(session.playerId, conn);

    conn.send({
      t: 'welcome',
      sessionToken: token,
      playerId: session.playerId,
      gameKey: room.gameKey,
    });
    room.sendSnapshot(session.playerId, conn);
    // Everyone else needs to see them light up again.
    room.broadcast();
    room.persist();

    this.logger.info('Player resumed', {
      gameId: room.gameId,
      gameKey: room.gameKey,
      code: room.code,
      playerId: session.playerId,
      name: seat.name,
      started: room.started,
    });
    return true;
  }

  private onCreateGame(
    conn: Connection,
    gameKey: GameKey,
    name: string,
    rawSettings: unknown,
  ): void {
    const plugin = this.deps.registry.get(gameKey);
    if (!plugin) {
      conn.error('noSuchGame', `This server does not host '${gameKey}'.`);
      return;
    }

    /*
     * Settings arrive as an untrusted patch over the game's own defaults, so a
     * client that sends nothing gets a playable table and a client that sends
     * junk gets rejected here rather than at start time.
     */
    const patch = plugin.parseSettingsPatch(rawSettings);
    if (!patch) {
      conn.error('badSettings', 'Those settings are not valid for this game.');
      return;
    }
    const settings = { ...(plugin.defaultSettings() as object), ...(patch as object) };

    // A socket can only be at one table; creating implies leaving.
    this.detachFromCurrentRoom(conn, 'switched tables');

    let code: string;
    try {
      code = this.mintCode();
    } catch (err) {
      this.logger.error('Join-code exhaustion', {
        error: err instanceof Error ? err.message : String(err),
      });
      conn.error('codeExhausted', 'The server could not allocate a join code. Try again.');
      return;
    }

    const now = Date.now();
    const gameId = randomUUID();
    const hostId = randomUUID();

    const record: PersistedGame = {
      gameId,
      gameKey,
      code,
      hostId,
      settings,
      seats: [],
      state: null,
      started: false,
      chat: [],
      createdAt: now,
      updatedAt: now,
    };

    const room = this.buildRoom(record);
    if (!room) {
      conn.error('noSuchGame', `This server does not host '${gameKey}'.`);
      return;
    }
    const seat = room.addSeat({ playerId: hostId, name, isBot: false, ready: true });
    if (!seat) {
      conn.error('noColors', 'Could not seat the host.');
      return;
    }

    this.rooms.set(gameId, room);
    this.roomsByCode.set(code, gameId);
    room.persist();

    const session = this.issueSession(gameId, hostId);
    conn.sessionToken = session.token;
    room.attach(hostId, conn);
    conn.send({ t: 'welcome', sessionToken: session.token, playerId: hostId, gameKey });
    room.sendSnapshot(hostId, conn);

    this.logger.info('Game created', { gameId, gameKey, code, host: name });
  }

  private onJoinGame(conn: Connection, code: string, name: string): void {
    const room = this.roomByCode(code);
    if (!room) {
      conn.error('noSuchGame', `No game found with code ${code}.`);
      return;
    }
    if (room.started) {
      // A started game accepts reconnections by token, never brand-new joiners.
      conn.error('gameStarted', 'That game has already started. Rejoin with your session link instead.');
      return;
    }
    if (room.seats.length >= room.capacity) {
      conn.error('gameFull', 'That game is full.');
      return;
    }

    this.detachFromCurrentRoom(conn, 'switched tables');

    const playerId = randomUUID();
    const seat = room.addSeat({ playerId, name, isBot: false, ready: false });
    if (!seat) {
      conn.error('noColors', 'No colours left at that table.');
      return;
    }

    const session = this.issueSession(room.gameId, playerId);
    conn.sessionToken = session.token;
    room.persist();
    room.attach(playerId, conn);
    conn.send({
      t: 'welcome',
      sessionToken: session.token,
      playerId,
      gameKey: room.gameKey,
    });
    room.sendSnapshot(playerId, conn);
    room.broadcast();

    this.logger.info('Player joined', {
      gameId: room.gameId,
      gameKey: room.gameKey,
      code: room.code,
      name,
      playerId,
    });
  }

  /**
   * Explicit "leave". In a lobby the seat is released; in a live game the seat
   * is *kept* and the player simply goes offline.
   */
  private onLeaveGame(conn: Connection): void {
    const bound = this.boundRoom(conn);
    if (!bound) return;
    const { room, playerId } = bound;

    room.detach(playerId, conn);
    conn.playerId = null;
    conn.gameId = null;
    conn.sessionToken = null;

    if (!room.started) {
      room.seats = room.seats.filter((s) => s.playerId !== playerId);
      this.dropSession(room.gameId, playerId);
      room.promoteHostIfNeeded(playerId);
      if (room.humanSeats.length === 0) {
        this.destroyRoom(room, 'last player left the lobby');
        return;
      }
    } else {
      room.promoteHostIfNeeded(playerId);
    }

    room.persist();
    room.broadcast();
    room.rescheduleAutoAction();
  }

  /** Called when a socket dies for any reason. Seats and host ownership survive. */
  handleDisconnect(conn: Connection): void {
    const bound = this.boundRoom(conn);
    if (!bound) return;
    const { room, playerId } = bound;
    if (!room.detach(playerId, conn)) return;

    this.logger.info('Player disconnected', {
      gameId: room.gameId,
      gameKey: room.gameKey,
      code: room.code,
      playerId,
      started: room.started,
    });

    room.persist();
    room.broadcast();
    if (room.started) room.rescheduleAutoAction();
  }

  private detachFromCurrentRoom(conn: Connection, reason: string): void {
    const bound = this.boundRoom(conn);
    if (!bound) return;
    this.logger.debug('Detaching socket from previous room', { reason, gameId: bound.room.gameId });
    bound.room.detach(bound.playerId, conn);
    bound.room.broadcast();
    conn.playerId = null;
    conn.gameId = null;
    conn.sessionToken = null;
  }

  private destroyRoom(room: GameRoom, reason: string): void {
    this.rooms.delete(room.gameId);
    this.roomsByCode.delete(room.code);
    for (const seat of room.seats) this.dropSession(room.gameId, seat.playerId);
    room.dispose(1000, reason);
    this.deps.store.deleteGame(room.gameId);
    this.logger.info('Game removed', { gameId: room.gameId, code: room.code, reason });
  }

  /** Closes every socket and stops every timer. Data on disk is untouched. */
  shutdown(): void {
    for (const room of this.rooms.values()) room.dispose();
    this.rooms.clear();
    this.roomsByCode.clear();
  }
}
