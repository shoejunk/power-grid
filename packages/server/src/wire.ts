/**
 * Socket wrapper.
 *
 * Everything the rest of the server needs from a WebSocket is here: a typed
 * `send`, backpressure protection, and the identity bound to the socket once
 * the client has authenticated with its account cookie (or legacy seat token).
 *
 * Backpressure: a client that stops reading (throttled mobile, suspended tab)
 * makes `bufferedAmount` grow without bound, and a `GameState` is not small.
 * Rather than let one dead peer eat the heap, we terminate it — its seat and
 * session survive, so it simply reconnects and gets a fresh full state.
 */

import { CLOSE, type ServerMessage } from '@tt/core';
import type { WebSocket } from 'ws';
import type { Logger } from './logger.js';

export { CLOSE } from '@tt/core';

export interface ConnectionOptions {
  maxBufferedBytes: number;
  maxMessagesPerSecond: number;
  logger: Logger;
}

let nextConnectionId = 1;

export class Connection {
  readonly id = `c${nextConnectionId++}`;
  /** Seat this socket is bound to, once authenticated. */
  playerId: string | null = null;
  gameId: string | null = null;
  sessionToken: string | null = null;
  /** Google account authenticated by the HttpOnly cookie, when configured. */
  accountId: string | null = null;
  /** Heartbeat bookkeeping — see `heartbeat.ts` usage in server.ts. */
  isAlive = true;

  private windowStart = Date.now();
  private windowCount = 0;

  constructor(
    private readonly ws: WebSocket,
    private readonly opts: ConnectionOptions,
  ) {}

  get readyState(): number {
    return this.ws.readyState;
  }

  get bufferedAmount(): number {
    return this.ws.bufferedAmount;
  }

  send(message: ServerMessage): void {
    // 1 === WebSocket.OPEN
    if (this.ws.readyState !== 1) return;
    if (this.ws.bufferedAmount > this.opts.maxBufferedBytes) {
      this.opts.logger.warn('Terminating socket for backpressure', {
        connection: this.id,
        playerId: this.playerId,
        buffered: this.ws.bufferedAmount,
      });
      this.close(CLOSE.BACKPRESSURE, 'backpressure');
      return;
    }
    let payload: string;
    try {
      payload = JSON.stringify(message);
    } catch (err) {
      this.opts.logger.error('Failed to serialise outbound message', {
        t: (message as { t?: string }).t,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    this.ws.send(payload, (err) => {
      if (err) {
        this.opts.logger.debug('Send failed', { connection: this.id, error: err.message });
      }
    });
  }

  error(code: string, message: string): void {
    this.send({ t: 'error', code, message });
  }

  /**
   * Simple fixed-window rate limit. Returns false when the caller should drop
   * the message (the socket is closed once the limit is exceeded).
   */
  allowInbound(): boolean {
    const now = Date.now();
    if (now - this.windowStart >= 1000) {
      this.windowStart = now;
      this.windowCount = 0;
    }
    this.windowCount += 1;
    if (this.windowCount > this.opts.maxMessagesPerSecond) {
      this.opts.logger.warn('Rate limit exceeded', { connection: this.id, playerId: this.playerId });
      this.close(CLOSE.RATE_LIMITED, 'rate limit');
      return false;
    }
    return true;
  }

  close(code = 1000, reason = ''): void {
    try {
      this.ws.close(code, reason);
    } catch {
      /* already closing */
    }
  }

  terminate(): void {
    try {
      this.ws.terminate();
    } catch {
      /* already dead */
    }
  }

  ping(): void {
    try {
      this.ws.ping();
    } catch {
      /* socket dying; the heartbeat sweep will collect it */
    }
  }
}
