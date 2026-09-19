import { CLOSE, type ClientMessage, type GameKey, type ServerMessage } from '@tt/core';

import type { ConnectionStatus } from './types';

/* ------------------------------------------------------------------ *
 * Session persistence
 * ------------------------------------------------------------------ */

const LEGACY_SESSION_KEY = 'tt.sessionToken';
const ANONYMOUS_GAMES_KEY = 'tt.anonymousGames';

export interface AnonymousGame {
  gameName?: string;
  gameId: string;
  gameKey: GameKey;
  code: string;
  started: boolean;
  updatedAt: number;
  playerName: string;
  sessionToken: string;
}

/**
 * Anonymous servers keep the active seat token here so a reload resumes it.
 * The historical key name is retained so existing browser seats keep working.
 * Account sessions use cookies and retire this active anonymous token.
 */
export function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — the session simply will not survive a reload */
  }
}

export const loadLegacySessionToken = (): string | null => readStored(LEGACY_SESSION_KEY);
export const clearLegacySessionToken = (): void => writeStored(LEGACY_SESSION_KEY, null);
export const saveLegacySessionToken = (token: string | null): void => writeStored(LEGACY_SESSION_KEY, token);

export function sessionTokenForInvite(invite?: string): string | null {
  return invite ? (loadAnonymousGames().find(game => game.code === invite.toUpperCase())?.sessionToken ?? null) : loadLegacySessionToken();
}

function isAnonymousGame(value: unknown): value is AnonymousGame {
  if (!value || typeof value !== 'object') return false;
  const game = value as Partial<AnonymousGame>;
  return typeof game.gameId === 'string'
    && typeof game.gameKey === 'string'
    && typeof game.code === 'string'
    && typeof game.started === 'boolean'
    && typeof game.updatedAt === 'number'
    && Number.isFinite(game.updatedAt)
    && typeof game.playerName === 'string'
    && typeof game.sessionToken === 'string';
}

export function loadAnonymousGames(): AnonymousGame[] {
  const raw = readStored(ANONYMOUS_GAMES_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isAnonymousGame).sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

function saveAnonymousGames(games: AnonymousGame[]): AnonymousGame[] {
  const sorted = [...games].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 50);
  writeStored(ANONYMOUS_GAMES_KEY, JSON.stringify(sorted));
  return sorted;
}

export function upsertAnonymousGame(game: AnonymousGame): AnonymousGame[] {
  return saveAnonymousGames([
    game,
    ...loadAnonymousGames().filter((candidate) => candidate.gameId !== game.gameId),
  ]);
}

export function removeAnonymousGameByToken(sessionToken: string): AnonymousGame[] {
  return saveAnonymousGames(
    loadAnonymousGames().filter((game) => game.sessionToken !== sessionToken),
  );
}

export function markAnonymousGameStartedByToken(sessionToken: string): AnonymousGame[] {
  return saveAnonymousGames(
    loadAnonymousGames().map((game) => (
      game.sessionToken === sessionToken ? { ...game, started: true } : game
    )),
  );
}

export function removeAnonymousGameById(gameId: string): AnonymousGame[] {
  return saveAnonymousGames(loadAnonymousGames().filter((game) => game.gameId !== gameId));
}

/* ------------------------------------------------------------------ *
 * Backoff
 * ------------------------------------------------------------------ */

const BACKOFF_BASE_MS = 500;
const BACKOFF_MAX_MS = 15_000;
/** After this many consecutive failures the UI stops saying "reconnecting". */
const OFFLINE_AFTER_ATTEMPTS = 5;

const HEARTBEAT_INTERVAL_MS = 20_000;
const HEARTBEAT_TIMEOUT_MS = 8_000;

/**
 * Exponential backoff with full jitter, capped.
 * Jitter matters: without it, every client kicked off by a server restart
 * reconnects in lockstep and hammers the server on the same tick.
 */
