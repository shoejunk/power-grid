import type { ServerMessage } from '@pg/shared';

import type { ConnectionStatus, OutboundMessage } from './types';

/* ------------------------------------------------------------------ *
 * Session persistence
 * ------------------------------------------------------------------ */

const SESSION_KEY = 'pg.sessionToken';
const NAME_KEY = 'pg.playerName';

/**
 * localStorage can throw (private mode, disabled storage, quota). Every access
 * goes through these so a hostile storage environment degrades to "no session
 * persistence" rather than a white screen.
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

export const loadSessionToken = (): string | null => readStored(SESSION_KEY);
export const saveSessionToken = (token: string | null): void => writeStored(SESSION_KEY, token);
export const loadPlayerName = (): string | null => readStored(NAME_KEY);
export const savePlayerName = (name: string): void => writeStored(NAME_KEY, name);

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
 *    `{ t: 'rejoin', sessionToken }` with the token persisted in localStorage,
 *    so a refresh or a server restart puts the player back in their seat;
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
  private queue: OutboundMessage[] = [];

  constructor(handlers: SocketHandlers) {
    this.handlers = handlers;
  }

  /** WebSocket URL for the current origin. */
  static url(): string {
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

    socket.onclose = () => {
      this.stopHeartbeat();
      this.ws = null;
      if (this.closedByUs) {
        this.setStatus('idle');
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
    this.ws?.close(1000, 'client disconnect');
    this.ws = null;
    this.setStatus('idle');
  }

  /**
   * Sends a message, or queues it if the socket is down.
   * `ping` is never queued — a stale heartbeat is worthless.
   */
  send(message: OutboundMessage): void {
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
   * First frame after every open. With a stored token we `rejoin`, which asks
   * the server to put us back in whatever game the token belongs to; without
   * one we `hello`, and the server mints a fresh session.
   */
  private identify(): void {
    const token = loadSessionToken();
    if (token !== null && token.length > 0) {
      this.ws?.send(JSON.stringify({ t: 'rejoin', sessionToken: token } satisfies OutboundMessage));
    } else {
      this.ws?.send(JSON.stringify({ t: 'hello' } satisfies OutboundMessage));
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
      this.ws!.send(JSON.stringify({ t: 'ping' } satisfies OutboundMessage));

      // No pong in time means a half-open socket: force a close so the normal
      // reconnect path runs instead of sitting on a dead connection.
      this.heartbeatTimeout = window.setTimeout(() => {
        this.ws?.close(4000, 'heartbeat timeout');
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
