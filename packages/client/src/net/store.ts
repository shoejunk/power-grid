import { create } from 'zustand';
import type {
  ClientMessage,
  GameAction,
  GameSettings,
  GameState,
  LobbyState,
  PlayerId,
  ServerMessage,
} from '@pg/shared';

import {
  GameSocket,
  loadPlayerName,
  loadSessionToken,
  savePlayerName,
  saveSessionToken,
} from './socket';
import type { ConnectionStatus, Route, Toast, ToastInput } from './types';

/* ------------------------------------------------------------------ *
 * Chat
 * ------------------------------------------------------------------ */

export interface ChatLine {
  id: string;
  from: PlayerId;
  name: string;
  text: string;
  at: number;
}

/* ------------------------------------------------------------------ *
 * Store shape
 * ------------------------------------------------------------------ */

export interface GameStore {
  /* --- connection --- */
  connectionStatus: ConnectionStatus;
  reconnectAttempt: number;
  latencyMs: number | null;

  /* --- identity --- */
  myPlayerId: PlayerId | null;
  playerName: string;

  /* --- server state --- */
  lobby: LobbyState | null;
  gameState: GameState | null;

  /* --- shell state --- */
  route: Route;
  toasts: Toast[];
  chat: ChatLine[];
  /** Last protocol-level error, surfaced inline on the screen that caused it. */
  lastError: { code: string; message: string } | null;
  /** True between "user asked to create/join" and the server's first reply. */
  pending: boolean;

  /* --- actions --- */
  setRoute: (route: Route) => void;
  setPlayerName: (name: string) => void;
  pushToast: (toast: ToastInput) => string;
  dismissToast: (id: string) => void;
  clearError: () => void;
  applyServerMessage: (message: ServerMessage) => void;
}

