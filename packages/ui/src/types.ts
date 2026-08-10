/**
 * Presentational types the design system owns.
 *
 * These describe how something *looks*, never where it came from: a toast is a
 * card with a tone and a lifetime whether the app raised it from a socket
 * error or a clipboard success, and a connection indicator renders the same
 * five states regardless of what is on the other end of the wire.
 *
 * The app's network layer re-exports them rather than declaring its own, so
 * there is exactly one definition to keep in step.
 */

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

export interface ToastView {
  id: string;
  tone: ToastTone;
  title: string;
  message?: string;
  /** ms before auto-dismiss. 0 keeps it up until dismissed by hand. */
  duration: number;
  createdAt: number;
}

/**
 * Connection lifecycle.
 *
 * `connecting` is the first attempt, `reconnecting` is every attempt after a
 * connection has previously succeeded — the UI treats them differently because
 * only the second one means "your game is still there, hold on".
 */
export type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'offline';
