/**
 * Network layer public surface.
 *
 *   net.*            typed send helpers, one per ClientMessage variant
 *   useGameStore     zustand store: lobby, gameState, connectionStatus,
 *                    toasts, myPlayerId, route, chat
 *   GameSocket       the transport (exported for tests)
 */
export { GameSocket, loadPlayerName, loadSessionToken, savePlayerName, saveSessionToken } from './socket';
export {
  net,
  selectIsHost,
  selectMyLobbyPlayer,
  selectOnline,
  useGameStore,
} from './store';
export type { ChatLine, GameStore } from './store';
export type { ConnectionStatus, Route, Toast, ToastInput, ToastTone } from './types';
