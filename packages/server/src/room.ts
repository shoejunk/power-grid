/**
 * A single table: its lobby, its authoritative `GameState`, the sockets
 * currently watching it, and the timers that keep it moving.
 *
 * Design rules this file enforces:
 *
 *  - The server is the only authority (requirement 6). Client input is a
 *    *request*; the rules engine decides, the room applies and rebroadcasts.
 *  - A seat is permanent (requirement 5). Sockets come and go; money, plants,
 *    houses and turn position never do. Leaving an in-progress game marks you
 *    disconnected, it does not delete you.
 *  - Every mutation is persisted before it is broadcast (requirement 4), so a
 *    client can never observe a state the disk has not seen.
 */

import {
  PLAYER_COLORS,
  type GameAction,
  type GameSettings,
  type GameState,
  type LobbyState,
  type PlayerColor,
  type PlayerId,
  type ServerMessage,
} from '@pg/shared';
import type { ServerConfig } from './config.js';
import type { RulesEngine } from './engine/types.js';
import type { Logger } from './logger.js';
import type { ChatEntry, GameStore, PersistedGame, Seat } from './persistence/types.js';
import type { Connection } from './wire.js';
import { CLOSE } from './wire.js';

/** Placeholder id substituted for face-down plant cards before broadcast. */
export const HIDDEN_PLANT_ID = -1;

/** The `chat` variant of `ServerMessage`, named for readability. */
type ChatMessageOut = Extract<ServerMessage, { t: 'chat' }>;

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;

/**
 * Pass-like moves tried, in order, when a disconnected player's turn timer
 * fires and the engine offers no `defaultActionFor`. The engine still decides
 * which (if any) is legal — the server only proposes.
 */
const SAFE_DEFAULT_CANDIDATES: readonly GameAction[] = [
  { type: 'passBid' },
  { type: 'passNomination' },
  { type: 'passResources' },
  { type: 'passBuilding' },
  { type: 'powerCities', decision: { operatePlantIds: [], citiesSupplied: 0 } },
];

export interface RoomDeps {
  store: GameStore;
  engine: RulesEngine;
  config: ServerConfig;
  logger: Logger;
}

export type RoomResult = { ok: true } | { ok: false; code: string; message: string };

const fail = (code: string, message: string): RoomResult => ({ ok: false, code, message });
const done: RoomResult = { ok: true };

export class GameRoom {
  readonly gameId: string;
  code: string;
  hostId: PlayerId;
  settings: GameSettings;
  seats: Seat[];
  state: GameState | null;
  started: boolean;
  chat: ChatEntry[];
  readonly createdAt: number;
  updatedAt: number;

  /** Live sockets, keyed by seat. Never persisted. */
  private readonly sockets = new Map<PlayerId, Connection>();
  private turnTimer: NodeJS.Timeout | null = null;
  private disposed = false;

  constructor(
    private readonly deps: RoomDeps,
    record: PersistedGame,
  ) {
    this.gameId = record.gameId;
    this.code = record.code;
    this.hostId = record.hostId;
    this.settings = record.settings;
    this.seats = record.seats;
    this.state = record.state;
    this.started = record.started;
    this.chat = record.chat;
    this.createdAt = record.createdAt;
    this.updatedAt = record.updatedAt;
  }

  /* ---------------------------------------------------------------- *
   * Seats
   * ---------------------------------------------------------------- */

  seat(playerId: PlayerId): Seat | undefined {
    return this.seats.find((s) => s.playerId === playerId);
  }

  /** Bots count as permanently present; humans depend on a live socket. */
  isConnected(playerId: PlayerId): boolean {
    const seat = this.seat(playerId);
    if (!seat) return false;
    if (seat.isBot) return true;
    return this.sockets.has(playerId);
  }

  get humanSeats(): Seat[] {
    return this.seats.filter((s) => !s.isBot);
  }

  get isEmpty(): boolean {
    return this.seats.length === 0;
  }

  /** First colour nobody has taken. Guarantees requirement 3's no-duplicates. */
  private freeColor(exclude?: PlayerId): PlayerColor | null {
    const taken = new Set(this.seats.filter((s) => s.playerId !== exclude).map((s) => s.color));
    return PLAYER_COLORS.find((c) => !taken.has(c)) ?? null;
  }

  addSeat(opts: { playerId: PlayerId; name: string; isBot: boolean; ready?: boolean }): Seat | null {
    const color = this.freeColor();
    if (!color) return null;
    const seat: Seat = {
      playerId: opts.playerId,
      name: opts.name,
      color,
      isBot: opts.isBot,
      ready: opts.ready ?? false,
      joinedAt: Date.now(),
    };
    this.seats.push(seat);
    return seat;
  }

