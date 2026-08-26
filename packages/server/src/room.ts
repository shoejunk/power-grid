/**
 * A single table: its lobby, its authoritative game state, the sockets
 * currently watching it, and the timers that keep it moving.
 *
 * Design rules this file enforces:
 *
 *  - The server is the only authority. Client input is a *request*; the game's
 *    plugin decides, the room applies and rebroadcasts.
 *  - The server holds no rules knowledge. Every question it cannot answer from
 *    seats and sockets alone is delegated to `this.plugin`. There is no
 *    `switch (gameKey)` anywhere in this file, and there must never be one.
 *  - A seat is permanent. Sockets come and go; a player's position never does.
 *    Leaving an in-progress game marks you disconnected, it does not delete you.
 *  - Every mutation is persisted before it is broadcast, so a client can never
 *    observe a state the disk has not seen.
 */

import type { AnyGamePlugin, GameKey, LobbyState, PlayerId, SeatColor } from '@tt/core';
import type { ServerConfig } from './config.js';
import type { Logger } from './logger.js';
import type {
  ChatEntry,
  GameAuditEventInput,
  GameStore,
  PersistedGame,
  Seat,
} from './persistence/types.js';
import type { Connection } from './wire.js';
import { CLOSE } from './wire.js';

/** The `chat` variant of the outbound union, named for readability. */
type ChatMessageOut = { t: 'chat'; from: PlayerId; name: string; text: string; at: number };

export interface RoomDeps {
  store: GameStore;
  plugin: AnyGamePlugin;
  config: ServerConfig;
  logger: Logger;
}

export type RoomResult = { ok: true } | { ok: false; code: string; message: string };

const fail = (code: string, message: string): RoomResult => ({ ok: false, code, message });
const done: RoomResult = { ok: true };

export class GameRoom {
  readonly gameId: string;
  readonly gameKey: GameKey;
  code: string;
  hostId: PlayerId;
  settings: unknown;
  seats: Seat[];
  state: unknown;
  started: boolean;
  chat: ChatEntry[];
  readonly createdAt: number;
  updatedAt: number;

  /** Live sockets, keyed by seat. Never persisted. */
  private readonly sockets = new Map<PlayerId, Connection>();
  private turnTimer: NodeJS.Timeout | null = null;
  /** Game mutations waiting for the next atomic snapshot commit. */
  private pendingAudit: GameAuditEventInput[] = [];
  /** Highest event sequence included in the durable snapshot. */
  private auditSequence: number;
  /** Legacy snapshots have no complete setup event and remain snapshot-only. */
  private auditEnabled: boolean;
  private disposed = false;

  constructor(
    private readonly deps: RoomDeps,
    record: PersistedGame,
  ) {
    this.gameId = record.gameId;
    this.gameKey = record.gameKey;
    this.code = record.code;
    this.hostId = record.hostId;
    this.settings = record.settings;
    this.seats = record.seats;
    this.state = record.state;
    this.started = record.started;
    this.chat = record.chat;
    this.createdAt = record.createdAt;
    this.updatedAt = record.updatedAt;
    this.auditSequence = record.auditSequence ?? 0;
    this.auditEnabled = record.auditSequence !== undefined;
    // A freshly built room has no sockets attached. Doing this here is what
    // makes "everyone is offline after a restart" true the instant the server
    // boots, rather than only after the first broadcast.
    this.syncPresence();
  }

  private get plugin(): AnyGamePlugin {
    return this.deps.plugin;
  }

  get minPlayers(): number {
    return this.plugin.descriptor.minPlayers;
  }

  get maxPlayers(): number {
    return this.plugin.descriptor.maxPlayers;
  }