function backoffDelay(attempt: number): number {
  const ceiling = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** attempt);
  return Math.round(ceiling * (0.55 + Math.random() * 0.45));
}

/* ------------------------------------------------------------------ *
 * Socket
 * ------------------------------------------------------------------ */

export interface SocketHandlers {
  onMessage: (message: ServerMessage) => void;
  onStatus: (status: ConnectionStatus, attempt: number) => void;
  onLatency: (ms: number) => void;
  /** A newer tab took this seat over. Reconnecting would only fight it. */
  onReplaced: () => void;
}

/**
 * Resilient WebSocket client.
 *
 * Responsibilities:
 *  · dial `<same-origin>/ws` (Vite proxies it to the game server in dev, a
 *    reverse proxy does the same in production — the client never needs to
 *    know the server's real origin);
 *  · reconnect automatically with jittered exponential backoff, and instantly
 *    when the tab is refocused or the network comes back;
 *  · re-establish identity on every reconnect by sending
 *    `{ t: 'hello' }`; the server resolves the account from its HttpOnly
 *    Google-login cookie and finds the player's persisted seat;
 *  · queue outbound messages while the socket is down and flush them on open;
 *  · heartbeat with `ping`/`pong` to detect half-open connections that never
 *    fire a `close` event, and to measure latency.
 */
export class GameSocket {
  private ws: WebSocket | null = null;
  private handlers: SocketHandlers;

  private attempt = 0;
  private everConnected = false;
  private closedByUs = false;

  private reconnectTimer: number | undefined;
  private heartbeatTimer: number | undefined;
  private heartbeatTimeout: number | undefined;
  private pingSentAt = 0;

  /** Messages produced while the socket was down, replayed on reconnect. */
  private queue: ClientMessage[] = [];

  constructor(handlers: SocketHandlers) {
    this.handlers = handlers;
  }