  /* ---------------------------------------------------------------- *
   * Socket attachment
   * ---------------------------------------------------------------- */

  /**
   * Binds a socket to a seat. Any previous socket for the same seat is closed
   * first — a second tab takes over rather than fighting for the seat.
   */
  attach(playerId: PlayerId, conn: Connection): void {
    const existing = this.sockets.get(playerId);
    if (existing && existing !== conn) {
      this.deps.logger.debug('Replacing socket for seat', { gameId: this.gameId, playerId });
      existing.playerId = null; // stop its close handler from marking us offline
      existing.close(CLOSE.REPLACED, 'replaced by a newer connection');
    }
    this.sockets.set(playerId, conn);
    conn.playerId = playerId;
    conn.gameId = this.gameId;
    this.syncConnectionFlags();
    this.rescheduleAutoAction();
  }

  /** Socket closed. The seat stays; only presence changes. Requirement 5. */
  detach(playerId: PlayerId, conn: Connection): boolean {
    const current = this.sockets.get(playerId);
    if (current !== conn) return false;
    this.sockets.delete(playerId);
    this.syncConnectionFlags();
    this.rescheduleAutoAction();
    return true;
  }

  /** Mirrors live presence into `GameState.players` so clients can render it. */
  private syncConnectionFlags(): void {
    if (!this.state) return;
    const now = Date.now();
    for (const seat of this.seats) {
      const p = this.state.players[seat.playerId];
      if (!p) continue;
      const connected = this.isConnected(seat.playerId);
      p.connected = connected;
      if (connected) p.lastSeen = now;
    }
  }

  /* ---------------------------------------------------------------- *
   * Views
   * ---------------------------------------------------------------- */

  toLobbyState(): LobbyState {
    return {
      code: this.code,
      gameId: this.gameId,
      hostId: this.hostId,
      settings: this.settings,
      players: this.seats.map((s) => ({
        id: s.playerId,
        name: s.name,
        color: s.color,
        isHost: s.playerId === this.hostId,
        isBot: s.isBot,
        ready: s.ready,
        connected: this.isConnected(s.playerId),
      })),
      started: this.started,
    };
  }

  /**
   * Per-player view of the authoritative state.
   *
   * The only genuinely hidden information in the current model is the
   * face-down plant supply stack (§1/§2: cards are drawn blind, and setup
   * removals are never looked at). Its *length* is public — players can see
   * how thick the deck is — so we preserve the length and blank the ids.
   */
  stateFor(_playerId: PlayerId): GameState | null {
    if (!this.state) return null;
    const view = structuredClone(this.state);
    view.plantMarket.stack = view.plantMarket.stack.map(() => HIDDEN_PLANT_ID);
    return view;
  }

  /* ---------------------------------------------------------------- *
   * Broadcasting
   * ---------------------------------------------------------------- */

  private sockets_(): Iterable<[PlayerId, Connection]> {
    return this.sockets.entries();
  }

  broadcastLobby(): void {
    const lobby = this.toLobbyState();
    for (const [, conn] of this.sockets_()) conn.send({ t: 'lobby', lobby });
  }

  broadcastState(): void {
    if (!this.state) return;
    this.syncConnectionFlags();
    for (const [playerId, conn] of this.sockets_()) {
      const view = this.stateFor(playerId);
      if (view) conn.send({ t: 'state', state: view });
    }
  }

  /** Sends whichever view is appropriate for the room's current stage. */
  sendSnapshot(playerId: PlayerId, conn: Connection): void {
    conn.send({ t: 'lobby', lobby: this.toLobbyState() });
    if (this.started && this.state) {
      const view = this.stateFor(playerId);
      if (view) conn.send({ t: 'state', state: view });
    }
    for (const entry of this.chat.slice(-25)) {
      conn.send({ t: 'chat', from: entry.from, name: entry.name, text: entry.text, at: entry.at });
    }
  }

  /** Broadcast whichever view changed, after a mutation. */
  broadcast(): void {
    this.broadcastLobby();
    if (this.started) this.broadcastState();
  }

  /* ---------------------------------------------------------------- *
   * Persistence
   * ---------------------------------------------------------------- */