  /**
   * How many seats this table actually accepts. Games that let the host size
   * the table ("a four-player game") narrow it below the descriptor ceiling.
   */
  get capacity(): number {
    const fromSettings = this.plugin.seatCapacity?.(this.settings as never);
    if (fromSettings === undefined) return this.maxPlayers;
    return Math.min(Math.max(fromSettings, this.minPlayers), this.maxPlayers);
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

  /** First colour nobody has taken, from this game's own palette. */
  private freeColor(exclude?: PlayerId): SeatColor | null {
    const taken = new Set(this.seats.filter((s) => s.playerId !== exclude).map((s) => s.color));
    return this.plugin.descriptor.seatColors.find((c) => !taken.has(c)) ?? null;
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
    this.syncPresence();
    this.rescheduleAutoAction();
  }

  /** Socket closed. The seat stays; only presence changes. */
  detach(playerId: PlayerId, conn: Connection): boolean {
    const current = this.sockets.get(playerId);
    if (current !== conn) return false;
    this.sockets.delete(playerId);
    this.syncPresence();
    this.rescheduleAutoAction();
    return true;
  }

  /* ---------------------------------------------------------------- *
   * Views
   * ---------------------------------------------------------------- */

  toLobbyState(): LobbyState {
    return {
      gameKey: this.gameKey,
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
      minPlayers: this.minPlayers,
      maxPlayers: this.maxPlayers,
    };
  }

  /**
   * Per-player view of the authoritative state.
   *
   * What counts as hidden is entirely the game's business — face-down decks,
   * sealed bids, private objectives, untriggered crossroads cards — so this is
   * a straight delegation. The server never decides what a player may see, and
   * it never sends the raw state to anybody.
   */
  stateFor(playerId: PlayerId | null): unknown {
    if (this.state === null || this.state === undefined) return null;
    return this.plugin.redactStateFor(this.state as never, playerId);
  }

  /** Who is actually on a live socket right now, keyed by seat. */
  private connectionFlags(): Record<PlayerId, boolean> {
    const out: Record<PlayerId, boolean> = {};
    for (const seat of this.seats) out[seat.playerId] = this.isConnected(seat.playerId);
    return out;
  }

  /**
   * Offers current presence to the game.
   *
   * Presence always rides on `LobbyState`, which every game shares. Games that
   * additionally want it reflected inside their own state — to dim an absent
   * player's board, say — implement `applyPresence`; the rest ignore it. The
   * server itself still knows nothing about the shape of a player record.
   */
  private syncPresence(): void {
    if (this.state == null || !this.plugin.applyPresence) return;
    try {
      this.state = this.plugin.applyPresence(this.state as never, this.connectionFlags(), Date.now());
    } catch (err) {
      // Presence is cosmetic; never let it take a table down.
      this.deps.logger.warn('applyPresence threw', {
        gameId: this.gameId,
        gameKey: this.gameKey,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /* ---------------------------------------------------------------- *
   * Broadcasting
   * ---------------------------------------------------------------- */

  broadcastLobby(): void {
    const lobby = this.toLobbyState();
    for (const [, conn] of this.sockets) conn.send({ t: 'lobby', lobby });
  }

  broadcastState(): void {
    if (this.state === null || this.state === undefined) return;
    this.syncPresence();
    for (const [playerId, conn] of this.sockets) {
      conn.send({ t: 'state', gameKey: this.gameKey, state: this.stateFor(playerId) });
    }
  }

  /** Sends whichever view is appropriate for the room's current stage. */
  sendSnapshot(playerId: PlayerId, conn: Connection): void {
    conn.send({ t: 'lobby', lobby: this.toLobbyState() });
    if (this.started && this.state != null) {
      conn.send({ t: 'state', gameKey: this.gameKey, state: this.stateFor(playerId) });
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
      gameKey: this.gameKey,
      code: this.code,
      hostId: this.hostId,
      settings: this.settings,
      seats: this.seats,
      state: this.state,
      ...(this.auditEnabled ? { auditSequence: this.auditSequence } : {}),
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
      const pending = this.pendingAudit;
      const record = this.toRecord();
      const events = this.auditEnabled ? pending : [];
      if (this.auditEnabled) record.auditSequence = this.auditSequence + events.length;
      this.deps.store.saveGameWithAudit(record, events);
      if (this.auditEnabled) this.auditSequence = record.auditSequence ?? this.auditSequence;
      this.pendingAudit = [];
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
    return done;
  }

  setColor(playerId: PlayerId, color: SeatColor): RoomResult {
    if (this.started) return fail('gameStarted', 'Colours are locked once the game starts.');
    const seat = this.seat(playerId);
    if (!seat) return fail('notInGame', 'You are not seated at this table.');
    if (!this.plugin.descriptor.seatColors.includes(color)) {
      return fail('badColor', `${this.plugin.descriptor.name} does not use that colour.`);
    }
    const clash = this.seats.find((s) => s.playerId !== playerId && s.color === color);
    if (clash) return fail('colorTaken', `${clash.name} already has that colour.`);
    seat.color = color;
    return done;
  }

  /**
   * Applies a host settings edit. Both halves of the check belong to the game:
   * the *shape* of the patch (`parseSettingsPatch`) and whether the resulting
   * configuration is coherent for the seated players (`validateSettings`).
   */
  updateSettings(playerId: PlayerId, rawPatch: unknown): RoomResult {
    if (playerId !== this.hostId) return fail('notHost', 'Only the host can change settings.');
    if (this.started) return fail('gameStarted', 'Settings are locked once the game starts.');

    const patch = this.plugin.parseSettingsPatch(rawPatch);
    if (!patch) return fail('badSettings', 'Those settings are not valid for this game.');

    const next = { ...(this.settings as object), ...(patch as object) };
    const verdict = this.plugin.validateSettings(next, this.seats.length);
    if (!verdict.ok) return fail('badSettings', verdict.reason);

    this.settings = next;
    return done;
  }

  addBot(playerId: PlayerId): RoomResult {
    if (playerId !== this.hostId) return fail('notHost', 'Only the host can add bots.');
    if (this.started) return fail('gameStarted', 'The game has already started.');
    if (!this.plugin.descriptor.supportsBots) {
      return fail('noBots', `${this.plugin.descriptor.name} does not support bot players.`);
    }
    if (this.seats.length >= this.capacity) return fail('gameFull', 'The table is full.');
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
      conn.close(CLOSE.NORMAL, 'kicked');
    }
    return done;
  }

  /**
   * Starts the game. Requires enough seats, every human other than the host
   * ready (the host consents by pressing start), and settings the game itself
   * accepts.
   */
  start(playerId: PlayerId): RoomResult {
    if (playerId !== this.hostId) return fail('notHost', 'Only the host can start the game.');
    if (this.started) return fail('gameStarted', 'The game has already started.');
    if (this.seats.length < this.minPlayers) {
      return fail('notEnoughPlayers', `At least ${this.minPlayers} players are required.`);
    }
    if (this.seats.length > this.capacity) {
      return fail('tooManyPlayers', `At most ${this.capacity} players are supported.`);
    }
    const notReady = this.seats.find((s) => !s.isBot && s.playerId !== this.hostId && !s.ready);
    if (notReady) return fail('notReady', `${notReady.name} is not ready.`);

    const verdict = this.plugin.validateSettings(this.settings as never, this.seats.length);
    if (!verdict.ok) return fail('badSettings', verdict.reason);

    const startedAt = Date.now();
    let state: unknown;
    try {
      state = this.plugin.createGame(
        {
          gameId: this.gameId,
          code: this.code,
          hostId: this.hostId,
          seed: `${this.code}-${this.createdAt}`,
          now: startedAt,
        },
        this.settings as never,
        this.seats.map((s) => ({ playerId: s.playerId, name: s.name, color: s.color, isBot: s.isBot })),
      );
    } catch (err) {
      this.deps.logger.error('Game failed to set up', {
        gameId: this.gameId,
        gameKey: this.gameKey,
        error: err instanceof Error ? err.message : String(err),
      });
      return fail('engineError', 'The rules engine could not set up this game.');
    }

    this.state = state;
    this.started = true;
    this.auditEnabled = true;
    this.pendingAudit.push({
      type: 'start',
      at: startedAt,
      hostId: this.hostId,
      settings: structuredClone(this.settings),
      seats: structuredClone(this.seats),
    });
    this.syncPresence();
    this.deps.logger.info('Game started', {
      gameId: this.gameId,
      gameKey: this.gameKey,
      code: this.code,
      players: this.seats.length,
    });
    return done;
  }

  /* ---------------------------------------------------------------- *
   * Host promotion
   * ---------------------------------------------------------------- */

  /**
   * Promotes the longest-seated connected player when the host explicitly
   * leaves. Falls back to the longest-seated player of any presence, so a
   * table is never left host-less after a restart.
   */
  promoteHostIfNeeded(departingId: PlayerId): PlayerId | null {
    if (this.hostId !== departingId) return null;
    const candidates = this.seats.filter((s) => s.playerId !== departingId && !s.isBot);
    if (candidates.length === 0) return null;
    const bySeniority = [...candidates].sort((a, b) => a.joinedAt - b.joinedAt);
    const connected = bySeniority.find((s) => this.isConnected(s.playerId));
    const chosen = connected ?? bySeniority[0];
    if (!chosen) return null;
    const changedAt = Date.now();
    this.hostId = chosen.playerId;
    if (this.state != null && this.plugin.applyHostChange) {
      try {
        this.state = this.plugin.applyHostChange(this.state as never, chosen.playerId, changedAt);
        this.pendingAudit.push({ type: 'hostChange', at: changedAt, hostId: chosen.playerId });
      } catch (err) {
        this.deps.logger.error('applyHostChange threw; the table may be stranded', {
          gameId: this.gameId,
          gameKey: this.gameKey,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    this.deps.logger.info('Host promoted', {
      gameId: this.gameId,
      from: departingId,
      to: chosen.playerId,
      name: chosen.name,
    });
    return chosen.playerId;
  }

  /* ---------------------------------------------------------------- *
   * Actions
   * ---------------------------------------------------------------- */

  /**
   * Validates and applies a player action.
   *
   * Membership and the turn clock are the server's business; legality is the
   * game's. The one subtlety is `allowsOutOfTurn`: genuinely simultaneous
   * decisions — sealed bids, simultaneous votes — must bypass the single
   * active-player clock, and only the game knows which of its actions those are.
   */
  applyPlayerAction(playerId: PlayerId, rawAction: unknown): RoomResult {
    if (!this.started || this.state == null) {
      return fail('gameNotStarted', 'The game has not started yet.');
    }
    if (!this.seat(playerId)) {
      return fail('notInGame', 'You are not seated at this table.');
    }
    const state = this.state as never;
    if (this.plugin.isGameOver(state)) {
      return fail('gameOver', 'The game is over.');
    }

    const action = this.plugin.parseAction(rawAction);
    if (action === null) return fail('badAction', 'Action payload is malformed.');

    const active = this.plugin.activePlayerOf(state);
    if (active !== playerId && !this.plugin.allowsOutOfTurn(state, playerId, action)) {
      return fail('notYourTurn', 'It is not your turn.');
    }

    const verdict = this.plugin.validateAction(state, playerId, action);
    if (!verdict.ok) return fail('illegalAction', verdict.reason);

    const appliedAt = Date.now();
    let next: unknown;
    try {
      next = this.plugin.applyAction(state, playerId, action, appliedAt);
    } catch (err) {
      this.deps.logger.error('Game threw while applying an action', {
        gameId: this.gameId,
        gameKey: this.gameKey,
        playerId,
        error: err instanceof Error ? err.message : String(err),
      });
      return fail('engineError', 'The rules engine rejected that action.');
    }

    this.state = next;
    this.pendingAudit.push({
      type: 'action',
      at: appliedAt,
      playerId,
      action: structuredClone(action),
    });
    this.syncPresence();
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
    for (const [, conn] of this.sockets) conn.send(out);
    return out;
  }

  /* ---------------------------------------------------------------- *
   * Bot turns
   * ---------------------------------------------------------------- */

  /**
   * Arms — or disarms — the automatic-move timer for whoever is on the clock.
   *
   *  - Human seat: no timer, ever. Asynchronous games wait indefinitely,
   *    whether the player is connected or disconnected.
   *  - Bot seat: short cosmetic delay, then the game's default move.
   */
  rescheduleAutoAction(): void {
    this.clearTurnTimer();
    if (this.disposed || !this.started || this.state == null) return;
    if (this.plugin.isGameOver(this.state as never)) return;

    const active = this.plugin.activePlayerOf(this.state as never);
    if (!active) return;
    const seat = this.seat(active);
    if (!seat?.isBot) return;

    this.turnTimer = setTimeout(() => this.takeAutoAction(active), this.deps.config.botDelayMs);
    this.turnTimer.unref?.();
  }

  private clearTurnTimer(): void {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
  }

  /** Asks the game for a safe move, applies it, and says so loudly. */
  private takeAutoAction(playerId: PlayerId): void {
    this.turnTimer = null;
    if (this.disposed || this.state == null || !this.started) return;
    if (this.plugin.activePlayerOf(this.state as never) !== playerId) return;

    const candidates = this.findSafeActions(playerId);
    if (candidates.length === 0) {
      this.deps.logger.warn('No safe bot action available; turn is stalled', {
        gameId: this.gameId,
        gameKey: this.gameKey,
        playerId,
      });
      return;
    }

    /*
     * The game's own suggestion first, then its pass-like fallbacks. Trying the
     * rest after a rejection matters because a rejected move leaves the timer
     * chain dead and the table stalled forever: one mis-planned move must not
     * be able to end the game.
     */
    let played = false;
    for (const candidate of candidates) {
      const result = this.applyPlayerAction(playerId, candidate);
      if (result.ok) {
        played = true;
        break;
      }
      this.deps.logger.warn('Automatic action was rejected', {
        gameId: this.gameId,
        playerId,
        reason: result.message,
      });
    }
    if (!played) return;

    this.deps.logger.info('Bot acted', {
      gameId: this.gameId,
      gameKey: this.gameKey,
      code: this.code,
      playerId,
      name: this.seat(playerId)?.name,
    });
    this.persist();
    this.broadcastState();
    // The next player may also be a bot; keep the table moving.
    this.rescheduleAutoAction();
  }

  /**
   * The game's own suggestion, then every pass-like candidate it offers, in the
   * order they should be tried. Only used for bot seats; human turns are never
   * resolved by the server.
   */
  private findSafeActions(playerId: PlayerId): unknown[] {
    if (this.state == null) return [];
    const state = this.state as never;
    const out: unknown[] = [];
    /*
     * Guarded: this runs inside a timer callback, and a game's lookups may
     * throw on an unknown player id. An escaped throw would kill the timer
     * chain silently — `rescheduleAutoAction` would never run again — turning
     * a transient inconsistency into a permanently stalled table.
     */
    try {
      const suggested = this.plugin.defaultActionFor?.(state, playerId);
      if (suggested != null) out.push(suggested);
      for (const candidate of this.plugin.safeDefaultActions?.(state, playerId) ?? []) {
        if (this.plugin.validateAction(state, playerId, candidate).ok) out.push(candidate);
      }
    } catch (err) {
      this.deps.logger.warn('Default-action resolution threw; treating as no safe action', {
        gameId: this.gameId,
        playerId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return out;
  }

  /* ---------------------------------------------------------------- *
   * Teardown
   * ---------------------------------------------------------------- */

  /** Closes every socket and cancels timers. The record on disk is untouched. */
  dispose(closeCode: number = CLOSE.SHUTDOWN, reason = 'server shutting down'): void {
    this.disposed = true;
    this.clearTurnTimer();
    for (const [, conn] of this.sockets) conn.close(closeCode, reason);
    this.sockets.clear();
  }
}
