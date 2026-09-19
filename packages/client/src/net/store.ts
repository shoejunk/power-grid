import type { GameKey, LobbyState, PlayerId, SeatColor, ServerMessage } from '@tt/core';
import { create } from 'zustand';

import {
  GameSocket,
  clearLegacySessionToken,
  loadAnonymousGames,
  loadLegacySessionToken,
  markAnonymousGameStartedByToken,
  removeAnonymousGameById,
  removeAnonymousGameByToken,
  saveLegacySessionToken,
  sessionTokenForInvite,
  upsertAnonymousGame,
  type AnonymousGame,
} from './socket';
import type { ConnectionStatus, Toast, ToastInput } from './types';
import { navigate } from '@/router';

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

export interface AuthAccount {
  id: string;
  email: string;
  name: string;
  picture?: string;
}

export interface AccountGame {
  isYourTurn?: boolean;
  gameName?: string;
  gameId: string;
  gameKey: GameKey;
  code: string;
  started: boolean;
  updatedAt: number;
  playerName: string;
}

export interface AuthState {
  configured: boolean;
  required: boolean;
  authenticated: boolean;
  account: AuthAccount | null;
  games: AccountGame[];
  loading: boolean;
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
  auth: AuthState;
  anonymousGames: AnonymousGame[];

  /* --- server state --- */
  lobby: LobbyState | null;
  /**
   * Which game this browser is seated in, or `null` when it is seated in none.
   *
   * Tracked separately from `lobby` because `welcome` arrives first and a
   * `state` frame can arrive before any lobby: it is what tells the shell
   * which game UI module to load.
   */
  gameKey: GameKey | null;
  /**
   * The latest authoritative snapshot, still opaque.
   *
   * The platform deliberately cannot read inside this. Narrowing it is the
   * job of the game UI named by `gameKey`, which is the only code that knows
   * what shape the game's own state has.
   */
  state: unknown;

  /* --- shell state --- */
  toasts: Toast[];
  chat: ChatLine[];
  /** Last protocol-level error, surfaced inline on the screen that caused it. */
  lastError: { code: string; message: string } | null;
  /** True between "user asked to create/join" and the server's first reply. */
  pending: boolean;

  /* --- actions --- */
  setPlayerName: (name: string) => void;
  pushToast: (toast: ToastInput) => string;
  dismissToast: (id: string) => void;
  clearError: () => void;
  applyServerMessage: (message: ServerMessage) => void;
  setAuth: (auth: AuthState) => void;
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
  playerName: '',
  auth: {
    configured: false,
    required: false,
    authenticated: false,
    account: null,
    games: [],
    loading: true,
  },
  anonymousGames: loadAnonymousGames(),

  lobby: null,
  gameKey: null,
  state: null,

  toasts: [],
  chat: [],
  lastError: null,
  pending: false,

  setPlayerName: (name) => {
    set({ playerName: name });
  },

