/**
 * A real WebSocket client for the integration tests.
 *
 * The tests deliberately drive the server the way a browser does — open a
 * socket, send JSON, wait for JSON — rather than calling internals. That is
 * the only way to prove things like "a player who closes the tab and returns
 * resumes exactly where they were".
 *
 * `state` payloads are `unknown` on the wire now that the server is
 * game-agnostic, so the state-shaped helpers take a type parameter. It
 * defaults to the stub game, which is what almost every test uses.
 */

import type { ServerMessage } from '@tt/core';
import WebSocket from 'ws';
import type { StubState } from './stubGame.js';

type MessageOfType<T extends ServerMessage['t']> = Extract<ServerMessage, { t: T }>;

interface Waiter {
  predicate: (m: ServerMessage) => boolean;
  resolve: (m: ServerMessage) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

/** A `state` frame with its opaque payload narrowed to the game under test. */
export type StateMessage<S = StubState> = { t: 'state'; gameKey: string; state: S };

export class TestClient {
  /** Everything ever received, in order — handy for assertions after the fact. */
  readonly received: ServerMessage[] = [];
  private readonly pending: ServerMessage[] = [];
  private readonly waiters: Waiter[] = [];
  private closed = false;

  private constructor(private readonly ws: WebSocket) {
    ws.on('message', (data) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(data.toString()) as ServerMessage;
      } catch {
        return;
      }
      this.received.push(msg);
      const idx = this.waiters.findIndex((w) => w.predicate(msg));
      if (idx >= 0) {
        const [waiter] = this.waiters.splice(idx, 1);
        if (waiter) {
          clearTimeout(waiter.timer);
          waiter.resolve(msg);
          return;
        }
      }
      this.pending.push(msg);
    });
    ws.on('close', () => {
      this.closed = true;
      for (const w of this.waiters.splice(0)) {
        clearTimeout(w.timer);
        w.reject(new Error('socket closed while waiting for a message'));
      }
    });
  }

  static connect(url: string): Promise<TestClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const timer = setTimeout(() => reject(new Error(`timed out connecting to ${url}`)), 5000);
      ws.once('open', () => {
        clearTimeout(timer);
        resolve(new TestClient(ws));
      });
      ws.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  send(message: unknown): void {
    this.ws.send(JSON.stringify(message));
  }

  /** Sends a raw (possibly malformed) frame — used to test the parser. */
  sendRaw(raw: string): void {
    this.ws.send(raw);
  }

  /** Waits for the next message satisfying `predicate`, consuming it. */
  waitWhere(
    predicate: (m: ServerMessage) => boolean,
    timeoutMs = 4000,
    label = 'message',
  ): Promise<ServerMessage> {
    const idx = this.pending.findIndex(predicate);
    if (idx >= 0) {
      const [msg] = this.pending.splice(idx, 1);
      if (msg) return Promise.resolve(msg);
    }
    if (this.closed) return Promise.reject(new Error(`socket already closed, waiting for ${label}`));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this.waiters.findIndex((w) => w.timer === timer);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(
          new Error(
            `timed out after ${timeoutMs}ms waiting for ${label}; received: ${this.received
              .map((m) => m.t)
              .join(', ')}`,
          ),
        );
      }, timeoutMs);
      this.waiters.push({ predicate, resolve, reject, timer });
    });
  }

  wait<T extends ServerMessage['t']>(t: T, timeoutMs = 4000): Promise<MessageOfType<T>> {
    return this.waitWhere((m) => m.t === t, timeoutMs, `'${t}'`) as Promise<MessageOfType<T>>;
  }

  /** Waits for the next `state` frame, with its payload narrowed. */
  waitAnyState<S = StubState>(timeoutMs = 4000): Promise<StateMessage<S>> {
    return this.waitWhere((m) => m.t === 'state', timeoutMs, "'state'") as Promise<StateMessage<S>>;
  }

  /** Waits for a `state` message whose payload satisfies `predicate`. */
  waitState<S = StubState>(
    predicate: (s: S) => boolean,
    timeoutMs = 4000,
    label = 'state',
  ): Promise<StateMessage<S>> {
    return this.waitWhere(
      (m) => m.t === 'state' && predicate((m as StateMessage<S>).state),
      timeoutMs,
      label,
    ) as Promise<StateMessage<S>>;
  }

  /** The most recent `state` frame received, with its payload narrowed. */
  lastState<S = StubState>(): S | undefined {
    for (let i = this.received.length - 1; i >= 0; i--) {
      const m = this.received[i];
      if (m?.t === 'state') return (m as StateMessage<S>).state;
    }
    return undefined;
  }

  /** Waits for a `lobby` message whose payload satisfies `predicate`. */
  waitLobby(
    predicate: (l: MessageOfType<'lobby'>['lobby']) => boolean,
    timeoutMs = 4000,
    label = 'lobby',
  ): Promise<MessageOfType<'lobby'>> {
    return this.waitWhere(
      (m) => m.t === 'lobby' && predicate((m as MessageOfType<'lobby'>).lobby),
      timeoutMs,
      label,
    ) as Promise<MessageOfType<'lobby'>>;
  }

  /** Drops everything buffered so far — use before an action to avoid stale hits. */
  clear(): void {
    this.pending.length = 0;
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.ws.readyState === WebSocket.CLOSED) {
        resolve();
        return;
      }
      this.ws.once('close', () => resolve());
      this.ws.close();
    });
  }

  /** Simulates a tab crash: no close frame, just a dead socket. */
  kill(): void {
    this.ws.terminate();
  }
}