  toRecord(): PersistedGame {
    return {
      gameId: this.gameId,
      code: this.code,
      hostId: this.hostId,
      settings: this.settings,
      seats: this.seats,
      state: this.state,
      started: this.started,
      chat: this.chat,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  /** Stamps `updatedAt` and writes the whole record. Synchronous by design. */
  persist(): void {
    if (this.disposed) return;
    this.updatedAt = Date.now();
    try {
      this.deps.store.saveGame(this.toRecord());
    } catch (err) {
      this.deps.logger.error('Failed to persist game', {
        gameId: this.gameId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /* ---------------------------------------------------------------- *
   * Lobby mutations
   * ---------------------------------------------------------------- */

  setReady(playerId: PlayerId, ready: boolean): RoomResult {
    if (this.started) return fail('gameStarted', 'The game has already started.');
    const seat = this.seat(playerId);
    if (!seat) return fail('notInGame', 'You are not seated at this table.');
    seat.ready = ready;
    return done;
  }

  setName(playerId: PlayerId, name: string): RoomResult {
    const seat = this.seat(playerId);
    if (!seat) return fail('notInGame', 'You are not seated at this table.');
    seat.name = name;
    const p = this.state?.players[playerId];
    if (p) p.name = name;
    return done;
  }

  setColor(playerId: PlayerId, color: PlayerColor): RoomResult {
    if (this.started) return fail('gameStarted', 'Colours are locked once the game starts.');
    const seat = this.seat(playerId);
    if (!seat) return fail('notInGame', 'You are not seated at this table.');
    const clash = this.seats.find((s) => s.playerId !== playerId && s.color === color);
    if (clash) return fail('colorTaken', `${clash.name} already has that colour.`);
    seat.color = color;
    return done;
  }

  updateSettings(playerId: PlayerId, patch: Partial<GameSettings>): RoomResult {
    if (playerId !== this.hostId) return fail('notHost', 'Only the host can change settings.');
    if (this.started) return fail('gameStarted', 'Settings are locked once the game starts.');

    const next: GameSettings = { ...this.settings, ...patch };
    if (next.playerCount < MIN_PLAYERS || next.playerCount > MAX_PLAYERS) {
      return fail('badSettings', `Player count must be between ${MIN_PLAYERS} and ${MAX_PLAYERS}.`);
    }
    if (next.playerCount < this.seats.length) {
      return fail('badSettings', 'Remove players before lowering the player count.');
    }
    if (next.againstTheTrust && next.playerCount !== 2) {
      return fail('badSettings', 'Against the Trust is a two-player variant. §13');
    }
    this.settings = next;
    return done;
  }

  addBot(playerId: PlayerId): RoomResult {
    if (playerId !== this.hostId) return fail('notHost', 'Only the host can add bots.');
    if (this.started) return fail('gameStarted', 'The game has already started.');
    if (this.seats.length >= this.settings.playerCount) return fail('gameFull', 'The table is full.');
    const index = this.seats.filter((s) => s.isBot).length + 1;
    const seat = this.addSeat({
      playerId: `bot-${this.gameId.slice(0, 8)}-${Date.now().toString(36)}-${index}`,
      name: `Bot ${index}`,
      isBot: true,
      ready: true,
    });
    if (!seat) return fail('noColors', 'No colours left.');
    return done;
  }

  /**
   * Host kicks a player (or removes a bot). In an in-progress game a human
   * seat is never removed — that would destroy their position — so this is
   * lobby-only for humans.
   */
  removePlayer(actorId: PlayerId, targetId: PlayerId): RoomResult {
    if (actorId !== this.hostId) return fail('notHost', 'Only the host can remove players.');
    const seat = this.seat(targetId);
    if (!seat) return fail('noSuchPlayer', 'That player is not at this table.');
    if (targetId === this.hostId) return fail('cannotKickHost', 'The host cannot kick themselves.');
    if (this.started && !seat.isBot) {
      return fail('gameStarted', 'Players cannot be removed from a game in progress.');
    }
    this.seats = this.seats.filter((s) => s.playerId !== targetId);
    const conn = this.sockets.get(targetId);
    if (conn) {
      conn.send({ t: 'error', code: 'kicked', message: 'The host removed you from the game.' });
      conn.playerId = null;
      conn.gameId = null;
      this.sockets.delete(targetId);
      conn.close(1000, 'kicked');
    }
    return done;
  }

  /**
   * Starts the game. Requires: enough seats, every human other than the host
   * ready (the host consents by pressing start), and a coherent variant.
   */
  start(playerId: PlayerId): RoomResult {
    if (playerId !== this.hostId) return fail('notHost', 'Only the host can start the game.');
    if (this.started) return fail('gameStarted', 'The game has already started.');
    if (this.seats.length < MIN_PLAYERS) return fail('notEnoughPlayers', 'At least 2 players are required.');
    if (this.seats.length > MAX_PLAYERS) return fail('tooManyPlayers', 'At most 6 players are supported.');
    if (this.settings.againstTheTrust && this.seats.length !== 2) {
      return fail('badSettings', 'Against the Trust requires exactly two players. §13');
    }
    const notReady = this.seats.find((s) => !s.isBot && s.playerId !== this.hostId && !s.ready);
    if (notReady) return fail('notReady', `${notReady.name} is not ready.`);

    // The lobby is the source of truth for who is actually playing.
    this.settings = { ...this.settings, playerCount: this.seats.length };
    if (!this.settings.seed) this.settings.seed = `${this.code}-${this.createdAt}`;

    let state: GameState;
    try {
      state = this.deps.engine.createGame(
        this.settings,
        this.seats.map((s) => ({ id: s.playerId, name: s.name, color: s.color, isBot: s.isBot })),
        this.hostId,
        this.code,
      );
    } catch (err) {
      this.deps.logger.error('Engine failed to create game', {
        gameId: this.gameId,
        error: err instanceof Error ? err.message : String(err),
      });
      return fail('engineError', 'The rules engine could not set up this game.');
    }

    // The engine may mint its own ids; the server's identity always wins so
    // that persistence keys and join codes stay stable across restarts.
    state.gameId = this.gameId;
    state.code = this.code;
    state.hostId = this.hostId;
    this.state = state;
    this.started = true;
    this.syncConnectionFlags();
    this.deps.logger.info('Game started', {
      gameId: this.gameId,
      code: this.code,
      players: this.seats.length,
      map: this.settings.mapId,
    });
    return done;
  }

  /* ---------------------------------------------------------------- *
   * Host promotion (requirement 9)
   * ---------------------------------------------------------------- */

  /**
   * Promotes the longest-seated connected player when the host goes away.
   * Falls back to the longest-seated player of any presence, so a table is
   * never left host-less after a restart.
   */
  promoteHostIfNeeded(departingId: PlayerId, requireConnectedCandidate = false): PlayerId | null {
    if (this.hostId !== departingId) return null;
    const candidates = this.seats.filter((s) => s.playerId !== departingId && !s.isBot);
    if (candidates.length === 0) return null;
    const bySeniority = [...candidates].sort((a, b) => a.joinedAt - b.joinedAt);
    const connected = bySeniority.find((s) => this.isConnected(s.playerId));
    // On a plain disconnect we only hand the crown to someone who is actually
    // present; a lone host who reloads the page keeps their table.
    const chosen = requireConnectedCandidate ? connected : (connected ?? bySeniority[0]);
    if (!chosen) return null;
    this.hostId = chosen.playerId;
    if (this.state) this.state.hostId = chosen.playerId;
    this.deps.logger.info('Host promoted', {
      gameId: this.gameId,
      from: departingId,
      to: chosen.playerId,
      name: chosen.name,
    });
    return chosen.playerId;
  }

  /* ---------------------------------------------------------------- *
   * Actions (requirement 6)
   * ---------------------------------------------------------------- */

  /**
   * Validates and applies a player action. The three gates — membership,
   * turn ownership, engine validation — are all server-side; the client's
   * opinion is never consulted.
   */
  applyPlayerAction(playerId: PlayerId, action: GameAction): RoomResult {
    if (!this.started || !this.state) {
      return fail('gameNotStarted', 'The game has not started yet.');
    }
    if (!this.seat(playerId)) {
      return fail('notInGame', 'You are not seated at this table.');
    }
    if (this.state.phase === 'gameOver') {
      return fail('gameOver', 'The game is over.');
    }
    if (this.state.activePlayerId !== playerId) {
      return fail('notYourTurn', 'It is not your turn.');
    }

    const verdict = this.deps.engine.validateAction(this.state, playerId, action);
    if (!verdict.ok) return fail('illegalAction', verdict.reason);

    let next: GameState;
    try {
      next = this.deps.engine.applyAction(this.state, playerId, action);
    } catch (err) {
      this.deps.logger.error('Engine threw while applying an action', {
        gameId: this.gameId,
        playerId,
        action: action.type,
        error: err instanceof Error ? err.message : String(err),
      });
      return fail('engineError', 'The rules engine rejected that action.');
    }

    // Identity is the server's, always.
    next.gameId = this.gameId;
    next.code = this.code;
    next.hostId = this.hostId;
    this.state = next;
    this.syncConnectionFlags();
    return done;
  }

  /* ---------------------------------------------------------------- *
   * Chat
   * ---------------------------------------------------------------- */

  postChat(playerId: PlayerId, text: string): ChatMessageOut | null {
    const seat = this.seat(playerId);
    if (!seat) return null;
    const entry: ChatEntry = { from: playerId, name: seat.name, text, at: Date.now() };
    this.chat.push(entry);
    if (this.chat.length > this.deps.config.chatHistoryLimit) {
      this.chat = this.chat.slice(-this.deps.config.chatHistoryLimit);
    }
    const out: ChatMessageOut = { t: 'chat', from: entry.from, name: entry.name, text: entry.text, at: entry.at };
    for (const [, conn] of this.sockets_()) conn.send(out);
    return out;
  }

  /* ---------------------------------------------------------------- *
   * Turn timers (requirement 8)
   * ---------------------------------------------------------------- */

  /**
   * Arms — or disarms — the automatic-move timer for whoever is on the clock.
   *
   *  - Connected human: no timer, ever. The server never plays for someone
   *    who is sitting right there.
   *  - Bot seat: short cosmetic delay, then the engine's default move.
   *  - Disconnected human: the generous `turnTimeoutMs`, then a safe pass.
   */
  rescheduleAutoAction(): void {
    this.clearTurnTimer();
    if (this.disposed || !this.started || !this.state) return;
    if (this.state.phase === 'gameOver') return;

    const active = this.state.activePlayerId;
    if (!active) return;
    const seat = this.seat(active);
    if (!seat) return;

    if (seat.isBot) {
      this.turnTimer = setTimeout(() => this.takeAutoAction(active, 'bot'), this.deps.config.botDelayMs);
      this.turnTimer.unref?.();
      return;
    }
    if (this.isConnected(active)) return;

    const ms = this.deps.config.turnTimeoutMs;
    this.deps.logger.info('Turn timer armed for disconnected player', {
      gameId: this.gameId,
      code: this.code,
      playerId: active,
      name: seat.name,
      timeoutMs: ms,
    });
    this.turnTimer = setTimeout(() => this.takeAutoAction(active, 'disconnected'), ms);
    this.turnTimer.unref?.();
  }

  private clearTurnTimer(): void {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
  }

  /** Asks the engine for a safe move, applies it, and says so loudly. */
  private takeAutoAction(playerId: PlayerId, reason: 'bot' | 'disconnected'): void {
    this.turnTimer = null;
    if (this.disposed || !this.state || !this.started) return;
    if (this.state.activePlayerId !== playerId) return;
    // Guard against a race: they reconnected while the timer was in flight.
    if (reason === 'disconnected' && this.isConnected(playerId)) {
      this.rescheduleAutoAction();
      return;
    }

    const action = this.findSafeAction(playerId);
    const seat = this.seat(playerId);
    if (!action) {
      this.deps.logger.warn('No safe default action available; turn is stalled', {
        gameId: this.gameId,
        playerId,
        phase: this.state.phase,
        reason,
      });
      return;
    }

    const result = this.applyPlayerAction(playerId, action);
    if (!result.ok) {
      this.deps.logger.warn('Automatic action was rejected by the engine', {
        gameId: this.gameId,
        playerId,
        action: action.type,
        reason: result.message,
      });
      return;
    }

    this.deps.logger.info(
      reason === 'bot' ? 'Bot acted' : 'Auto-played for disconnected player',
      {
        gameId: this.gameId,
        code: this.code,
        playerId,
        name: seat?.name,
        action: action.type,
      },
    );
    this.persist();
    this.broadcastState();
    // The next player may also be a bot or absent — keep the table moving.
    this.rescheduleAutoAction();
  }

  /**
   * The engine's own suggestion if it has one, otherwise the first pass-like
   * candidate the engine says is legal. Rules knowledge stays in the engine.
   */
  private findSafeAction(playerId: PlayerId): GameAction | null {
    const state = this.state;
    if (!state) return null;
    const suggested = this.deps.engine.defaultActionFor?.(state, playerId);
    if (suggested) return suggested;
    for (const candidate of SAFE_DEFAULT_CANDIDATES) {
      if (this.deps.engine.validateAction(state, playerId, candidate).ok) return candidate;
    }
    return null;
  }

  /* ---------------------------------------------------------------- *
   * Teardown
   * ---------------------------------------------------------------- */

  /** Closes every socket and cancels timers. The record on disk is untouched. */
  dispose(closeCode: number = CLOSE.SHUTDOWN, reason = 'server shutting down'): void {
    this.disposed = true;
    this.clearTurnTimer();
    for (const [, conn] of this.sockets_()) conn.close(closeCode, reason);
    this.sockets.clear();
  }
}