  setAuth: (auth) => set({ auth }),

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
   * is replaceable and the reducer is directly unit-testable. Note what it
   * does *not* do: it never inspects `state`, and it never branches on
   * `gameKey`. Both are carried, not read.
   */
  applyServerMessage: (message) => {
    switch (message.t) {
      case 'welcome': {
        // Account sessions are recovered through the server's HttpOnly
        // cookie. Anonymous seats live in this browser's local game list, and
        // an account-bearing welcome retires the matching local entry.
        let anonymousGames = get().anonymousGames;
        if (message.accountId) {
          clearLegacySessionToken();
          anonymousGames = removeAnonymousGameByToken(message.sessionToken);
        } else {
          saveLegacySessionToken(message.sessionToken);
          anonymousGames = upsertAnonymousGame({
            gameId: message.gameId,
            gameKey: message.gameKey,
            code: message.code,
            gameName: message.gameName,
            started: message.started,
            updatedAt: message.updatedAt,
            playerName: message.playerName,
            sessionToken: message.sessionToken,
          });
        }
        set({
          state: null,
          lobby: null,
          myPlayerId: message.playerId,
          gameKey: message.gameKey,
          anonymousGames,
        });
        break;
      }

      case 'lobby': {
        const previous = get().lobby;
        for (const game of get().anonymousGames) {
          if (game.gameId === message.lobby.gameId) {
            set({ anonymousGames: upsertAnonymousGame({ ...game, gameName: message.lobby.gameName }) });
          }
        }
        set({
          lobby: message.lobby,
          gameKey: message.lobby.gameKey,
          pending: false,
          lastError: null,
        });

        // Announce arrivals/departures once we already had a roster to compare.
        if (previous && previous.gameId === message.lobby.gameId) {
          const before = new Set(previous.players.map((p) => p.id));
          const after = new Set(message.lobby.players.map((p) => p.id));
          for (const player of message.lobby.players) {
            // Bots only ever appear because the host just asked for one — the
            // seat filling in on screen is feedback enough.
            if (!before.has(player.id) && player.id !== get().myPlayerId && !player.isBot) {
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
        const token = loadLegacySessionToken();
        const anonymousGames = token
          && get().anonymousGames.some((game) => game.sessionToken === token && !game.started)
          ? markAnonymousGameStartedByToken(token)
          : get().anonymousGames;
        set({
          state: message.state,
          gameKey: message.gameKey,
          pending: false,
          lastError: null,
          anonymousGames,
        });
        break;
      }

      case 'error': {
        /*
         * `noSession` and `unknownSession` are the *expected* answers to the
         * handshake when this browser has no live seat — a first visit, or a
         * token that outlived its game. They are not failures, so we quietly
         * drop the stale token and stay on the portal rather than alarming the
         * player. Every other code is a genuine error.
         */
        if (message.code === 'noSession' || message.code === 'unknownSession') {
          const staleToken = loadLegacySessionToken();
          clearLegacySessionToken();
          set({
            pending: false,
            ...(staleToken
              ? { anonymousGames: removeAnonymousGameByToken(staleToken) }
              : {}),
          });
          break;
        }
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

      case 'viewingGames': {
        let anonymousGames = get().anonymousGames;
        clearLegacySessionToken();
        if (message.quit) {
          anonymousGames = removeAnonymousGameById(message.gameId);
        }
        set({
          lobby: null,
          gameKey: null,
          state: null,
          myPlayerId: null,
          chat: [],
          lastError: null,
          pending: false,
          anonymousGames,
        });
        navigate({ name: 'portal' });
        // Membership is server-owned. Refresh after both paths so the portal
        // immediately shows the preserved seat or removes the quit table.
        void net.loadAuth();
        break;
      }

      case 'pong':
        break;

      default: {
        // Exhaustiveness guard: adding a ServerMessage variant to @tt/core
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

/** Id of the sticky offline notice, so we never stack more than one. */
let offlineToastId: string | null = null;

const socket = new GameSocket({
  onMessage: (message) => useGameStore.getState().applyServerMessage(message),

  onReplaced: () => {
    useGameStore.getState().pushToast({
      tone: 'warning',
      title: 'Seat taken over',
      message: 'You opened this game in another tab. This one is now a spectator.',
      duration: 0,
    });
  },

  onStatus: (status, attempt) => {
    const previous = useGameStore.getState().connectionStatus;
    useGameStore.setState({ connectionStatus: status, reconnectAttempt: attempt });

    // Only talk about the connection when it actually changes character —
    // a silent recovery is the good case and should stay silent, and
    // recovering while sitting on the portal is not news either.
    const hadGame =
      useGameStore.getState().lobby !== null || useGameStore.getState().state !== null;
    if (
      status === 'connected' &&
      hadGame &&
      (previous === 'reconnecting' || previous === 'offline')
    ) {
      useGameStore.getState().pushToast({
        tone: 'success',
        title: 'Reconnected',
        message: 'Your seat and game state were restored.',
      });
    }
    // The retry loop cycles connecting -> offline -> connecting, so guard on a
    // latch rather than on the previous status: exactly one sticky notice per
    // outage, cleared the moment we are back.
    if (status === 'offline' && offlineToastId === null) {
      offlineToastId = useGameStore.getState().pushToast({
        tone: 'error',
        title: 'Connection lost',
        message: 'Still retrying in the background. Your seat is held.',
        duration: 0,
      });
    }
    if (status === 'connected' && offlineToastId !== null) {
      useGameStore.getState().dismissToast(offlineToastId);
      offlineToastId = null;
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
 * Screens never touch the socket or build wire frames by hand; they call
 * these, which keeps every outgoing message type-checked against
 * `ClientMessage`. `settings` and `action` are `unknown` on the wire, so the
 * game UI is what supplies a real payload — this layer only routes it.
 */
export const net = {
  /** Refresh only list data, without flashing the account loading controls. */
  async refreshSavedGames(signal: AbortSignal): Promise<void> {
    const accountId = useGameStore.getState().auth.account?.id;
    if (accountId) {
      const response = await fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store', signal });
      if (!response.ok) return;
      const payload = await response.json() as { account: AuthAccount | null; games: AccountGame[] };
      if (!signal.aborted && payload.account?.id === accountId && useGameStore.getState().auth.account?.id === accountId) {
        useGameStore.setState(state => ({ auth: { ...state.auth, games: payload.games } }));
      }
      return;
    }
    await Promise.allSettled(useGameStore.getState().anonymousGames.map(async game => {
      const response = await fetch(`/api/games/code/${encodeURIComponent(game.code)}`, {
        headers: { Authorization: `Bearer ${game.sessionToken}` }, cache: 'no-store', signal,
      });
      if (!response.ok) return;
      const table = await response.json() as { gameName: string; started: boolean; isYourTurn: boolean };
      if (signal.aborted || useGameStore.getState().auth.account) return;
      // Turn status is transient: keep it out of local storage and retain list order.
      useGameStore.setState(state => ({ anonymousGames: state.anonymousGames.map(current =>
        current.gameId === game.gameId && current.sessionToken === game.sessionToken
          ? { ...current, gameName: table.gameName, started: table.started, isYourTurn: table.isYourTurn }
          : current) }));
    }));
  },

  /** Opens the connection. Safe to call repeatedly. */
  start(): void {
    socket.connect();
  },

  async loadAuth(): Promise<void> {
    // Anonymous game lists also need current names after another player renames a table.
    void Promise.allSettled(loadAnonymousGames().map(async game => {
      const response = await fetch(`/api/games/code/${encodeURIComponent(game.code)}`);
      if (!response.ok) return;
      const table = await response.json() as { gameName?: string; started?: boolean };
      const current = useGameStore.getState().anonymousGames.find(g => g.gameId === game.gameId);
      if (current && typeof table.gameName === 'string') {
        useGameStore.setState({ anonymousGames: upsertAnonymousGame({ ...current, gameName: table.gameName, started: table.started ?? current.started }) });
      }
    }));
    useGameStore.setState((state) => ({ auth: { ...state.auth, loading: true } }));
    try {
      const response = await fetch('/api/auth/me', { credentials: 'same-origin' });
      if (!response.ok) throw new Error(`Authentication status returned ${response.status}`);
      const payload = (await response.json()) as {
        configured: boolean;
        required: boolean;
        authenticated: boolean;
        account: AuthAccount | null;
        games: AccountGame[];
      };
      useGameStore.getState().setAuth({ ...payload, loading: false });
      // Refresh the account's table list after an OAuth callback or reload.
      if (payload.authenticated) useGameStore.setState({ playerName: payload.account?.name ?? '' });
    } catch {
      useGameStore.setState((state) => ({
        auth: { ...state.auth, loading: false },
      }));
    }
  },

  login(): void {
    window.dispatchEvent(new Event('tt:login'));
  },

  async authenticate(username: string, password: string, register: boolean): Promise<void> {
    const response = await fetch(register ? '/auth/register' : '/auth/login', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message ?? 'Sign-in failed.');
    socket.disconnect();
    await net.loadAuth();
    socket.connect();
  },

  async linkLocalGames(): Promise<number> {
    const tokens = [...new Set([...loadAnonymousGames().map(game => game.sessionToken), loadLegacySessionToken()].filter((token): token is string => !!token))];
    const response = await fetch('/api/auth/link-games', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokens }),
    });
    if (!response.ok) throw new Error('Could not link local games. Please try again.');
    const result = await response.json() as { linked: string[] };
    for (const token of result.linked) {
      removeAnonymousGameByToken(token);
      if (loadLegacySessionToken() === token) clearLegacySessionToken();
    }
    useGameStore.setState({ anonymousGames: loadAnonymousGames() });
    await net.loadAuth();
    return result.linked.length;
  },

  async logout(): Promise<void> {
    const response = await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!response.ok) throw new Error('Sign out failed.');
    socket.disconnect();
    clearLegacySessionToken();
    useGameStore.setState({
      auth: {
        configured: useGameStore.getState().auth.configured,
        required: useGameStore.getState().auth.required,
        authenticated: false,
        account: null,
        games: [],
        loading: false,
      },
      lobby: null,
      state: null,
      gameKey: null,
      myPlayerId: null,
      chat: [],
    });
  },

  stop(): void {
    socket.disconnect();
  },

  /** Manual retry, wired to the "Retry now" affordance on the offline banner. */
  retry(): void {
    socket.retryNow();
  },

  hello(): void {
    socket.send({ t: 'hello' });
  },

  createGame(gameKey: GameKey, name: string, settings: unknown, gameName = ""): void {
    useGameStore.getState().setPlayerName(name);
    useGameStore.setState({ pending: true, lastError: null, gameKey });
    socket.send({ t: 'createGame', gameKey, name, settings, gameName });
  },

  joinGame(code: string, name: string): void {
    useGameStore.getState().setPlayerName(name);
    useGameStore.setState({ pending: true, lastError: null });
    const sessionToken = sessionTokenForInvite(code);
    // A saved invite is a resume, including when hello and auto-join race.
    // Never create a second anonymous seat in the same table.
    socket.send(sessionToken ? { t: 'rejoin', sessionToken } : { t: 'joinGame', code: code.toUpperCase(), name });
  },

  rejoin(sessionToken: string): void {
    socket.send({ t: 'rejoin', sessionToken });
  },

  /** Resumes one table from this browser's anonymous local game list. */
  resumeAnonymousGame(gameId: string): void {
    navigate({ name: "portal" });
    const game = useGameStore.getState().anonymousGames.find(
      (candidate) => candidate.gameId === gameId,
    );
    if (!game) {
      useGameStore.getState().pushToast({
        tone: 'warning',
        title: 'Game no longer available',
        message: 'This browser no longer has a saved seat for that table.',
      });
      return;
    }
    saveLegacySessionToken(game.sessionToken);
    useGameStore.setState({ pending: true, lastError: null });
    socket.send({ t: 'rejoin', sessionToken: game.sessionToken });
  },

  resumeGame(gameId: string): void {
    navigate({ name: "portal" });
    useGameStore.setState({ pending: true, lastError: null });
    socket.send({ t: 'resumeGame', gameId });
  },

  viewGames(): void {
    useGameStore.setState({ pending: true, lastError: null });
    socket.send({ t: 'viewGames' });
  },

  leaveGame(): void {
    useGameStore.setState({ pending: true, lastError: null });
    socket.send({ t: 'leaveGame' });
  },

  setGameName(gameName: string): void { socket.send({ t: 'setGameName', gameName }); },

  setReady(ready: boolean): void {
    socket.send({ t: 'setReady', ready });
  },

  /**
   * Seat colour. The server rejects a colour already claimed by another seat,
   * so the swatch list is disabled optimistically *and* validated
   * authoritatively.
   */
  setColor(color: SeatColor): void {
    socket.send({ t: 'setColor', color });
  },

  /** Rename in place; keep the current form value ready for the next game. */
  setName(name: string): void {
    useGameStore.getState().setPlayerName(name);
    socket.send({ t: 'setName', name });
  },

  updateSettings(settings: unknown): void {
    socket.send({ t: 'updateSettings', settings });
  },

  addBot(botKind: "standard" | "jev" = "standard"): void {
    socket.send({ t: 'addBot', botKind });
  },

  removePlayer(playerId: PlayerId): void {
    socket.send({ t: 'removePlayer', playerId });
  },

  startGame(): void {
    socket.send({ t: 'startGame' });
  },

  action(action: unknown, nonce?: string): void {
    socket.send({ t: 'action', action, nonce });
  },

  chat(text: string): void {
    socket.send({ t: 'chat', text });
  },

  ping(): void {
    socket.send({ t: 'ping' });
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

/**
 * Live presence for a seat.
 *
 * The lobby is the platform's source of truth for who is actually connected —
 * a game state may or may not carry presence, and if it does it is only ever a
 * copy. Anything drawing a "connected" dot should read it from here.
 */
export const selectConnectedSeats = (state: GameStore): Record<PlayerId, boolean> => {
  const out: Record<PlayerId, boolean> = {};
  for (const seat of state.lobby?.players ?? []) out[seat.id] = seat.isBot || seat.connected;
  return out;
};
