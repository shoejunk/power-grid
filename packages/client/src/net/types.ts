/**
 * Client-only networking types.
 *
 * The wire protocol itself (`ClientMessage` / `ServerMessage`) lives in
 * @pg/shared; everything here describes how *this* client models the
 * connection, and is deliberately not shared with the server.
 */

/**
 * Connection lifecycle.
 *
 * `connecting` is the first attempt, `reconnecting` is every attempt after a
 * connection has previously succeeded — the UI treats them differently because
 * only the second one means "your game is still there, hold on".
 */
export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'offline';

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: string;
  tone: ToastTone;
  title: string;
  message?: string;
  /** ms before auto-dismiss. 0 keeps it up until dismissed by hand. */
  duration: number;
  createdAt: number;
}

/** Payload accepted by `pushToast`; the store fills in id/createdAt/duration. */
export interface ToastInput {
  tone?: ToastTone;
  title: string;
  message?: string;
  duration?: number;
}

/** Which screen the shell is showing. Routing is state, not URL-driven. */
export type Route = 'menu' | 'create' | 'join' | 'lobby' | 'game';