let toastSeq = 0;
const nextId = (prefix: string): string => {
  toastSeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${toastSeq}`;
};

const DEFAULT_TOAST_MS = 5200;

export const useGameStore = create<GameStore>((set, get) => ({
  connectionStatus: 'idle',
  reconnectAttempt: 0,
  latencyMs: null,

  myPlayerId: null,
  playerName: loadPlayerName() ?? '',

  lobby: null,
  gameState: null,

  route: 'menu',
  toasts: [],
  chat: [],
  lastError: null,
  pending: false,

  setRoute: (route) => set({ route, lastError: null }),

  setPlayerName: (name) => {
    savePlayerName(name);
    set({ playerName: name });
  },

  pushToast: (input) => {
    const toast: Toast = {
      id: nextId('toast'),
      tone: input.tone ?? 'info',
      title: input.title,
      message: input.message,
      duration: input.duration ?? DEFAULT_TOAST_MS,
      createdAt: Date.now(),
    };
    // Cap the stack so a burst of server errors cannot cover the screen.
    set((s) => ({ toasts: [...s.toasts, toast].slice(-4) }));
    return toast.id;
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  clearError: () => set({ lastError: null }),

  /**
   * The single reducer for everything the server says.
   *
   * Keeping this in the store (rather than in the socket) means the transport
   * is replaceable and the reducer is directly unit-testable.
   */
  applyServerMessage: (message) => {
    switch (message.t) {
      case 'welcome': {
        // The token is our seat. Persisting it is what makes a refresh, a tab
        // close, or a full server restart recoverable.
        saveSessionToken(message.sessionToken);
        set({ myPlayerId: message.playerId });
        break;
      }

      case 'lobby': {
        const previous = get().lobby;
        set({
          lobby: message.lobby,
          pending: false,
          lastError: null,
          // Only take over the route when we are not already in the match.
          route: message.lobby.started ? get().route : 'lobby',
        });

        // Announce arrivals/departures once we already had a roster to compare.
        if (previous && previous.gameId === message.lobby.gameId) {
          const before = new Set(previous.players.map((p) => p.id));
          const after = new Set(message.lobby.players.map((p) => p.id));
          for (const player of message.lobby.players) {
            if (!before.has(player.id) && player.id !== get().myPlayerId) {
              get().pushToast({ tone: 'info', title: `${player.name} joined` });
            }
          }
          for (const player of previous.players) {
            if (!after.has(player.id)) {
              get().pushToast({ tone: 'warning', title: `${player.name} left` });
            }
          }
        }
        break;
      }

      case 'state': {
        set({ gameState: message.state, pending: false, route: 'game', lastError: null });
        break;
      }

      case 'patch': {
        /*
         * Incremental updates. The server currently broadcasts full `state`
         * snapshots; `patch` is reserved for the delta channel that the
         * engine package will start emitting. Until the op format is pinned
         * down in @pg/shared (`ops` is `unknown[]`), the client cannot apply
         * them safely, so it deliberately ignores them and continues to
         * render the last authoritative snapshot rather than guessing.
         */
        break;
      }

      case 'error': {
        set({ lastError: { code: message.code, message: message.message }, pending: false });
        get().pushToast({ tone: 'error', title: 'Server error', message: message.message });
        break;
      }

      case 'actionRejected': {
        get().pushToast({
          tone: 'warning',
          title: 'Move not allowed',
          message: message.reason,
        });
        break;
      }

      case 'chat': {
        const line: ChatLine = {
          id: nextId('chat'),
          from: message.from,
          name: message.name,
          text: message.text,
          at: message.at,
        };
        set((s) => ({ chat: [...s.chat, line].slice(-200) }));
        break;
      }

      case 'pong':
        break;

      default: {
        // Exhaustiveness guard: adding a ServerMessage variant to @pg/shared
        // without handling it here becomes a compile error.
        const never: never = message;
        void never;
        break;
      }
    }
  },
}));

/* ------------------------------------------------------------------ *
 * Transport singleton
 * ------------------------------------------------------------------ */

const socket = new GameSocket({
  onMessage: (message) => useGameStore.getState().applyServerMessage(message),

  onStatus: (status, attempt) => {
    const previous = useGameStore.getState().connectionStatus;
    useGameStore.setState({ connectionStatus: status, reconnectAttempt: attempt });

    // Only talk about the connection when it actually changes character —
    // a silent recovery is the good case and should stay silent.
    if (status === 'connected' && (previous === 'reconnecting' || previous === 'offline')) {
      useGameStore.getState().pushToast({
        tone: 'success',
        title: 'Reconnected',
        message: 'Your seat and game state were restored.',
      });
    }
    if (status === 'offline' && previous !== 'offline') {
      useGameStore.getState().pushToast({
        tone: 'error',
        title: 'Connection lost',
        message: 'Still retrying in the background. Your seat is held.',
        duration: 0,
      });
    }
  },

  onLatency: (ms) => useGameStore.setState({ latencyMs: ms }),
});

/* ------------------------------------------------------------------ *
 * Typed send helpers — one per ClientMessage variant
 * ------------------------------------------------------------------ */

/**
 * The application's entire outbound surface.
 *
 * Screens never touch the socket or build wire frames by hand; they call these,
 * which keeps every outgoing message type-checked against `ClientMessage`.
 */
export const net = {
  /** Opens the connection. Safe to call repeatedly. */
  start(): void {
    socket.connect();
  },

  stop(): void {
    socket.disconnect();
  },

  /** Manual retry, wired to the "Retry now" affordance on the offline banner. */
  retry(): void {
    socket.retryNow();
  },

  hello(): void {
    socket.send({ t: 'hello', sessionToken: loadSessionToken() ?? undefined });
  },

  createGame(name: string, settings: Omit<GameSettings, 'seed'> & { seed?: string }): void {
    useGameStore.getState().setPlayerName(name);
    useGameStore.setState({ pending: true, lastError: null });
    socket.send({ t: 'createGame', name, settings });
  },

  joinGame(code: string, name: string): void {
    useGameStore.getState().setPlayerName(name);
    useGameStore.setState({ pending: true, lastError: null });
    socket.send({ t: 'joinGame', code: code.toUpperCase(), name });
  },

  rejoin(sessionToken: string): void {
    socket.send({ t: 'rejoin', sessionToken });
  },

  leaveGame(): void {
    socket.send({ t: 'leaveGame' });
    socket.clearQueue();
    saveSessionToken(null);
    useGameStore.setState({
      lobby: null,
      gameState: null,
      chat: [],
      lastError: null,
      route: 'menu',
    });
  },

  setReady(ready: boolean): void {
    socket.send({ t: 'setReady', ready });
  },

  updateSettings(settings: Partial<GameSettings>): void {
    socket.send({ t: 'updateSettings', settings });
  },

  addBot(): void {
    socket.send({ t: 'addBot' });
  },

  removePlayer(playerId: PlayerId): void {
    socket.send({ t: 'removePlayer', playerId });
  },

  startGame(): void {
    socket.send({ t: 'startGame' });
  },

  action(action: GameAction, nonce?: string): void {
    socket.send({ t: 'action', action, nonce });
  },

  chat(text: string): void {
    socket.send({ t: 'chat', text });
  },

  ping(): void {
    socket.send({ t: 'ping' });
  },

  /** Escape hatch for future message types; still typed against the union. */
  raw(message: ClientMessage): void {
    socket.send(message);
  },
} as const;

/* ------------------------------------------------------------------ *
 * Selectors
 * ------------------------------------------------------------------ */

export const selectIsHost = (state: GameStore): boolean =>
  state.lobby !== null && state.myPlayerId !== null && state.lobby.hostId === state.myPlayerId;

export const selectMyLobbyPlayer = (state: GameStore) =>
  state.lobby?.players.find((p) => p.id === state.myPlayerId) ?? null;

export const selectOnline = (state: GameStore): boolean => state.connectionStatus === 'connected';
