/**
 * Client-only networking types.
 *
 * The wire protocol itself (`ClientMessage` / `ServerMessage`) lives in
 * `@tt/core`; everything here describes how *this* client models the
 * connection. Nothing in this file — or anywhere else under `net/` — may name
 * a game, a phase or a resource: the transport carries opaque payloads and the
 * per-game UI is what narrows them.
 */

import type { ConnectionState, ToastTone, ToastView } from '@tt/ui';

/**
 * The design system owns the shape of a toast and of a connection indicator,
 * because they are presentational; re-exporting rather than redeclaring keeps
 * one definition in play.
 */
export type ConnectionStatus = ConnectionState;
export type { ToastTone };
export type Toast = ToastView;

/** Payload accepted by `pushToast`; the store fills in id/createdAt/duration. */
export interface ToastInput {
  tone?: ToastTone;
  title: string;
  message?: string;
  duration?: number;
}
