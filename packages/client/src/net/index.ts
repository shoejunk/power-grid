/**
 * Network layer public surface.
 *
 *   net.*            typed send helpers, one per ClientMessage variant
 *   useGameStore     zustand store: lobby, gameKey, opaque state,
 *                    connectionStatus, toasts, myPlayerId, chat
 *   GameSocket       the transport (exported for tests)
 *
 * Nothing in here knows what game is being played. The store carries a
 * `gameKey` and an opaque `state`; narrowing that state is the job of the game
 * UI the key names.
 */
export {
  GameSocket,
  loadPlayerName,
  loadSessionToken,
  savePlayerName,
  saveSessionToken,
} from './socket';
export {
  net,
  selectConnectedSeats,
  selectIsHost,
  selectMyLobbyPlayer,
  selectOnline,
  useGameStore,
} from './store';
export type { ChatLine, GameStore } from './store';
export { ConnectionPill, Toaster } from './indicators';
export type { ConnectionStatus, Toast, ToastInput, ToastTone } from './types';