  /**
   * Address of the game server.
   *
   * Defaults to `/ws` on the current origin, which is what the Vite dev proxy
   * serves. That only works when something on this origin actually speaks
   * WebSocket — true in dev, and true if the server is deployed behind the same
   * domain, but NOT on a static host such as Netlify or GitHub Pages.
   *
   * Set `VITE_WS_URL` at build time to point at a separately hosted server,
   * e.g. `VITE_WS_URL=wss://power-grid.fly.dev/ws`. A bare host is accepted and
   * upgraded: `wss://host` becomes `wss://host/ws`.
   */
  static url(): string {
    const configured = import.meta.env.VITE_WS_URL?.trim();
    if (configured) {
      const withScheme = /^wss?:\/\//i.test(configured)
        ? configured
        : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${configured}`;
      return /\/ws\/?$/.test(withScheme) ? withScheme : `${withScheme.replace(/\/$/, '')}/ws`;
    }
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws`;
  }

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** Opens the socket and starts the reconnect lifecycle. Idempotent. */
  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.closedByUs = false;
    this.setStatus(this.everConnected ? 'reconnecting' : 'connecting');

    let socket: WebSocket;
    try {
      socket = new WebSocket(GameSocket.url());
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = socket;

    socket.onopen = () => {
      this.attempt = 0;
      this.everConnected = true;
      this.setStatus('connected');
      this.identify();
      this.flushQueue();
      this.startHeartbeat();
    };

    socket.onmessage = (event: MessageEvent<string>) => {
      let parsed: ServerMessage;
      try {
        parsed = JSON.parse(event.data) as ServerMessage;
      } catch {
        return; // malformed frame — ignore rather than tear down the socket
      }

      if (parsed.t === 'pong') {
        this.clearHeartbeatTimeout();
        this.handlers.onLatency(Math.round(performance.now() - this.pingSentAt));
        return;
      }
      this.handlers.onMessage(parsed);
    };

    socket.onerror = () => {
      /* `close` always follows; reconnection is handled there. */
    };

    socket.onclose = (event: CloseEvent) => {
      this.stopHeartbeat();
      this.ws = null;
      if (this.closedByUs) {
        this.setStatus('idle');
        return;
      }
      /*
       * `REPLACED` is the one close the client must not fight: another tab has
       * taken this seat, and reconnecting would kick that tab off in turn,
       * leaving the two of them trading the seat forever.
       */
      if (event.code === CLOSE.REPLACED) {
        this.closedByUs = true;
        this.setStatus('idle');
        this.handlers.onReplaced();
        return;
      }
      this.scheduleReconnect();
    };
  }

  /** Closes the socket and stops reconnecting (used when leaving the app). */
  disconnect(): void {
    this.closedByUs = true;
    this.clearReconnect();
    this.stopHeartbeat();
    this.ws?.close(CLOSE.NORMAL, 'client disconnect');
    this.ws = null;
    this.setStatus('idle');
  }

  /**
   * Sends a message, or queues it if the socket is down.
   * `ping` is never queued — a stale heartbeat is worthless.
   */
  send(message: ClientMessage): void {
    if (this.isOpen) {
      this.ws!.send(JSON.stringify(message));
      return;
    }
    if (message.t === 'ping') return;
    this.queue.push(message);
    if (this.queue.length > 32) this.queue.shift();
    this.connect();
  }

  /** Drops any queued traffic — called when the player leaves a game. */
  clearQueue(): void {
    this.queue = [];
  }

  /** Forces an immediate reconnect attempt (tab refocus, "Retry" button). */
  retryNow(): void {
    if (this.isOpen) return;
    this.clearReconnect();
    this.attempt = 0;
    this.connect();
  }

  /* ---------------------------------------------------------------- *
   * Internals
   * ---------------------------------------------------------------- */

  /**
   * First frame after every open. A legacy token is sent once so a signed-in
   * browser can claim an old anonymous seat; normal account sessions use the
   * HttpOnly cookie automatically attached to the WebSocket request.
   */
  private identify(): void {
    const invite = /^\/join\/([a-z0-9]+)\/?$/i.exec(window.location.pathname ?? '')?.[1]?.toUpperCase();
    const token = sessionTokenForInvite(invite);
    if (token !== null && token.length > 0) {
      this.ws?.send(JSON.stringify({ t: 'rejoin', sessionToken: token } satisfies ClientMessage));
    } else {
      this.ws?.send(JSON.stringify({ t: 'hello' } satisfies ClientMessage));
    }
  }

  private flushQueue(): void {
    const pending = this.queue;
    this.queue = [];
    for (const message of pending) {
      if (this.isOpen) this.ws!.send(JSON.stringify(message));
    }
  }

  private setStatus(status: ConnectionStatus): void {
    this.handlers.onStatus(status, this.attempt);
  }

  private scheduleReconnect(): void {
    this.clearReconnect();
    const delay = backoffDelay(this.attempt);
    this.attempt += 1;
    this.setStatus(this.attempt > OFFLINE_AFTER_ATTEMPTS ? 'offline' : 'reconnecting');
    this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== undefined) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = window.setInterval(() => {
      if (!this.isOpen) return;
      this.pingSentAt = performance.now();
      this.ws!.send(JSON.stringify({ t: 'ping' } satisfies ClientMessage));

      // No pong in time means a half-open socket: force a close so the normal
      // reconnect path runs instead of sitting on a dead connection.
      this.heartbeatTimeout = window.setTimeout(() => {
        this.ws?.close(CLOSE.NORMAL, 'heartbeat timeout');
      }, HEARTBEAT_TIMEOUT_MS);
    }, HEARTBEAT_INTERVAL_MS);
  }

  private clearHeartbeatTimeout(): void {
    if (this.heartbeatTimeout !== undefined) {
      window.clearTimeout(this.heartbeatTimeout);
      this.heartbeatTimeout = undefined;
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== undefined) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    this.clearHeartbeatTimeout();
  }
}
